import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveTenant } from '../utils.js'

export const servicesRouter = Router()

// GET /api/services?studio=SLUG — público (booking page + bot)
servicesRouter.get('/', async (req, res) => {
  const { studio } = req.query as Record<string, string>
  if (!studio) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }

  const tenantId = await resolveTenant(studio)
  if (!tenantId) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

  const { rows } = await pool.query(
    'SELECT id, slug, name, duration, price, color, emoji FROM services WHERE tenant_id = $1 AND active = true ORDER BY id',
    [tenantId]
  )
  res.json({
    services: rows.map(r => ({
      id:               r.slug ?? String(r.id),
      numeric_id:       r.id,
      name:             r.name,
      duration_minutes: r.duration,
      price:            Number(r.price),
      color:            r.color,
      emoji:            r.emoji,
    })),
  })
})

// GET /api/services/all — admin (inclui inativos)
servicesRouter.get('/all', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM services WHERE tenant_id = $1 ORDER BY id',
    [req.admin!.tenant_id]
  )
  res.json(rows)
})

// POST /api/services — admin
servicesRouter.post('/', requireAuth, async (req, res) => {
  const { name, duration, price, color, emoji, slug, reminder_days_before } = req.body
  const { rows } = await pool.query(
    `INSERT INTO services (tenant_id, name, duration, price, color, emoji, slug, reminder_days_before)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.admin!.tenant_id, name, duration, price, color ?? '#C4956A', emoji ?? '💅', slug ?? null, reminder_days_before ?? 2]
  )
  res.status(201).json(rows[0])
})

// PATCH /api/services/:id — admin
servicesRouter.patch('/:id', requireAuth, async (req, res) => {
  const { name, duration, price, color, emoji, active, slug, reminder_days_before } = req.body
  const { rows } = await pool.query(
    `UPDATE services
     SET name     = COALESCE($1, name),
         duration = COALESCE($2, duration),
         price    = COALESCE($3, price),
         color    = COALESCE($4, color),
         emoji    = COALESCE($5, emoji),
         active   = COALESCE($6, active),
         slug     = COALESCE($7, slug),
         reminder_days_before = COALESCE($8, reminder_days_before)
     WHERE id = $9 AND tenant_id = $10 RETURNING *`,
    [name, duration, price, color, emoji, active, slug, reminder_days_before, req.params.id, req.admin!.tenant_id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Serviço não encontrado.' }); return }
  res.json(rows[0])
})

// DELETE /api/services/:id — soft delete, admin
servicesRouter.delete('/:id', requireAuth, async (req, res) => {
  await pool.query(
    'UPDATE services SET active = false WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.admin!.tenant_id]
  )
  res.status(204).send()
})
