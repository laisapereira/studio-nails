-- Migration 003 — Reestruturação B2B2C
-- Rodar manualmente contra o banco existente (schema.sql só roda automaticamente
-- em instalações novas via docker-entrypoint-initdb.d):
--   psql "$DATABASE_URL" -f server/migrations/003_restructure.sql
--
-- ANTES de rodar em produção: rodar num restore do dump e validar (ver checks
-- no fim deste arquivo). Transação única — all-or-nothing.
--
-- O que muda:
--   * Renames B2B2C: studios→tenants, admins→users, clients→customers,
--     studio_config→tenant_config, studio_id→tenant_id
--   * DROP vip_contacts, client_accounts (mortas), appointment_services
--   * appointments ganha snapshot JSONB de serviços + total_price/total_duration
--     + reminder_date; perde service_id singular
--   * customers vira global (phone UNIQUE) com tenant_ids INT[]
--   * tenants.plan (basic/premium), services.reminder_days_before
--   * Nova tabela-fato messages (histórico WhatsApp)
--   * RLS recriada com app.tenant_id
--
-- Exceção deliberada: bot_sessions NÃO muda (nem a coluna studio_id) — o fluxo
-- n8n faz SQL direto nela. Renomear junto com o fluxo, em outra janela.

BEGIN;

-- ── A. Derrubar objetos dependentes das tabelas/colunas antigas ───────────────
DROP VIEW IF EXISTS appointments_full;
DROP FUNCTION IF EXISTS available_slots(DATE, INT, INT, INT);

-- ── B. Derrubar policies antigas ──────────────────────────────────────────────
-- Elas referem app.studio_id; quando o middleware passar a setar app.tenant_id,
-- policies esquecidas viram permissivas silenciosas (furo de isolamento).
DROP POLICY IF EXISTS rls_admins        ON admins;
DROP POLICY IF EXISTS rls_studio_config ON studio_config;
DROP POLICY IF EXISTS rls_services      ON services;
DROP POLICY IF EXISTS rls_clients       ON clients;
DROP POLICY IF EXISTS rls_appointments  ON appointments;
DROP POLICY IF EXISTS rls_time_blocks   ON time_blocks;
DROP POLICY IF EXISTS rls_vip_contacts  ON vip_contacts;
DROP POLICY IF EXISTS rls_appt_services ON appointment_services;

-- ── C. Tabelas mortas ─────────────────────────────────────────────────────────
DROP TABLE IF EXISTS vip_contacts;
DROP TABLE IF EXISTS client_accounts;

-- ── D. Renames ────────────────────────────────────────────────────────────────
ALTER TABLE studios       RENAME TO tenants;
ALTER TABLE studio_config RENAME TO tenant_config;
ALTER TABLE tenant_config RENAME COLUMN studio_id TO tenant_id;
ALTER TABLE admins        RENAME TO users;
ALTER TABLE users         RENAME COLUMN studio_id TO tenant_id;
ALTER TABLE services      RENAME COLUMN studio_id TO tenant_id;
ALTER TABLE clients       RENAME TO customers;   -- studio_id tratado no bloco H
ALTER TABLE appointments  RENAME COLUMN studio_id TO tenant_id;
ALTER TABLE appointments  RENAME COLUMN client_id TO customer_id;
ALTER TABLE time_blocks   RENAME COLUMN studio_id TO tenant_id;

-- ── E. Planos (premium = número WhatsApp dedicado; basic = número central) ────
ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'basic'
  CHECK (plan IN ('basic', 'premium'));
UPDATE tenants SET plan = 'premium' WHERE whatsapp_instance IS NOT NULL;

-- ── F. Lembrete configurável por serviço ──────────────────────────────────────
ALTER TABLE services ADD COLUMN reminder_days_before INT NOT NULL DEFAULT 2
  CHECK (reminder_days_before >= 0);

-- ── G. appointments: snapshot JSONB + totais + reminder_date ──────────────────
ALTER TABLE appointments
  ADD COLUMN services       JSONB,
  ADD COLUMN total_price    NUMERIC(10,2),
  ADD COLUMN total_duration INT,
  ADD COLUMN reminder_date  DATE;

-- Backfill do snapshot: lista completa da N:N; fallback pro service_id singular
UPDATE appointments a SET services = COALESCE(
  (SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'price', s.price,
      'duration', s.duration, 'emoji', s.emoji, 'color', s.color)
      ORDER BY aps.sort_order)
   FROM appointment_services aps JOIN services s ON s.id = aps.service_id
   WHERE aps.appointment_id = a.id),
  (SELECT jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'price', s.price,
      'duration', s.duration, 'emoji', s.emoji, 'color', s.color))
   FROM services s WHERE s.id = a.service_id)
);

UPDATE appointments SET
  total_price    = (SELECT SUM((e->>'price')::NUMERIC) FROM jsonb_array_elements(services) e),
  total_duration = (SELECT SUM((e->>'duration')::INT)  FROM jsonb_array_elements(services) e),
  reminder_date  = date - 2;   -- legado: todos os serviços nascem com reminder_days_before = 2

ALTER TABLE appointments
  ALTER COLUMN services       SET NOT NULL,
  ALTER COLUMN total_price    SET NOT NULL,
  ALTER COLUMN total_duration SET NOT NULL,
  ALTER COLUMN reminder_date  SET NOT NULL;

-- Evita rajada retroativa no primeiro cron (reminder_sent nunca foi escrito até hoje)
UPDATE appointments SET reminder_sent = true WHERE reminder_date <= CURRENT_DATE;

ALTER TABLE appointments DROP COLUMN service_id;
DROP TABLE appointment_services;

-- ── H. customers global (fusão por phone) ─────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN tenant_ids    INT[],
  ADD COLUMN email         VARCHAR(255),
  ADD COLUMN password_hash TEXT;

CREATE TEMP TABLE customer_merge ON COMMIT DROP AS
SELECT id, phone,
       FIRST_VALUE(id) OVER (PARTITION BY phone ORDER BY created_at, id) AS canon_id
FROM customers;

-- Agregar ANTES de deletar duplicatas (usa todas as linhas de cada phone)
UPDATE customers c SET tenant_ids = agg.arr
FROM (SELECT phone, array_agg(DISTINCT studio_id) AS arr
      FROM customers GROUP BY phone) agg
WHERE agg.phone = c.phone;

UPDATE appointments a SET customer_id = m.canon_id
FROM customer_merge m
WHERE a.customer_id = m.id AND m.id <> m.canon_id;

DELETE FROM customers c USING customer_merge m
WHERE c.id = m.id AND m.id <> m.canon_id;

ALTER TABLE customers DROP COLUMN studio_id;  -- derruba UNIQUE(studio_id, phone) e a FK
ALTER TABLE customers ALTER COLUMN tenant_ids SET NOT NULL;
ALTER TABLE customers ADD CONSTRAINT customers_phone_key UNIQUE (phone);
ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
CREATE INDEX idx_customers_tenant_ids ON customers USING GIN (tenant_ids);

-- ── I. messages (tabela-fato: histórico completo WhatsApp) ────────────────────
CREATE TABLE messages (
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
CREATE INDEX idx_messages_history ON messages (tenant_id, phone, created_at DESC);
CREATE INDEX idx_messages_appt    ON messages (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX idx_messages_external ON messages (whatsapp_instance, external_id)
  WHERE external_id IS NOT NULL;   -- dedupe de webhook inbound (n8n futuro)

-- ── J. Recriar view e função ──────────────────────────────────────────────────
CREATE VIEW appointments_full AS
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

CREATE FUNCTION available_slots(p_date DATE, p_service_id INT, p_tenant_id INT, p_duration INT DEFAULT NULL)
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

-- ── K. RLS com app.tenant_id ──────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- (demais tabelas mantêm o ENABLE através dos renames)

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

-- ── L. Índices de apoio ───────────────────────────────────────────────────────
CREATE INDEX idx_appointments_tenant_date ON appointments (tenant_id, date);
CREATE INDEX idx_appointments_reminder    ON appointments (reminder_date) WHERE NOT reminder_sent;

-- ── M. Compat n8n (TRANSITÓRIA) ───────────────────────────────────────────────
-- O node "Identificar estúdio" do fluxo v5 faz SELECT ... FROM studios.
-- Depois de editar o node (FROM studios → FROM tenants, aliases mantidos):
--   DROP VIEW studios;
CREATE VIEW studios AS
  SELECT id, name, slug, address, whatsapp_instance, created_at FROM tenants;

COMMIT;

-- ── Checks pós-migration (rodar à mão) ────────────────────────────────────────
-- SELECT COUNT(*) FROM appointments WHERE services IS NULL OR jsonb_array_length(services) = 0;  -- 0
-- SELECT COUNT(*) FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id WHERE c.id IS NULL;  -- 0
-- SELECT phone, COUNT(*) FROM customers GROUP BY phone HAVING COUNT(*) > 1;  -- vazio
-- SELECT * FROM available_slots(CURRENT_DATE + 1, NULL, 1, 90) LIMIT 3;      -- retorna slots
-- SET app.tenant_id = '999'; SELECT COUNT(*) FROM customers; RESET app.tenant_id;  -- 0 (RLS ok)
