import { Router } from 'express'
import { pool } from '../db.js'
import { resolveTenant } from '../utils.js'
export const slotsRouter = Router()

// GET /api/slots/available?date=YYYY-MM-DD&service_id=2&studio=SLUG
// GET /api/slots/available?date=YYYY-MM-DD&service_ids=1,3&studio=SLUG  (multi-serviço)
// GET /api/slots/available?date=YYYY-MM-DD&service=gel&studio=SLUG  (bot)
// GET /api/slots/available?date=week&service=gel&studio=SLUG  → próximos 5 dias úteis
slotsRouter.get('/available', async (req, res) => {
  try {
    const { date, service, service_id, service_ids, studio } = req.query as Record<string, string>

    if (!date || (!service && !service_id && !service_ids) || !studio) {
      res.status(400).json({ error: 'Parâmetros obrigatórios: date, studio e service (ou service_id/service_ids)' })
      return
    }

    const tenantId = await resolveTenant(studio)
    if (!tenantId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

    let serviceId: number
    let duration: number

    if (service_ids) {
      // Multi-serviço: somar durações de todos os IDs
      const ids = service_ids.split(',').map(Number).filter(Boolean)
      const { rows } = await pool.query(
        'SELECT id, SUM(duration)::INT AS total FROM services WHERE id = ANY($1) AND tenant_id = $2 AND active = true GROUP BY id',
        [ids, tenantId]
      )
      if (rows.length !== ids.length) { res.status(404).json({ error: 'Um ou mais serviços não encontrados.' }); return }
      serviceId = ids[0]
      duration  = rows.reduce((sum: number, r: any) => sum + r.total, 0)
    } else {
      const svcRow = service_id
        ? await pool.query(
            'SELECT id, slug, name, duration FROM services WHERE id = $1 AND tenant_id = $2 AND active = true',
            [service_id, tenantId]
          )
        : await pool.query(
            'SELECT id, slug, name, duration FROM services WHERE slug = $1 AND tenant_id = $2 AND active = true',
            [service, tenantId]
          )
      if (!svcRow.rows[0]) { res.status(404).json({ error: 'Serviço não encontrado.' }); return }
      serviceId = svcRow.rows[0].id
      duration  = svcRow.rows[0].duration
    }

    // date=week → retorna os próximos 5 dias úteis a partir de hoje
    if (date === 'week') {
      // seg=1 … sex=5 (getDay: dom=0, seg=1, …, sex=5, sab=6)
      const workDays = [1, 2, 3, 4, 5]
      const startDate = new Date()
      const days: Record<string, { start: string; end: string }[]> = {}
      let found = 0

      for (let i = 0; found < 5 && i < 30; i++) {
        const d = new Date(startDate)
        d.setDate(startDate.getDate() + i)
        if (!workDays.includes(d.getDay())) continue

        const dateStr = d.toISOString().slice(0, 10)
        const slots = await pool.query(
          'SELECT slot_time::TEXT FROM available_slots($1::DATE, $2::INT, $3::INT, $4::INT) ORDER BY slot_time',
          [dateStr, serviceId, tenantId, duration]
        )
        if (slots.rows.length > 0) {
          days[dateStr] = slots.rows.map(r => {
            const s = r.slot_time.slice(0, 5)
            return { start: s, end: addMinutes(s, duration) }
          })
          found++
        }
      }

      res.json({ date: 'week', service: service ?? service_id, duration_minutes: duration, days })
      return
    }

    const slots = await pool.query(
      'SELECT slot_time::TEXT FROM available_slots($1::DATE, $2::INT, $3::INT, $4::INT) ORDER BY slot_time',
      [date, serviceId, tenantId, duration]
    )

    const result = slots.rows.map(r => {
      const start = r.slot_time.slice(0, 5)
      const end   = addMinutes(start, duration)
      return { start, end }
    })

    res.json({ date, service, duration_minutes: duration, slots: result })
  } catch (err) {
    console.error('[slots/available]', err)
    res.status(500).json({ error: 'Erro interno ao buscar slots.' })
  }
})

// GET /api/slots/week?start=YYYY-MM-DD&service_id=2&studio=SLUG
// GET /api/slots/week?start=YYYY-MM-DD&service=gel&studio=SLUG  (bot)
// Retorna { "2026-06-02": [{start, end}, ...], "2026-06-03": [...], ... }
// Apenas dias úteis do estúdio a partir de `start` (7 dias corridos)
slotsRouter.get('/week', async (req, res) => {
  try {
    const { start, service, service_id, studio } = req.query as Record<string, string>

    if (!start || (!service && !service_id) || !studio) {
      res.status(400).json({ error: 'Parâmetros obrigatórios: start, studio e service (ou service_id)' })
      return
    }

    const tenantId = await resolveTenant(studio)
    if (!tenantId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

    const svcRow = service_id
      ? await pool.query(
          'SELECT id, duration FROM services WHERE id = $1 AND tenant_id = $2 AND active = true',
          [service_id, tenantId]
        )
      : await pool.query(
          'SELECT id, duration FROM services WHERE slug = $1 AND tenant_id = $2 AND active = true',
          [service, tenantId]
        )

    if (!svcRow.rows[0]) { res.status(404).json({ error: 'Serviço não encontrado.' }); return }

    const { id: serviceId, duration } = svcRow.rows[0]

    const workDays = [1, 2, 3, 4, 5]
    const startDate = new Date(start + 'T00:00:00Z')
    const result: Record<string, { start: string; end: string }[]> = {}

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate)
      d.setUTCDate(startDate.getUTCDate() + i)
      if (!workDays.includes(d.getUTCDay())) continue

      const dateStr = d.toISOString().slice(0, 10)
      const slots = await pool.query(
        'SELECT slot_time::TEXT FROM available_slots($1::DATE, $2::INT, $3::INT, $4::INT) ORDER BY slot_time',
        [dateStr, serviceId, tenantId]
      )
      result[dateStr] = slots.rows.map(r => {
        const s = r.slot_time.slice(0, 5)
        return { start: s, end: addMinutes(s, duration) }
      })
    }

    res.json({ start, service_id: serviceId, duration_minutes: duration, days: result })
  } catch (err) {
    console.error('[slots/week]', err)
    res.status(500).json({ error: 'Erro interno ao buscar slots da semana.' })
  }
})

// GET /api/slots/available-dates?start=YYYY-MM-DD&end=YYYY-MM-DD&service_id=2&studio=SLUG
// GET /api/slots/available-dates?start=YYYY-MM-DD&end=YYYY-MM-DD&service_ids=1,3&studio=SLUG
// Retorna { dates: ["2026-06-10", ...] } — apenas datas com ao menos 1 slot livre
slotsRouter.get('/available-dates', async (req, res) => {
  try {
    const { start, end, service_id, service_ids, studio } = req.query as Record<string, string>

    if (!start || !end || (!service_id && !service_ids) || !studio) {
      res.status(400).json({ error: 'Parâmetros obrigatórios: start, end, studio e service_id (ou service_ids)' })
      return
    }

    const tenantId = await resolveTenant(studio)
    if (!tenantId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

    let serviceId: number
    let duration: number

    if (service_ids) {
      const ids = service_ids.split(',').map(Number).filter(Boolean)
      const { rows } = await pool.query(
        'SELECT id, duration FROM services WHERE id = ANY($1) AND tenant_id = $2 AND active = true',
        [ids, tenantId]
      )
      if (rows.length !== ids.length) { res.status(404).json({ error: 'Um ou mais serviços não encontrados.' }); return }
      serviceId = ids[0]
      duration = rows.reduce((sum: number, r: any) => sum + r.duration, 0)
    } else {
      const { rows } = await pool.query(
        'SELECT id, duration FROM services WHERE id = $1 AND tenant_id = $2 AND active = true',
        [service_id, tenantId]
      )
      if (!rows[0]) { res.status(404).json({ error: 'Serviço não encontrado.' }); return }
      serviceId = rows[0].id
      duration = rows[0].duration
    }

    const { rows: cfgRows } = await pool.query(
      "SELECT value FROM tenant_config WHERE tenant_id = $1 AND key = 'work_days'",
      [tenantId]
    )
    const workDaysIsodow: number[] = cfgRows[0]
      ? cfgRows[0].value.split(',').map(Number)
      : [1, 2, 3, 4, 5]

    const startDate = new Date(start + 'T00:00:00Z')
    const endDate   = new Date(end   + 'T00:00:00Z')
    const dates: string[] = []

    let d = new Date(startDate)
    while (d <= endDate) {
      const jsDow  = d.getUTCDay()
      const isodow = jsDow === 0 ? 7 : jsDow
      if (workDaysIsodow.includes(isodow)) {
        const dateStr = d.toISOString().slice(0, 10)
        const { rows: slotRows } = await pool.query(
          'SELECT 1 FROM available_slots($1::DATE, $2::INT, $3::INT, $4::INT) LIMIT 1',
          [dateStr, serviceId, tenantId, duration]
        )
        if (slotRows.length > 0) dates.push(dateStr)
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }

    res.json({ dates })
  } catch (err) {
    console.error('[slots/available-dates]', err)
    res.status(500).json({ error: 'Erro interno ao buscar datas disponíveis.' })
  }
})

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
