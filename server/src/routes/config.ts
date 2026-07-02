import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveStudio } from '../utils.js'

export const configRouter = Router()

// GET /api/config?studio=SLUG — público
configRouter.get('/', async (req, res) => {
  const { studio } = req.query as Record<string, string>
  if (!studio) { res.status(400).json({ error: 'Parâmetro studio é obrigatório.' }); return }

  const { rows: sRows } = await pool.query('SELECT id, name, slug FROM studios WHERE slug = $1', [studio])
  if (!sRows[0]) { res.status(404).json({ error: 'Estúdio não encontrado.' }); return }

  const { rows } = await pool.query('SELECT key, value FROM studio_config WHERE studio_id = $1', [sRows[0].id])
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    studio_name: sRows[0].name,
    studio_slug: sRows[0].slug,
    work_days:   (map.work_days ?? '1,2,3,4,5').split(',').map(Number),
    work_start:   map.work_start ?? '09:00',
    work_end:     map.work_end   ?? '18:00',
  })
})

// GET /api/config/me — admin (usa JWT)
configRouter.get('/me', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT name, slug FROM studios WHERE id = $1', [req.admin!.studio_id])
  const { rows } = await pool.query('SELECT key, value FROM studio_config WHERE studio_id = $1', [req.admin!.studio_id])
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    studio_name:        sRows[0]?.name ?? '',
    studio_slug:        sRows[0]?.slug ?? '',
    work_days:          (map.work_days ?? '1,2,3,4,5').split(',').map(Number),
    work_start:          map.work_start         ?? '09:00',
    work_end:            map.work_end           ?? '18:00',
    notification_phone:  map.notification_phone ?? '',
  })
})

// PATCH /api/config — admin
configRouter.patch('/', requireAuth, async (req, res) => {
  const { work_days, work_start, work_end, notification_phone } = req.body as {
    work_days?: number[]; work_start?: string; work_end?: string; notification_phone?: string
  }
  const studioId = req.admin!.studio_id

  const updates: { key: string; value: string }[] = []
  if (work_days          != null) updates.push({ key: 'work_days',          value: work_days.join(',') })
  if (work_start         != null) updates.push({ key: 'work_start',         value: work_start })
  if (work_end           != null) updates.push({ key: 'work_end',           value: work_end })
  if (notification_phone != null) updates.push({ key: 'notification_phone', value: notification_phone.replace(/\D/g, '') })

  for (const u of updates) {
    await pool.query(
      `INSERT INTO studio_config (studio_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (studio_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [studioId, u.key, u.value]
    )
  }
  res.status(204).send()
})
