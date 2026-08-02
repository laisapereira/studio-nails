-- Migration 005 — Funde tenant_config em tenants (fim do chave-valor)
-- Rodar DEPOIS da 004 (pode ser na mesma janela de deploy):
--   psql "$DATABASE_URL" -f server/migrations/005_fold_tenant_config.sql
--
-- Motivo: tenant_config só guardava 4 chaves conhecidas e estáveis
-- (work_days, work_start, work_end, notification_phone), tudo TEXT sem
-- validação. Como colunas tipadas em tenants: menos uma tabela, menos
-- indireção, tipos de verdade.

BEGIN;

-- ── 1. Colunas tipadas em tenants ─────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN work_days          TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- ISO dow CSV (1=seg..7=dom)
  ADD COLUMN work_start         TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN work_end           TIME NOT NULL DEFAULT '18:00',
  ADD COLUMN notification_phone TEXT;

-- ── 2. Backfill a partir do chave-valor ───────────────────────────────────────
UPDATE tenants t SET
  work_days  = COALESCE((SELECT value FROM tenant_config c WHERE c.tenant_id = t.id AND c.key = 'work_days'),  work_days),
  work_start = COALESCE((SELECT value::TIME FROM tenant_config c WHERE c.tenant_id = t.id AND c.key = 'work_start'), work_start),
  work_end   = COALESCE((SELECT value::TIME FROM tenant_config c WHERE c.tenant_id = t.id AND c.key = 'work_end'),   work_end),
  notification_phone = (SELECT value FROM tenant_config c WHERE c.tenant_id = t.id AND c.key = 'notification_phone');

-- ── 3. Fim da tenant_config (a policy RLS cai junto) ──────────────────────────
DROP TABLE tenant_config;

-- ── 4. available_slots passa a ler de tenants ─────────────────────────────────
CREATE OR REPLACE FUNCTION available_slots(p_date DATE, p_service_id INT, p_tenant_id INT, p_duration INT DEFAULT NULL)
RETURNS TABLE(slot_time TIME)
LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT; v_dow INT; v_work_days TEXT;
  v_work_start TIME; v_work_end TIME; v_slot TIME; v_end TIME;
BEGIN
  v_dow := EXTRACT(ISODOW FROM p_date);

  SELECT work_days, work_start, work_end
    INTO v_work_days, v_work_start, v_work_end
  FROM tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN; END IF;

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

COMMIT;
