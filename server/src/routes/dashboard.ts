import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const dashboardRouter = Router()

dashboardRouter.get('/stats', requireAuth, async (req, res) => {
  const { start, end } = req.query as Record<string, string>
  const studioId = req.admin!.studio_id

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                          AS total_appointments,
       COALESCE(SUM(s.price), 0)                        AS total_revenue,
       COALESCE(SUM(s.duration), 0)                     AS total_minutes,
       COUNT(*) FILTER (WHERE a.status = 'confirmed')   AS confirmed,
       COUNT(*) FILTER (WHERE a.status = 'completed')   AS completed,
       COUNT(*) FILTER (WHERE a.status = 'cancelled')   AS cancelled
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.studio_id = $1
       AND ($2::DATE IS NULL OR a.date >= $2)
       AND ($3::DATE IS NULL OR a.date <= $3)`,
    [studioId, start ?? null, end ?? null]
  )

  const row = rows[0]
  res.json({
    totalAppointments: Number(row.total_appointments),
    totalRevenue:      Number(row.total_revenue),
    totalHours:        Number(row.total_minutes) / 60,
    confirmed:         Number(row.confirmed),
    completed:         Number(row.completed),
    cancelled:         Number(row.cancelled),
  })
})

dashboardRouter.get('/upcoming', requireAuth, async (req, res) => {
  const limit = parseInt((req.query.limit as string) ?? '5', 10)
  const { rows } = await pool.query(
    `SELECT * FROM appointments_full
     WHERE studio_id = $1 AND date >= CURRENT_DATE AND status <> 'cancelled'
     ORDER BY date, start_time LIMIT $2`,
    [req.admin!.studio_id, limit]
  )
  res.json(rows)
})
