-- Studio da Michele — Schema PostgreSQL (sem Supabase)
-- Execute: psql "postgresql://user:pass@localhost:5433/evolution" -f server/schema.sql

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── admins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── services ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id       SERIAL PRIMARY KEY,
  name     TEXT          NOT NULL,
  duration INT           NOT NULL,
  price    NUMERIC(10,2) NOT NULL,
  color    TEXT          NOT NULL DEFAULT '#C4956A',
  emoji    TEXT          NOT NULL DEFAULT '💅',
  active   BOOLEAN       NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO services (name, duration, price, color, emoji) VALUES
  ('Esmaltação Completa', 90,  40.00, '#A0522D', '💅'),
  ('Pé Normal',           40,  25.00, '#8B4513', '🦶'),
  ('Mão Normal',          45,  20.00, '#C4956A', '✋'),
  ('Banho de Gel',        150, 80.00, '#6B3522', '✨'),
  ('Alongamento em Gel',  180, 120.00,'#3D1C0C', '💎')
ON CONFLICT DO NOTHING;

-- ── clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── appointments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id    INT  NOT NULL REFERENCES services(id),
  date          DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('pending','confirmed','cancelled','completed')),
  created_via   TEXT NOT NULL DEFAULT 'panel'
                  CHECK (created_via IN ('panel','bot','api')),
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
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
  a.id, a.date, a.start_time, a.end_time, a.status,
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
CREATE OR REPLACE FUNCTION available_slots(p_date DATE, p_service_id INT)
RETURNS TABLE(slot_time TIME)
LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT;
  v_dow      INT;
  v_slot     TIME := '09:00';
  v_work_end TIME := '18:00';
  v_end      TIME;
BEGIN
  v_dow := EXTRACT(ISODOW FROM p_date);
  IF v_dow NOT BETWEEN 1 AND 5 THEN RETURN; END IF;

  SELECT duration INTO v_duration FROM services WHERE id = p_service_id AND active = true;
  IF v_duration IS NULL THEN RETURN; END IF;

  LOOP
    v_end := v_slot + (v_duration || ' minutes')::INTERVAL;
    EXIT WHEN v_end > v_work_end;

    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE date = p_date AND status <> 'cancelled'
        AND start_time < v_end
        AND end_time   > v_slot
    ) THEN
      slot_time := v_slot;
      RETURN NEXT;
    END IF;

    v_slot := v_slot + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;
