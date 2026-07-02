import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveStudio } from '../utils.js'
import { notifyMichele } from '../lib/whatsapp.js'

export const appointmentsRouter = Router()

// GET /api/appointments — admin, scoped to studio
appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const { start, end, status, phone } = req.query as Record<string, string>
  const studioId = req.admin!.studio_id

  let sql = `
    SELECT a.id,
      s.slug AS service,
      a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
      c.name  AS client_name, c.phone AS client_phone,
      s.id    AS service_id,
      s.name  AS service_name, s.duration AS service_duration,
      s.price AS service_price, s.color AS service_color, s.emoji AS service_emoji,
      a.created_via, a.notes,
      COALESCE(
        (SELECT string_agg(sv.name, ' + ' ORDER BY aps.sort_order)
         FROM appointment_services aps
         JOIN services sv ON sv.id = aps.service_id
         WHERE aps.appointment_id = a.id),
        s.name
      ) AS all_service_names
    FROM appointments a
    JOIN clients  c ON c.id = a.client_id
    JOIN services s ON s.id = a.service_id
    WHERE a.studio_id = $1
  `
  const params: unknown[] = [studioId]

  if (phone) { params.push(phone.replace(/\D/g,'')); sql += ` AND c.phone LIKE '%' || $${params.length}` }
  if (start) { params.push(start); sql += ` AND a.date >= $${params.length}` }
  if (end)   { params.push(end);   sql += ` AND a.date <= $${params.length}` }
  if (status) {
    if (status === 'active') { sql += ` AND a.status <> 'cancelled'` }
    else { params.push(status); sql += ` AND a.status = $${params.length}` }
  }
  sql += ` ORDER BY a.date, a.start_time`

  const { rows } = await pool.query(sql, params)
  res.json({
    appointments: rows.map(r => ({
      id:           r.id,
      service:      r.service ?? null,
      service_id:   r.service_id,
      date:         r.date,
      start_time:   r.start_time.slice(0, 5),
      end_time:     r.end_time.slice(0, 5),
      status:       r.status,
      client_name:  r.client_name,
      client_phone: r.client_phone,
      service_name:      r.service_name,
      all_service_names: r.all_service_names,
      service_duration:  Number(r.service_duration),
      service_price:     Number(r.service_price),
      service_color:     r.service_color,
      service_emoji:     r.service_emoji,
      created_via:       r.created_via,
      notes:             r.notes,
    })),
  })
})

// GET /api/appointments/client?phone=...&studio=...&status=confirmed — bot (público)
appointmentsRouter.get('/client', async (req, res) => {
  try {
    const { phone, studio, status } = req.query as Record<string, string>
    if (!phone || !studio) {
      res.status(400).json({ error: 'Parâmetros obrigatórios: phone, studio' }); return
    }

    const studioId = await resolveStudio(studio)
    if (!studioId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

    const rawPhone = phone.replace(/\D/g, '')
    let sql = `
      SELECT a.id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
             s.name AS service_name, s.duration AS service_duration, s.price AS service_price,
             COALESCE(
               (SELECT string_agg(sv.name, ' + ' ORDER BY aps.sort_order)
                FROM appointment_services aps
                JOIN services sv ON sv.id = aps.service_id
                WHERE aps.appointment_id = a.id),
               s.name
             ) AS all_service_names
      FROM appointments a
      JOIN clients  c ON c.id = a.client_id
      JOIN services s ON s.id = a.service_id
      WHERE a.studio_id = $1 AND c.phone = $2
    `
    const params: unknown[] = [studioId, rawPhone]

    if (status === 'active') { sql += ` AND a.status <> 'cancelled'` }
    else if (status)         { params.push(status); sql += ` AND a.status = $${params.length}` }

    sql += ` ORDER BY a.date, a.start_time`

    const { rows } = await pool.query(sql, params)
    res.json({ appointments: rows })
  } catch (err) {
    console.error('[appointments/client]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/appointments — bot/booking (público)
// Aceita service_id (único) ou service_ids (array, multi-serviço)
appointmentsRouter.post('/', async (req, res) => {
  const { client_name, client_phone, phone, service, service_id, service_ids, date, start_time, created_via, studio, studio_id, reschedule_id } = req.body

  const rawPhone   = (client_phone ?? phone ?? '').replace(/\D/g, '')
  const clientName = client_name ?? req.body.name
  if (!rawPhone || !clientName || !date || !start_time) {
    res.status(400).json({ error: 'client_name, client_phone, service/service_id, date, start_time são obrigatórios.' }); return
  }

  // Resolve studio
  let studioId: number | null = null
  if (studio_id) { studioId = Number(studio_id) }
  else if (studio) { studioId = await resolveStudio(studio) }
  if (!studioId) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }

  // Resolve serviços — aceita service_ids[] (multi), service_id ou service (slug)
  let svcIds: number[]
  let totalDuration: number
  let totalPrice: number
  let primarySvcId: number
  let primarySvcSlug: string
  let primarySvcName: string

  if (service_ids && Array.isArray(service_ids) && service_ids.length > 0) {
    const ids = service_ids.map(Number)
    const { rows: svcs } = await pool.query(
      'SELECT id, slug, name, duration, price FROM services WHERE id = ANY($1) AND studio_id = $2 AND active = true ORDER BY id',
      [ids, studioId]
    )
    if (svcs.length !== ids.length) { res.status(400).json({ error: 'Um ou mais serviços não encontrados.' }); return }
    svcIds         = svcs.map(s => s.id)
    totalDuration  = svcs.reduce((sum: number, s: any) => sum + s.duration, 0)
    totalPrice     = svcs.reduce((sum: number, s: any) => sum + Number(s.price), 0)
    primarySvcId   = svcs[0].id
    primarySvcSlug = svcs[0].slug
    primarySvcName = svcs.map((s: any) => s.name).join(' + ')
  } else {
    let svcRow
    if (service)    { svcRow = await pool.query('SELECT id, slug, name, duration, price FROM services WHERE slug = $1 AND studio_id = $2 AND active = true', [service, studioId]) }
    else if (service_id) { svcRow = await pool.query('SELECT id, slug, name, duration, price FROM services WHERE id = $1 AND studio_id = $2 AND active = true', [service_id, studioId]) }
    else { res.status(400).json({ error: 'Informe service, service_id ou service_ids.' }); return }
    if (!svcRow.rows[0]) { res.status(400).json({ error: 'Serviço não encontrado ou inativo.' }); return }
    svcIds         = [svcRow.rows[0].id]
    totalDuration  = svcRow.rows[0].duration
    totalPrice     = Number(svcRow.rows[0].price)
    primarySvcId   = svcRow.rows[0].id
    primarySvcSlug = svcRow.rows[0].slug
    primarySvcName = svcRow.rows[0].name
  }

  const endTime = addMinutes(start_time, totalDuration)

  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')

    const clientRes = await conn.query(
      `INSERT INTO clients (studio_id, name, phone) VALUES ($1, $2, $3)
       ON CONFLICT (studio_id, phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [studioId, clientName.trim(), rawPhone]
    )
    const clientId = clientRes.rows[0].id

    const { rows } = await conn.query(
      `INSERT INTO appointments (studio_id, client_id, service_id, date, start_time, end_time, created_via)
       SELECT $1, $2, $3, $4, $5::TIME, $6::TIME, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments
         WHERE studio_id = $1 AND date = $4 AND status <> 'cancelled'
           AND start_time < $6::TIME AND end_time > $5::TIME
       )
       RETURNING id`,
      [studioId, clientId, primarySvcId, date, start_time, endTime, created_via ?? 'api']
    )

    if (rows.length === 0) { await conn.query('ROLLBACK'); res.status(409).json({ error: 'Horário já ocupado.' }); return }

    if (reschedule_id) {
      await conn.query(
        `UPDATE appointments SET status = 'cancelled'
         WHERE id = $1 AND client_id = $2 AND status <> 'cancelled'`,
        [reschedule_id, clientId]
      )
    }

    const apptId = rows[0].id
    for (let i = 0; i < svcIds.length; i++) {
      await conn.query(
        'INSERT INTO appointment_services (appointment_id, service_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [apptId, svcIds[i], i]
      )
    }

    await conn.query('COMMIT')

    notifyMichele('new', {
      clientName:  clientName.trim(),
      clientPhone: rawPhone,
      serviceName: primarySvcName,
      totalPrice,
      date,
      startTime:   start_time.slice(0, 5),
      endTime,
    }).catch(err => console.error('[whatsapp] notify new failed:', err))

    res.status(201).json({ id: apptId, status: 'confirmed', service: primarySvcSlug, date, start_time: start_time.slice(0,5), end_time: endTime })
  } catch (e) {
    await conn.query('ROLLBACK')
    throw e
  } finally {
    conn.release()
  }
})

// PATCH /api/appointments/:id/cancel — admin
appointmentsRouter.patch('/:id/cancel', requireAuth, async (req, res) => {
  const { reason } = req.body as { reason?: string }
  const { rows } = await pool.query(
    `UPDATE appointments SET status = 'cancelled', notes = COALESCE($1, notes)
     WHERE id = $2 AND studio_id = $3
     RETURNING id, status, date::TEXT, start_time::TEXT,
       (SELECT name  FROM clients  WHERE id = client_id)  AS client_name,
       (SELECT phone FROM clients  WHERE id = client_id)  AS client_phone,
       (SELECT name  FROM services WHERE id = service_id) AS service_name,
       (SELECT price FROM services WHERE id = service_id) AS service_price`,
    [reason ?? null, req.params.id, req.admin!.studio_id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Agendamento não encontrado.' }); return }
  const r = rows[0]

  notifyMichele('cancel', {
    clientName:  r.client_name,
    clientPhone: r.client_phone,
    serviceName: r.service_name,
    totalPrice:  Number(r.service_price),
    date:        r.date,
    startTime:   r.start_time.slice(0, 5),
  }).catch(err => console.error('[whatsapp] notify cancel failed:', err))

  res.json({ id: r.id, status: r.status })
})

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}
