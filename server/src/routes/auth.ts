import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export const authRouter = Router()

const JWT_SECRET  = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
const SALT_ROUNDS = 12

function makeToken(email: string, tenant_id: number, tenant_slug: string) {
  return jwt.sign({ email, role: 'admin', tenant_id, tenant_slug }, JWT_SECRET, { expiresIn: '7d' })
}

// GET /api/auth/status — verifica se existe algum admin (para redirecionar ao /setup)
authRouter.get('/status', async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) FROM users')
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

  const slugExists = await pool.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])
  if (slugExists.rows.length > 0) {
    res.status(409).json({ error: 'Esse slug já está em uso. Escolha outro.' }); return
  }

  const emailExists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase().trim()])
  if (emailExists.rows.length > 0) {
    res.status(409).json({ error: 'Esse e-mail já está cadastrado.' }); return
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

  const { rows: tenantRows } = await pool.query(
    'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, slug',
    [studio_name, slug]
  )
  const tenant = tenantRows[0]

  await pool.query(
    'INSERT INTO users (email, password_hash, tenant_id) VALUES ($1, $2, $3)',
    [email.toLowerCase().trim(), password_hash, tenant.id]
  )

  // work_days/work_start/work_end nascem dos DEFAULTs da tabela tenants

  await pool.query(
    `INSERT INTO services (tenant_id, name, duration, price, color, emoji, slug) VALUES
      ($1, 'Esmaltação Completa', 90,  40.00, '#A0522D', '💅', 'esmaltacao'),
      ($1, 'Pé Normal',          40,  25.00, '#8B4513', '🦶', 'pe-normal'),
      ($1, 'Mão Normal',         45,  20.00, '#C4956A', '✋', 'mao-normal'),
      ($1, 'Banho de Gel',       150, 80.00, '#6B3522', '✨', 'banho-gel'),
      ($1, 'Alongamento em Gel', 180, 120.00,'#3D1C0C', '💎', 'alongamento')
     ON CONFLICT DO NOTHING`,
    [tenant.id]
  )

  res.status(201).json({ token: makeToken(email, tenant.id, tenant.slug) })
})

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }

  if (!email || !password) { res.status(400).json({ error: 'E-mail e senha são obrigatórios.' }); return }

  const { rows } = await pool.query(
    `SELECT a.*, s.slug AS tenant_slug
     FROM users a JOIN tenants s ON s.id = a.tenant_id
     WHERE a.email = $1`,
    [email.toLowerCase().trim()]
  )
  if (!rows[0] || !await bcrypt.compare(password, rows[0].password_hash)) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' }); return
  }

  res.json({ token: makeToken(rows[0].email, rows[0].tenant_id, rows[0].tenant_slug) })
})

// POST /api/auth/change-password
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
  const email = req.admin!.email

  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'Nova senha deve ter ao menos 6 caracteres.' }); return
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  if (!rows[0]) { res.status(404).json({ error: 'Admin não encontrado.' }); return }

  if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) {
    res.status(401).json({ error: 'Senha atual incorreta.' }); return
  }

  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [password_hash, email])
  res.status(204).send()
})
