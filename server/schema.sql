-- Studio da Michele — Schema PostgreSQL
-- Execute: psql "postgresql://user:pass@localhost:5434/evolution" -f server/schema.sql
-- Em produção: montado em /docker-entrypoint-initdb.d/ para rodar automaticamente

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── studios ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studios (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── studio_config ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio_config (
  studio_id INT          NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  key       VARCHAR(50)  NOT NULL,
  value     TEXT         NOT NULL,
  PRIMARY KEY (studio_id, key)
);

-- ── admins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  studio_id     INT          NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── services ─────────────────────────────────────────────────
-- Seed feito pelo endpoint /api/auth/setup após criar o studio
CREATE TABLE IF NOT EXISTS services (
  id         SERIAL PRIMARY KEY,
  studio_id  INT           NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  name       TEXT          NOT NULL,
  duration   INT           NOT NULL,
  price      NUMERIC(10,2) NOT NULL,
  color      TEXT          NOT NULL DEFAULT '#C4956A',
  emoji      TEXT          NOT NULL DEFAULT '💅',
  slug       TEXT,
  active     BOOLEAN       NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ   DEFAULT NOW()
);

-- ── clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id  INT  NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (studio_id, phone)
);

-- ── appointments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id     INT  NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id    INT  NOT NULL REFERENCES services(id),
  date          DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('pending','confirmed','cancelled','completed')),
  created_via   TEXT NOT NULL DEFAULT 'panel'
                  CHECK (created_via IN ('panel','bot','api','website')),
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── time_blocks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_blocks (
  id         SERIAL PRIMARY KEY,
  studio_id  INT  NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'Bloqueado',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── appointment_services ─────────────────────────────────────
-- Relação N:N entre agendamentos e serviços (suporta múltiplos serviços por agendamento)
CREATE TABLE IF NOT EXISTS appointment_services (
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     INT  NOT NULL REFERENCES services(id),
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (appointment_id, service_id)
);

-- ── vip_contacts ─────────────────────────────────────────────
-- Pessoas próximas da manicure que não devem receber mensagens automáticas
CREATE TABLE IF NOT EXISTS vip_contacts (
  studio_id INT  NOT NULL DEFAULT 1 REFERENCES studios(id) ON DELETE CASCADE,
  phone     TEXT NOT NULL,
  name      TEXT NOT NULL,
  note      TEXT,
  PRIMARY KEY (studio_id, phone)
);

-- ── client_accounts ──────────────────────────────────────────
-- Conta global da cliente — vinculada a agendamentos pelo telefone
CREATE TABLE IF NOT EXISTS client_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── bot_sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_sessions (
  phone      VARCHAR(20)  PRIMARY KEY,
  push_name  VARCHAR(100) NOT NULL DEFAULT '',
  intent     VARCHAR(20)  NOT NULL DEFAULT 'none',
  step       VARCHAR(30)  NOT NULL DEFAULT 'INIT',
  data       JSONB        NOT NULL DEFAULT '{}',
  history    JSONB        NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── trigger: updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS appointments_updated_at ON appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS bot_sessions_updated_at ON bot_sessions;
CREATE TRIGGER bot_sessions_updated_at
  BEFORE UPDATE ON bot_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── view: appointments_full ──────────────────────────────────
CREATE OR REPLACE VIEW appointments_full AS
SELECT
  a.id, a.studio_id, a.date, a.start_time, a.end_time, a.status,
  a.reminder_sent, a.created_via, a.created_at, a.notes,
  c.name  AS client_name,
  c.phone AS client_phone,
  s.id    AS service_id,
  s.name  AS service_name,
  s.duration  AS service_duration,
  s.price     AS service_price,
  s.color     AS service_color,
  s.emoji     AS service_emoji
FROM appointments a
JOIN clients  c ON c.id = a.client_id
JOIN services s ON s.id = a.service_id;

-- ── function: available_slots ────────────────────────────────
CREATE OR REPLACE FUNCTION available_slots(p_date DATE, p_service_id INT, p_studio_id INT, p_duration INT DEFAULT NULL)
RETURNS TABLE(slot_time TIME)
LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT; v_dow INT; v_work_days TEXT;
  v_work_start TIME; v_work_end TIME; v_slot TIME; v_end TIME;
BEGIN
  v_dow := EXTRACT(ISODOW FROM p_date);

  SELECT value INTO v_work_days  FROM studio_config WHERE studio_id = p_studio_id AND key = 'work_days';
  SELECT value::TIME INTO v_work_start FROM studio_config WHERE studio_id = p_studio_id AND key = 'work_start';
  SELECT value::TIME INTO v_work_end   FROM studio_config WHERE studio_id = p_studio_id AND key = 'work_end';

  IF v_work_days  IS NULL THEN v_work_days  := '1,2,3,4,5'; END IF;
  IF v_work_start IS NULL THEN v_work_start := '09:00'; END IF;
  IF v_work_end   IS NULL THEN v_work_end   := '18:00'; END IF;

  IF NOT (v_dow::TEXT = ANY(string_to_array(v_work_days, ','))) THEN RETURN; END IF;

  IF p_duration IS NOT NULL THEN
    v_duration := p_duration;
  ELSE
    SELECT duration INTO v_duration FROM services
      WHERE id = p_service_id AND studio_id = p_studio_id AND active = true;
    IF v_duration IS NULL THEN RETURN; END IF;
  END IF;

  v_slot := v_work_start;
  LOOP
    v_end := v_slot + (v_duration || ' minutes')::INTERVAL;
    EXIT WHEN v_end > v_work_end;

    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE date = p_date AND studio_id = p_studio_id
        AND status <> 'cancelled'
        AND start_time < v_end AND end_time > v_slot
    ) AND NOT EXISTS (
      SELECT 1 FROM time_blocks
      WHERE date = p_date AND studio_id = p_studio_id
        AND start_time < v_end AND end_time > v_slot
    ) THEN
      slot_time := v_slot; RETURN NEXT;
    END IF;

    v_slot := v_slot + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;
