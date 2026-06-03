import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const blocksRouter = Router()

blocksRouter.get('/', requireAuth, async (req, res) => {
  const { start, end } = req.query as Record<string, string>
  const { rows } = await pool.query(
    `SELECT * FROM time_blocks
     WHERE studio_id = $1
       AND ($2::DATE IS NULL OR date >= $2::DATE)
       AND ($3::DATE IS NULL OR date <= $3::DATE)
     ORDER BY date, start_time`,
    [req.admin!.studio_id, start ?? null, end ?? null]
  )
  res.json({ blocks: rows })
})

blocksRouter.post('/', requireAuth, async (req, res) => {
  const { date, start_time, end_time, reason } = req.body as {
    date: string; start_time: string; end_time: string; reason: string
  }
  if (!date || !start_time || !end_time) {
    res.status(400).json({ error: 'date, start_time e end_time são obrigatórios.' }); return
  }
  const { rows } = await pool.query(
    `INSERT INTO time_blocks (studio_id, date, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.admin!.studio_id, date, start_time, end_time, reason ?? 'Bloqueado']
  )
  res.status(201).json(rows[0])
})

blocksRouter.delete('/:id', requireAuth, async (req, res) => {
  await pool.query(
    'DELETE FROM time_blocks WHERE id = $1 AND studio_id = $2',
    [req.params.id, req.admin!.studio_id]
  )
  res.status(204).send()
})
