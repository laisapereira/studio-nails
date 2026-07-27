-- venhagenda — Schema PostgreSQL (instalações novas)
-- Execute: psql "postgresql://user:pass@localhost:5434/evolution" -f server/schema.sql
-- Em produção: montado em /docker-entrypoint-initdb.d/ para rodar automaticamente
-- Bancos existentes: usar server/migrations/ (001..003), nunca este arquivo.
--
-- Nomenclatura B2B2C:
--   tenants   = o B  (a empreendedora/estúdio, dona da agenda)
--   users     = login administrativo da dona do estúdio
--   customers = o C  (cliente final que agenda) — GLOBAL, vinculada a N tenants

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── tenants ──────────────────────────────────────────────────
-- plan: 'premium' tem whatsapp_instance própria (número dedicado);
--       'basic' usa o número central compartilhado (instância via env)
CREATE TABLE IF NOT EXISTS tenants (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  address           TEXT,
  plan              TEXT NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'premium')),
  whatsapp_instance TEXT UNIQUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── tenant_config ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id INT          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       VARCHAR(50)  NOT NULL,
  value     TEXT         NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

-- ── users (login admin da dona do estúdio) ───────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── services ─────────────────────────────────────────────────
-- Seed feito pelo endpoint /api/auth/setup após criar o tenant
-- reminder_days_before: quantos dias antes do horário a cliente recebe lembrete
CREATE TABLE IF NOT EXISTS services (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INT           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT          NOT NULL,
  duration             INT           NOT NULL,
  price                NUMERIC(10,2) NOT NULL,
  color                TEXT          NOT NULL DEFAULT '#C4956A',
  emoji                TEXT          NOT NULL DEFAULT '💅',
  slug                 TEXT,
  active               BOOLEAN       NOT NULL DEFAULT true,
  reminder_days_before INT           NOT NULL DEFAULT 2 CHECK (reminder_days_before >= 0),
  created_at           TIMESTAMPTZ   DEFAULT NOW()
);

-- ── customers (globais — a mesma pessoa em N tenants) ────────
-- email/password_hash nullable: reservados para login formal futuro;
-- o fluxo atual é lookup por telefone (sempre 200, anti-enumeração)
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT  NOT NULL,
  phone         TEXT  NOT NULL UNIQUE,
  tenant_ids    INT[] NOT NULL,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_ids ON customers USING GIN (tenant_ids);

-- ── appointments ─────────────────────────────────────────────
-- services: snapshot JSONB [{id, name, price, duration, emoji, color}] congelado
-- no momento do booking — histórico não muda se o serviço mudar depois.
-- reminder_date = date - max(reminder_days_before dos serviços escolhidos)
CREATE TABLE IF NOT EXISTS appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INT   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    UUID  NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  services       JSONB NOT NULL,
  total_price    NUMERIC(10,2) NOT NULL,
  total_duration INT   NOT NULL,
  date           DATE  NOT NULL,
  start_time     TIME  NOT NULL,
  end_time       TIME  NOT NULL,
  status         TEXT  NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('pending','confirmed','cancelled','completed')),
  created_via    TEXT  NOT NULL DEFAULT 'panel'
                   CHECK (created_via IN ('panel','bot','api','website')),
  reminder_date  DATE  NOT NULL,
  reminder_sent  BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON appointments (tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder    ON appointments (reminder_date) WHERE NOT reminder_sent;

-- ── time_blocks (bloqueio manual de agenda, intervalo de datas) ──
CREATE TABLE IF NOT EXISTS time_blocks (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'Bloqueado',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── messages (tabela-fato: histórico completo WhatsApp) ──────
-- Outbound: gravadas por server/src/lib/whatsapp.ts a cada envio via UazAPI.
-- Inbound: serão gravadas pelo fluxo n8n (futuro) — external_id + instance
-- têm UNIQUE parcial para dedupe de webhook.
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INT  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id)    ON DELETE SET NULL,
  appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,
  reply_to_id       UUID REFERENCES messages(id)     ON DELETE SET NULL,
  phone             TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  kind              TEXT NOT NULL DEFAULT 'bot'
                      CHECK (kind IN ('bot', 'notification', 'reminder', 'summary')),
  body              TEXT NOT NULL,
  whatsapp_instance TEXT,
  external_id       TEXT,           -- id da mensagem no UazAPI
  status            TEXT NOT NULL DEFAULT 'sent'
                      CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_history ON messages (tenant_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_appt    ON messages (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external ON messages (whatsapp_instance, external_id)
  WHERE external_id IS NOT NULL;

-- ── bot_sessions ─────────────────────────────────────────────
-- EXCEÇÃO de nomenclatura: studio_id mantido por contrato com o fluxo n8n,
-- que faz SQL direto nesta tabela (select + upsert). Renomear para tenant_id
-- somente junto com a atualização do fluxo.
CREATE TABLE IF NOT EXISTS bot_sessions (
  studio_id  INT          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone      VARCHAR(20)  NOT NULL,
  push_name  VARCHAR(100) NOT NULL DEFAULT '',
  intent     VARCHAR(20)  NOT NULL DEFAULT 'none',
  step       VARCHAR(30)  NOT NULL DEFAULT 'INIT',
  data       JSONB        NOT NULL DEFAULT '{}',
  history    JSONB        NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (studio_id, phone)
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
-- service_* (singular) = derivados do 1º serviço do snapshot — contrato HTTP legado
CREATE OR REPLACE VIEW appointments_full AS
SELECT
  a.id, a.tenant_id, a.date, a.start_time, a.end_time, a.status,
  a.reminder_sent, a.reminder_date, a.created_via, a.created_at, a.notes,
  c.name  AS client_name,
  c.phone AS client_phone,
  a.services, a.total_price, a.total_duration,
  (a.services->0->>'id')::INT AS service_id,
  a.services->0->>'name'      AS service_name,
  a.services->0->>'color'     AS service_color,
  a.services->0->>'emoji'     AS service_emoji,
  (SELECT string_agg(e.value->>'name', ' + ' ORDER BY e.ordinality)
     FROM jsonb_array_elements(a.services) WITH ORDINALITY e) AS all_service_names
FROM appointments a
JOIN customers c ON c.id = a.customer_id;

-- ── function: available_slots ────────────────────────────────
CREATE OR REPLACE FUNCTION available_slots(p_date DATE, p_service_id INT, p_tenant_id INT, p_duration INT DEFAULT NULL)
RETURNS TABLE(slot_time TIME)
LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT; v_dow INT; v_work_days TEXT;
  v_work_start TIME; v_work_end TIME; v_slot TIME; v_end TIME;
BEGIN
  v_dow := EXTRACT(ISODOW FROM p_date);

  SELECT value INTO v_work_days  FROM tenant_config WHERE tenant_id = p_tenant_id AND key = 'work_days';
  SELECT value::TIME INTO v_work_start FROM tenant_config WHERE tenant_id = p_tenant_id AND key = 'work_start';
  SELECT value::TIME INTO v_work_end   FROM tenant_config WHERE tenant_id = p_tenant_id AND key = 'work_end';

  IF v_work_days  IS NULL THEN v_work_days  := '1,2,3,4,5'; END IF;
  IF v_work_start IS NULL THEN v_work_start := '09:00'; END IF;
  IF v_work_end   IS NULL THEN v_work_end   := '18:00'; END IF;

  IF NOT (v_dow::TEXT = ANY(string_to_array(v_work_days, ','))) THEN RETURN; END IF;

  IF p_duration IS NOT NULL THEN
    v_duration := p_duration;
  ELSE
    SELECT duration INTO v_duration FROM services
      WHERE id = p_service_id AND tenant_id = p_tenant_id AND active = true;
    IF v_duration IS NULL THEN RETURN; END IF;
  END IF;

  v_slot := v_work_start;
  LOOP
    v_end := v_slot + (v_duration || ' minutes')::INTERVAL;
    EXIT WHEN v_end > v_work_end;

    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE date = p_date AND tenant_id = p_tenant_id
        AND status <> 'cancelled'
        AND start_time < v_end AND end_time > v_slot
    ) AND NOT EXISTS (
      SELECT 1 FROM time_blocks
      WHERE p_date BETWEEN start_date AND end_date
        AND tenant_id = p_tenant_id
        AND start_time < v_end AND end_time > v_slot
    ) THEN
      slot_time := v_slot; RETURN NEXT;
    END IF;

    v_slot := v_slot + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;

-- ── Row Level Security (RLS) ──────────────────────────────────
-- Isola dados por tenant_id. A política é permissiva quando app.tenant_id
-- não está definido na sessão (rotas públicas/bot). Para rotas admin, o
-- middleware define: SET app.tenant_id = '<id>'

ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_users         ON users         USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_tenant_config ON tenant_config USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_services      ON services      USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_appointments  ON appointments  USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_time_blocks   ON time_blocks   USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_messages      ON messages      USING (current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)='' OR tenant_id=current_setting('app.tenant_id',TRUE)::INT);
CREATE POLICY rls_customers     ON customers     USING (
  current_setting('app.tenant_id',TRUE) IS NULL OR current_setting('app.tenant_id',TRUE)=''
  OR tenant_ids @> ARRAY[current_setting('app.tenant_id',TRUE)::INT]
);
