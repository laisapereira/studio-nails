-- Migration 001 — Multi-tenant hardening
-- Rodar manualmente contra o banco existente (não é aplicada automaticamente
-- pelo docker-entrypoint-initdb.d, que só roda server/schema.sql em bancos novos):
--   psql "$DATABASE_URL" -f server/migrations/001_multi_tenant_hardening.sql
--
-- Contexto: venhagenda vai rodar múltiplos negócios com bots simultâneos num
-- único workflow n8n compartilhado (não mais um workflow clonado por cliente).
-- Isso exige (1) mapear instância WhatsApp -> studio, (2) sessão de bot isolada
-- por studio (não só por telefone) e (3) parar de mascarar studio_id ausente
-- com um DEFAULT que hoje aponta pro studio da Michele.

BEGIN;

-- ── 1. Mapeamento instância UazAPI → studio ───────────────────
ALTER TABLE studios ADD COLUMN IF NOT EXISTS whatsapp_instance TEXT UNIQUE;

-- ── 2. bot_sessions: chave composta (studio_id, phone) ────────
-- Hoje a PK é só `phone`, então o mesmo número conversando com bots de dois
-- estúdios diferentes sobrescreve a sessão um do outro.
ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS studio_id INT REFERENCES studios(id) ON DELETE CASCADE;

-- Backfill: hoje só existe o studio da Michele em produção. Se este backfill
-- rodar depois que houver mais de um studio, ajuste manualmente antes do
-- ALTER ... SET NOT NULL abaixo.
UPDATE bot_sessions
SET studio_id = (SELECT id FROM studios ORDER BY id LIMIT 1)
WHERE studio_id IS NULL;

ALTER TABLE bot_sessions ALTER COLUMN studio_id SET NOT NULL;

ALTER TABLE bot_sessions DROP CONSTRAINT IF EXISTS bot_sessions_pkey;
ALTER TABLE bot_sessions ADD PRIMARY KEY (studio_id, phone);

-- ── 3. Remover DEFAULT 1 de studio_id ──────────────────────────
-- Com DEFAULT 1, um INSERT que esqueça studio_id grava silenciosamente nos
-- dados do studio 1 em vez de falhar — rede de segurança que fazia sentido
-- com 1 tenant só e vira risco de vazamento de dado entre tenants agora.
-- Todo INSERT do backend (server/src/routes/*) já passa studio_id explícito,
-- então isso não deveria quebrar nada em produção — só fecha a brecha.
ALTER TABLE admins           ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE studio_config    ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE services         ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE clients          ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE appointments     ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE time_blocks      ALTER COLUMN studio_id DROP DEFAULT;
ALTER TABLE vip_contacts     ALTER COLUMN studio_id DROP DEFAULT;

COMMIT;
