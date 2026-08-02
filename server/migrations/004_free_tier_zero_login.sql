-- Migration 004 — Free tier + zero login
-- Rodar DEPOIS da 003 (pode ser na mesma janela de deploy):
--   psql "$DATABASE_URL" -f server/migrations/004_free_tier_zero_login.sql
--
-- Decisões de negócio (jul/2026):
--   * Posicionamento: 100% WhatsApp, zero login, zero senha — cliente final
--     nunca terá conta com senha; lookup é só por telefone.
--   * Free tier: 5 agendamentos ou 30 dias, o que vier primeiro. O limite de
--     agendamentos é derivado (COUNT em appointments); o prazo fica em
--     trial_ends_at. Tenant novo nasce 'free'.
--   * 'basic' = plano de entrada pago (número central compartilhado);
--     'premium' = número WhatsApp dedicado (whatsapp_instance própria).

BEGIN;

-- ── 1. Zero login: customers sem credenciais ──────────────────────────────────
ALTER TABLE customers DROP COLUMN IF EXISTS email;
ALTER TABLE customers DROP COLUMN IF EXISTS password_hash;

-- ── 2. Free tier ──────────────────────────────────────────────────────────────
ALTER TABLE tenants DROP CONSTRAINT tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('free', 'basic', 'premium'));
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'free';

-- trial_ends_at NULL = sem trial ativo (plano pago ou trial encerrado/convertido)
ALTER TABLE tenants ADD COLUMN trial_ends_at TIMESTAMPTZ
  DEFAULT (NOW() + INTERVAL '30 days');

-- Tenants existentes precedem o free tier — nenhum está em trial
UPDATE tenants SET trial_ends_at = NULL;

COMMIT;

-- Enforcement do limite (bloquear 6º agendamento / trial vencido) é lógica de
-- aplicação no POST /api/appointments — ainda não implementado; ver backlog.
