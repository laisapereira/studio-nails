-- Migration 002 — studios.address
-- Rodar manualmente contra o banco existente (schema.sql só roda automaticamente
-- em instalações novas via docker-entrypoint-initdb.d):
--   psql "$DATABASE_URL" -f server/migrations/002_studios_address.sql
--
-- Contexto: campo usado pelo wizard de onboarding em desenho (ver etapa 4/5 do
-- wizard) -- ainda não implementado, só preparando o schema.

ALTER TABLE studios ADD COLUMN IF NOT EXISTS address TEXT;
