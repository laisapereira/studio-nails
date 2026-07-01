import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import { authRouter } from './routes/auth.js'
import { appointmentsRouter } from './routes/appointments.js'
import { servicesRouter } from './routes/services.js'
import { dashboardRouter } from './routes/dashboard.js'
import { slotsRouter } from './routes/slots.js'
import { configRouter } from './routes/config.js'
import { blocksRouter } from './routes/blocks.js'
import { clientAuthRouter } from './routes/clientAuth.js'
import { vipRouter }        from './routes/vip.js'

// ── Validações de startup ─────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET não está definido. Defina a variável de ambiente antes de iniciar.')
  process.exit(1)
}

const app = express()

app.set('trust proxy', 1)

// ── CORS — apenas origens permitidas ─────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : []

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (curl, mobile apps, Postman, n8n)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`Origin não permitida: ${origin}`))
  },
  credentials: true,
}))

app.use(express.json())

// ── Rate limiting ─────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
})

const clientLookupLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas consultas. Tente novamente em 1 minuto.' },
})

app.use('/api/auth',   authLimiter)
app.use('/api/client', clientLookupLimiter)

// ── Rotas ─────────────────────────────────────────────────────
app.use('/api/auth',         authRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/services',     servicesRouter)
app.use('/api/dashboard',    dashboardRouter)
app.use('/api/slots',        slotsRouter)
app.use('/api/config',       configRouter)
app.use('/api/blocks',       blocksRouter)
app.use('/api/client',       clientAuthRouter)
app.use('/api/vip',          vipRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.API_PORT ?? 3001
app.listen(PORT, () => {
  console.log(`[API] http://localhost:${PORT}`)
})
