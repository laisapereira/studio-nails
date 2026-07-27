import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const blocksRouter = Router()

blocksRouter.get('/', requireAuth, async (req, res) => {
  const { start, end } = req.query as Record<string, string>
  const { rows } = await pool.query(
    `SELECT * FROM time_blocks
     WHERE tenant_id = $1
       AND ($2::DATE IS NULL OR end_date >= $2::DATE)
       AND ($3::DATE IS NULL OR start_date <= $3::DATE)
     ORDER BY start_date, start_time`,
    [req.admin!.tenant_id, start ?? null, end ?? null]
  )
  res.json({ blocks: rows })
})

blocksRouter.post('/', requireAuth, async (req, res) => {
  const { start_date, end_date, start_time, end_time, reason } = req.body as {
    start_date: string; end_date: string; start_time: string; end_time: string; reason: string
  }
  if (!start_date || !end_date || !start_time || !end_time) {
    res.status(400).json({ error: 'start_date, end_date, start_time e end_time são obrigatórios.' }); return
  }
  const { rows } = await pool.query(
    `INSERT INTO time_blocks (tenant_id, start_date, end_date, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.admin!.tenant_id, start_date, end_date, start_time, end_time, reason ?? 'Bloqueado']
  )
  res.status(201).json(rows[0])
})

blocksRouter.delete('/:id', requireAuth, async (req, res) => {
  await pool.query(
    'DELETE FROM time_blocks WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.admin!.tenant_id]
  )
  res.status(204).send()
})
