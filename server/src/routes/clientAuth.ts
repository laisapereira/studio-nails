import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { pool } from '../db.js'

export const clientAuthRouter = Router()

const JWT_SECRET  = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
const SALT_ROUNDS = 12

function makeClientToken(id: string, phone: string) {
  return jwt.sign({ client_account_id: id, phone, role: 'client' }, JWT_SECRET, { expiresIn: '30d' })
}

function requireClientAuth(req: any, res: any, next: any) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Token obrigatório.' }); return }
  try {
    req.clientAccount = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido.' })
  }
}

// POST /api/client/register
clientAuthRouter.post('/register', async (req, res) => {
  const { email, password, phone } = req.body as { email: string; password: string; phone: string }

  if (!email || !password || !phone) {
    res.status(400).json({ error: 'email, password e phone são obrigatórios.' }); return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' }); return
  }

  const rawPhone      = phone.replace(/\D/g, '')
  const normalEmail   = email.toLowerCase().trim()
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

  const conflict = await pool.query(
    'SELECT id FROM client_accounts WHERE email = $1 OR phone = $2',
    [normalEmail, rawPhone]
  )
  if (conflict.rows.length > 0) {
    res.status(409).json({ error: 'E-mail ou telefone já cadastrado.' }); return
  }

  const { rows } = await pool.query(
    'INSERT INTO client_accounts (phone, email, password_hash) VALUES ($1, $2, $3) RETURNING id, phone',
    [rawPhone, normalEmail, password_hash]
  )
  res.status(201).json({ token: makeClientToken(rows[0].id, rows[0].phone) })
})

// POST /api/client/login
clientAuthRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }

  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios.' }); return
  }

  const { rows } = await pool.query(
    'SELECT id, phone, password_hash FROM client_accounts WHERE email = $1',
    [email.toLowerCase().trim()]
  )
  if (!rows[0] || !await bcrypt.compare(password, rows[0].password_hash)) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' }); return
  }

  res.json({ token: makeClientToken(rows[0].id, rows[0].phone) })
})

// GET /api/client/me/appointments — todos os agendamentos da cliente, agrupados por estúdio
clientAuthRouter.get('/me/appointments', requireClientAuth, async (req, res) => {
  const { phone } = req.clientAccount!

  const { rows } = await pool.query(`
    SELECT
      a.id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT, a.status,
      s.id    AS service_id,   s.name  AS service_name,
      s.duration AS service_duration, s.price AS service_price,
      s.color AS service_color,       s.emoji AS service_emoji,
      st.id   AS studio_id,   st.name AS studio_name, st.slug AS studio_slug
    FROM appointments a
    JOIN clients  c  ON c.id  = a.client_id
    JOIN services s  ON s.id  = a.service_id
    JOIN studios  st ON st.id = a.studio_id
    WHERE c.phone = $1 AND a.status <> 'cancelled'
    ORDER BY a.date DESC, a.start_time DESC
  `, [phone])

  res.json({
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
      studio_id:        r.studio_id,
      studio_name:      r.studio_name,
      studio_slug:      r.studio_slug,
    })),
  })
})
