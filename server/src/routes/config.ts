import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const configRouter = Router()

// GET /api/config?studio=SLUG — público
configRouter.get('/', async (req, res) => {
  const { studio } = req.query as Record<string, string>
  if (!studio) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }

  const { rows } = await pool.query(
    'SELECT name, slug, work_days, work_start::TEXT, work_end::TEXT FROM tenants WHERE slug = $1',
    [studio]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

  res.json({
    studio_name: rows[0].name,
    studio_slug: rows[0].slug,
    work_days:   rows[0].work_days.split(',').map(Number),
    work_start:  rows[0].work_start.slice(0, 5),
    work_end:    rows[0].work_end.slice(0, 5),
  })
})

// GET /api/config/me — admin (usa JWT)
configRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT name, slug, work_days, work_start::TEXT, work_end::TEXT, notification_phone FROM tenants WHERE id = $1',
    [req.admin!.tenant_id]
  )
  const t = rows[0]
  res.json({
    studio_name:        t?.name ?? '',
    studio_slug:        t?.slug ?? '',
    work_days:          (t?.work_days ?? '1,2,3,4,5').split(',').map(Number),
    work_start:         (t?.work_start ?? '09:00').slice(0, 5),
    work_end:           (t?.work_end   ?? '18:00').slice(0, 5),
    notification_phone: t?.notification_phone ?? '',
  })
})

// PATCH /api/config — admin
configRouter.patch('/', requireAuth, async (req, res) => {
  const { work_days, work_start, work_end, notification_phone } = req.body as {
    work_days?: number[]; work_start?: string; work_end?: string; notification_phone?: string
  }

  await pool.query(
    `UPDATE tenants SET
       work_days          = COALESCE($1, work_days),
       work_start         = COALESCE($2::TIME, work_start),
       work_end           = COALESCE($3::TIME, work_end),
       notification_phone = COALESCE($4, notification_phone)
     WHERE id = $5`,
    [
      work_days != null ? work_days.join(',') : null,
      work_start ?? null,
      work_end ?? null,
      notification_phone != null ? notification_phone.replace(/\D/g, '') : null,
      req.admin!.tenant_id,
    ]
  )
  res.status(204).send()
})
