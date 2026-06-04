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
      s.id    AS service_id,   s.name  AS service_name,
      s.duration AS service_duration, s.price AS service_price,
      s.color AS service_color,       s.emoji AS service_emoji,
      st.id   AS studio_id,   st.name AS studio_name, st.slug AS studio_slug,
      COALESCE(
        (SELECT json_agg(json_build_object(
            'id', sv.id, 'name', sv.name,
            'price', sv.price, 'emoji', sv.emoji,
            'duration', sv.duration
          ) ORDER BY aps.sort_order)
         FROM appointment_services aps
         JOIN services sv ON sv.id = aps.service_id
         WHERE aps.appointment_id = a.id),
        json_build_array(json_build_object(
            'id', s.id, 'name', s.name,
            'price', s.price, 'emoji', s.emoji,
            'duration', s.duration
        ))
      ) AS all_services
    FROM appointments a
    JOIN clients  c  ON c.id  = a.client_id
    JOIN services s  ON s.id  = a.service_id
    JOIN studios  st ON st.id = a.studio_id
    WHERE c.phone = $1 AND a.status <> 'cancelled'
    ORDER BY a.date DESC, a.start_time DESC
  `, [rawPhone])

  if (rows.length === 0) {
    res.status(404).json({ error: 'Nenhum agendamento encontrado para esse telefone.' }); return
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
      studio_id:        r.studio_id,
      studio_name:      r.studio_name,
      studio_slug:      r.studio_slug,
    })),
  })
})
