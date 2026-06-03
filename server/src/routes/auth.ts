import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const authRouter = Router()

const JWT_SECRET  = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
const SALT_ROUNDS = 12

function makeToken(email: string, studio_id: number, studio_slug: string) {
  return jwt.sign({ email, role: 'admin', studio_id, studio_slug }, JWT_SECRET, { expiresIn: '7d' })
}

// GET /api/auth/status — verifica se existe algum admin (para redirecionar ao /setup)
authRouter.get('/status', async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) FROM admins')
  res.json({ setup: Number(rows[0].count) === 0 })
})

// POST /api/auth/setup — cria novo estúdio + primeiro admin
authRouter.post('/setup', async (req, res) => {
  const { email, password, studio_name, slug } = req.body as {
    email: string; password: string; studio_name: string; slug: string
  }

  if (!email || !password || !studio_name || !slug) {
    res.status(400).json({ error: 'email, password, studio_name e slug são obrigatórios.' }); return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' }); return
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ error: 'Slug deve conter apenas letras minúsculas, números e hífens.' }); return
  }

  const slugExists = await pool.query('SELECT 1 FROM studios WHERE slug = $1', [slug])
  if (slugExists.rows.length > 0) {
    res.status(409).json({ error: 'Esse slug já está em uso. Escolha outro.' }); return
  }

  const emailExists = await pool.query('SELECT 1 FROM admins WHERE email = $1', [email.toLowerCase().trim()])
  if (emailExists.rows.length > 0) {
    res.status(409).json({ error: 'Esse e-mail já está cadastrado.' }); return
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

  const { rows: studioRows } = await pool.query(
    'INSERT INTO studios (name, slug) VALUES ($1, $2) RETURNING id, slug',
    [studio_name, slug]
  )
  const studio = studioRows[0]

  await pool.query(
    'INSERT INTO admins (email, password_hash, studio_id) VALUES ($1, $2, $3)',
    [email.toLowerCase().trim(), password_hash, studio.id]
  )

  // Seed config padrão para o novo estúdio
  await pool.query(
    `INSERT INTO studio_config (studio_id, key, value) VALUES
      ($1, 'work_days',  '1,2,3,4,5'),
      ($1, 'work_start', '09:00'),
      ($1, 'work_end',   '18:00')
     ON CONFLICT DO NOTHING`,
    [studio.id]
  )

  res.status(201).json({ token: makeToken(email, studio.id, studio.slug) })
})

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }

  if (!email || !password) { res.status(400).json({ error: 'E-mail e senha são obrigatórios.' }); return }

  const { rows } = await pool.query(
    `SELECT a.*, s.slug AS studio_slug
     FROM admins a JOIN studios s ON s.id = a.studio_id
     WHERE a.email = $1`,
    [email.toLowerCase().trim()]
  )
  if (!rows[0] || !await bcrypt.compare(password, rows[0].password_hash)) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' }); return
  }

  res.json({ token: makeToken(rows[0].email, rows[0].studio_id, rows[0].studio_slug) })
})

// POST /api/auth/change-password
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
  const email = req.admin!.email

  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'Nova senha deve ter ao menos 6 caracteres.' }); return
  }

  const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [email])
  if (!rows[0]) { res.status(404).json({ error: 'Admin não encontrado.' }); return }

  if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) {
    res.status(401).json({ error: 'Senha atual incorreta.' }); return
  }

  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await pool.query('UPDATE admins SET password_hash = $1 WHERE email = $2', [password_hash, email])
  res.status(204).send()
})
