import { Router } from 'express'
import { pool } from '../db.js'

export const clientAuthRouter = Router()

// POST /api/client/appointments — lookup por telefone (sem auth)
clientAuthRouter.post('/appointments', async (req, res) => {
  const { phone } = req.body as { phone: string }
  if (!phone) { res.status(400).json({ error: 'phone é obrigatório.' }); return }

  const digits   = phone.replace(/\D/g, '')
  const rawPhone = digits.length === 11 ? `55${digits}` : digits

  const { rows } = await pool.query(`
    SELECT
      a.id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
      c.name AS client_name,
      (a.services->0->>'id')::INT      AS service_id,
      a.services->0->>'name'           AS service_name,
      (a.services->0->>'duration')::INT AS service_duration,
      (a.services->0->>'price')::NUMERIC AS service_price,
      a.services->0->>'color'          AS service_color,
      a.services->0->>'emoji'          AS service_emoji,
      a.services AS all_services,
      a.total_price, a.total_duration,
      t.id AS studio_id, t.name AS studio_name, t.slug AS studio_slug
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN tenants   t ON t.id = a.tenant_id
    WHERE c.phone = $1
    ORDER BY a.date DESC, a.start_time DESC
  `, [rawPhone])

  // Retorna 200 sempre — não confirma se o telefone existe no sistema
  if (rows.length === 0) {
    res.json({ client_name: null, appointments: [] }); return
  }

  res.json({
    client_name: rows[0].client_name,
    appointments: rows.map(r => ({
      id:               r.id,
      date:             r.date,
      start_time:       r.start_time.slice(0, 5),
      end_time:         r.end_time.slice(0, 5),
      status:           r.status,
      service_id:       r.service_id,
      service_name:     r.service_name,
      service_duration: Number(r.service_duration),
      service_price:    Number(r.service_price),
      service_color:    r.service_color,
      service_emoji:    r.service_emoji,
      all_services:     r.all_services ?? [],
      total_price:      Number(r.total_price),
      total_duration:   Number(r.total_duration),
      studio_id:        r.studio_id,
      studio_name:      r.studio_name,
      studio_slug:      r.studio_slug,
    })),
  })
})
