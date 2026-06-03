import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const vipRouter = Router()

// GET /api/vip
vipRouter.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT phone, name, note FROM vip_contacts WHERE studio_id = $1 ORDER BY name',
    [req.admin!.studio_id]
  )
  res.json({ contacts: rows })
})

// POST /api/vip
vipRouter.post('/', requireAuth, async (req, res) => {
  const { phone, name, note } = req.body as { phone: string; name: string; note?: string }
  if (!phone || !name) { res.status(400).json({ error: 'phone e name são obrigatórios.' }); return }

  const rawPhone = phone.replace(/\D/g, '')
  const { rows } = await pool.query(
    `INSERT INTO vip_contacts (studio_id, phone, name, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (studio_id, phone) DO UPDATE SET name = EXCLUDED.name, note = EXCLUDED.note
     RETURNING *`,
    [req.admin!.studio_id, rawPhone, name.trim(), note?.trim() ?? null]
  )
  res.status(201).json(rows[0])
})

// DELETE /api/vip/:phone
vipRouter.delete('/:phone', requireAuth, async (req, res) => {
  await pool.query(
    'DELETE FROM vip_contacts WHERE studio_id = $1 AND phone = $2',
    [req.admin!.studio_id, req.params.phone]
  )
  res.status(204).send()
})
