import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveTenant } from '../utils.js'
import { notifyAppt, notifyClient } from '../lib/whatsapp.js'

export const appointmentsRouter = Router()

// all_service_names a partir do snapshot JSONB, preservando a ordem escolhida
const ALL_SERVICE_NAMES_SQL = `
  (SELECT string_agg(e.value->>'name', ' + ' ORDER BY e.ordinality)
   FROM jsonb_array_elements(a.services) WITH ORDINALITY e)`

async function tenantMeta(tenantId: number): Promise<{
  slug: string; notifPhone: string | null; tenantName: string; instance: string | null
}> {
  const { rows } = await pool.query(`
    SELECT t.slug, t.name AS tenant_name, t.whatsapp_instance, tc.value AS notif_phone
    FROM tenants t
    LEFT JOIN tenant_config tc ON tc.tenant_id = t.id AND tc.key = 'notification_phone'
    WHERE t.id = $1
  `, [tenantId])
  return {
    slug:       rows[0]?.slug ?? '',
    notifPhone: rows[0]?.notif_phone ?? null,
    tenantName: rows[0]?.tenant_name ?? '',
    instance:   rows[0]?.whatsapp_instance ?? null,
  }
}

// GET /api/appointments — admin, scoped to tenant
appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const { start, end, status, phone } = req.query as Record<string, string>
  const tenantId = req.admin!.tenant_id

  let sql = `
    SELECT a.id,
      a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
      c.name  AS client_name, c.phone AS client_phone,
      (a.services->0->>'id')::INT        AS service_id,
      a.services->0->>'name'             AS service_name,
      (a.services->0->>'duration')::INT  AS service_duration,
      (a.services->0->>'price')::NUMERIC AS service_price,
      a.services->0->>'color'            AS service_color,
      a.services->0->>'emoji'            AS service_emoji,
      a.total_price, a.total_duration,
      a.created_via, a.notes,
      ${ALL_SERVICE_NAMES_SQL} AS all_service_names
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    WHERE a.tenant_id = $1
  `
  const params: unknown[] = [tenantId]

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
      service:      null,
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
      total_price:       Number(r.total_price),
      total_duration:    Number(r.total_duration),
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

    const tenantId = await resolveTenant(studio)
    if (!tenantId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

    const rawPhone = phone.replace(/\D/g, '')
    let sql = `
      SELECT a.id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
             a.services->0->>'name'             AS service_name,
             (a.services->0->>'duration')::INT  AS service_duration,
             (a.services->0->>'price')::NUMERIC AS service_price,
             a.total_price, a.total_duration,
             ${ALL_SERVICE_NAMES_SQL} AS all_service_names
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.tenant_id = $1 AND c.phone = $2
    `
    const params: unknown[] = [tenantId, rawPhone]

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

  // Resolve tenant (contrato HTTP mantém os nomes studio/studio_id)
  let tenantId: number | null = null
  if (studio_id) { tenantId = Number(studio_id) }
  else if (studio) { tenantId = await resolveTenant(studio) }
  if (!tenantId) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }

  // Resolve serviços — aceita service_ids[] (multi), service_id ou service (slug)
  const SVC_COLS = 'id, slug, name, duration, price, emoji, color, reminder_days_before'
  let svcs: any[]

  if (service_ids && Array.isArray(service_ids) && service_ids.length > 0) {
    const ids = service_ids.map(Number)
    const { rows } = await pool.query(
      `SELECT ${SVC_COLS} FROM services WHERE id = ANY($1) AND tenant_id = $2 AND active = true ORDER BY id`,
      [ids, tenantId]
    )
    if (rows.length !== ids.length) { res.status(400).json({ error: 'Um ou mais serviços não encontrados.' }); return }
    svcs = rows
  } else {
    let svcRow
    if (service)    { svcRow = await pool.query(`SELECT ${SVC_COLS} FROM services WHERE slug = $1 AND tenant_id = $2 AND active = true`, [service, tenantId]) }
    else if (service_id) { svcRow = await pool.query(`SELECT ${SVC_COLS} FROM services WHERE id = $1 AND tenant_id = $2 AND active = true`, [service_id, tenantId]) }
    else { res.status(400).json({ error: 'Informe service, service_id ou service_ids.' }); return }
    if (!svcRow.rows[0]) { res.status(400).json({ error: 'Serviço não encontrado ou inativo.' }); return }
    svcs = [svcRow.rows[0]]
  }

  // Snapshot congelado no momento do booking (histórico não muda se o serviço mudar)
  const snapshot = svcs.map((s: any) => ({
    id: s.id, name: s.name, price: Number(s.price),
    duration: s.duration, emoji: s.emoji, color: s.color,
  }))
  const totalDuration  = snapshot.reduce((sum, s) => sum + s.duration, 0)
  const totalPrice     = snapshot.reduce((sum, s) => sum + s.price, 0)
  const reminderDays   = Math.max(...svcs.map((s: any) => s.reminder_days_before))
  const primarySvcSlug = svcs[0].slug
  const primarySvcName = snapshot.map(s => s.name).join(' + ')

  const endTime = addMinutes(start_time, totalDuration)

  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')

    // Customer global: mesma pessoa em N tenants (tenant_ids é a lista)
    const customerRes = await conn.query(
      `INSERT INTO customers (name, phone, tenant_ids) VALUES ($2, $3, ARRAY[$1::INT])
       ON CONFLICT (phone) DO UPDATE SET
         name = EXCLUDED.name,
         tenant_ids = CASE WHEN $1::INT = ANY(customers.tenant_ids)
                           THEN customers.tenant_ids
                           ELSE array_append(customers.tenant_ids, $1::INT) END
       RETURNING id`,
      [tenantId, clientName.trim(), rawPhone]
    )
    const customerId = customerRes.rows[0].id

    const { rows } = await conn.query(
      `INSERT INTO appointments (tenant_id, customer_id, services, total_price, total_duration,
                                 date, start_time, end_time, created_via, reminder_date)
       SELECT $1, $2, $3::JSONB, $4, $5, $6, $7::TIME, $8::TIME, $9, $6::DATE - $10::INT
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments
         WHERE tenant_id = $1 AND date = $6 AND status <> 'cancelled'
           AND start_time < $8::TIME AND end_time > $7::TIME
       )
       RETURNING id`,
      [tenantId, customerId, JSON.stringify(snapshot), totalPrice, totalDuration,
       date, start_time, endTime, created_via ?? 'api', reminderDays]
    )

    if (rows.length === 0) { await conn.query('ROLLBACK'); res.status(409).json({ error: 'Horário já ocupado.' }); return }

    let oldDate: string | null = null
    let oldStartTime: string | null = null
    if (reschedule_id) {
      const { rows: oldRows } = await conn.query(
        `UPDATE appointments SET status = 'cancelled'
         WHERE id = $1 AND customer_id = $2 AND status <> 'cancelled'
         RETURNING date::TEXT, start_time::TEXT`,
        [reschedule_id, customerId]
      )
      if (oldRows[0]) {
        oldDate      = oldRows[0].date
        oldStartTime = oldRows[0].start_time.slice(0, 5)
      }
    }

    const apptId = rows[0].id

    await conn.query('COMMIT')

    tenantMeta(tenantId).then(({ slug, notifPhone, tenantName, instance }) => {
      const apptData = {
        clientName:  clientName.trim(),
        clientPhone: rawPhone,
        serviceName: primarySvcName,
        totalPrice,
        date,
        startTime:   start_time.slice(0, 5),
        endTime,
        ...(reschedule_id && oldDate ? { oldDate, oldStartTime: oldStartTime ?? undefined } : {}),
      }
      const meta = { tenantId: tenantId!, kind: 'notification' as const, customerId, appointmentId: apptId, instance }
      if (notifPhone) {
        notifyAppt(reschedule_id ? 'reschedule' : 'new', apptData, notifPhone, slug, meta)
          .catch(err => console.error('[whatsapp] notify admin failed:', err))
      }
      notifyClient(reschedule_id ? 'rescheduled' : 'confirmed', apptData, rawPhone, tenantName, notifPhone, slug, meta)
        .catch(err => console.error('[whatsapp] notify client failed:', err))
    }).catch(() => {})

    res.status(201).json({ id: apptId, status: 'confirmed', service: primarySvcSlug, date, start_time: start_time.slice(0,5), end_time: endTime })
  } catch (e) {
    await conn.query('ROLLBACK')
    throw e
  } finally {
    conn.release()
  }
})

// PATCH /api/appointments/:id/cancel — admin (JWT) ou bot (apikey + studio no body)
appointmentsRouter.patch('/:id/cancel', requireAuth, async (req, res) => {
  const { reason, studio } = req.body as { reason?: string; studio?: string }

  let tenantId = req.admin?.tenant_id
  if (!tenantId) {
    if (!studio) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }
    const resolved = await resolveTenant(studio)
    if (!resolved) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }
    tenantId = resolved
  }

  const { rows } = await pool.query(
    `UPDATE appointments SET status = 'cancelled', notes = COALESCE($1, notes)
     WHERE id = $2 AND tenant_id = $3
     RETURNING id, status, date::TEXT, start_time::TEXT, customer_id, total_price,
       (SELECT name  FROM customers WHERE id = customer_id) AS client_name,
       (SELECT phone FROM customers WHERE id = customer_id) AS client_phone,
       (SELECT string_agg(e.value->>'name', ' + ' ORDER BY e.ordinality)
        FROM jsonb_array_elements(services) WITH ORDINALITY e) AS service_name`,
    [reason ?? null, req.params.id, tenantId]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Agendamento não encontrado.' }); return }
  const r = rows[0]

  tenantMeta(tenantId).then(({ slug, notifPhone, instance }) => {
    if (!notifPhone) return
    notifyAppt('cancel', {
      clientName:  r.client_name,
      clientPhone: r.client_phone,
      serviceName: r.service_name,
      totalPrice:  Number(r.total_price),
      date:        r.date,
      startTime:   r.start_time.slice(0, 5),
    }, notifPhone, slug, {
      tenantId: tenantId!, kind: 'notification', customerId: r.customer_id, appointmentId: r.id, instance,
    }).catch(err => console.error('[whatsapp] notify cancel failed:', err))
  }).catch(() => {})

  res.json({ id: r.id, status: r.status })
})

// PATCH /api/appointments/:id/client-cancel — público, verificado pelo telefone da cliente
appointmentsRouter.patch('/:id/client-cancel', async (req, res) => {
  const { phone } = req.body as { phone?: string }
  if (!phone) { res.status(400).json({ error: 'Telefone obrigatório.' }); return }

  const digits   = phone.replace(/\D/g, '')
  const rawPhone = digits.length === 11 ? `55${digits}` : digits

  const { rows } = await pool.query(
    `UPDATE appointments a
     SET status = 'cancelled'
     FROM customers c
     WHERE a.id = $1
       AND a.status <> 'cancelled'
       AND a.customer_id = c.id
       AND (c.phone = $2 OR c.phone = RIGHT($2, 11) OR c.phone = '55' || RIGHT($2, 11))
     RETURNING a.id, a.tenant_id, a.customer_id, a.date::TEXT, a.start_time::TEXT, a.total_price,
       c.name  AS client_name,
       c.phone AS client_phone,
       (SELECT string_agg(e.value->>'name', ' + ' ORDER BY e.ordinality)
        FROM jsonb_array_elements(a.services) WITH ORDINALITY e) AS service_name`,
    [req.params.id, rawPhone]
  )

  if (!rows[0]) { res.status(404).json({ error: 'Agendamento não encontrado ou telefone inválido.' }); return }

  const r = rows[0]
  tenantMeta(r.tenant_id).then(({ slug, notifPhone, tenantName, instance }) => {
    const apptData = {
      clientName:  r.client_name,
      clientPhone: r.client_phone,
      serviceName: r.service_name,
      totalPrice:  Number(r.total_price),
      date:        r.date,
      startTime:   r.start_time.slice(0, 5),
    }
    const meta = { tenantId: r.tenant_id, kind: 'notification' as const, customerId: r.customer_id, appointmentId: r.id, instance }
    if (notifPhone) {
      notifyAppt('client_cancel', apptData, notifPhone, slug, meta)
        .catch(err => console.error('[whatsapp] notify admin client_cancel failed:', err))
    }
    notifyClient('client_cancelled', apptData, r.client_phone, tenantName, notifPhone, slug, meta)
      .catch(err => console.error('[whatsapp] notify client cancel confirm failed:', err))
  }).catch(() => {})

  res.json({ id: r.id, status: 'cancelled' })
})

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}
