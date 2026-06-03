import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authRouter } from './routes/auth.js'
import { appointmentsRouter } from './routes/appointments.js'
import { servicesRouter } from './routes/services.js'
import { dashboardRouter } from './routes/dashboard.js'
import { slotsRouter } from './routes/slots.js'
import { configRouter } from './routes/config.js'
import { blocksRouter } from './routes/blocks.js'
import { clientAuthRouter } from './routes/clientAuth.js'

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

app.use('/api/auth',         authRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/services',     servicesRouter)
app.use('/api/dashboard',    dashboardRouter)
app.use('/api/slots',        slotsRouter)
app.use('/api/config',       configRouter)
app.use('/api/blocks',       blocksRouter)
app.use('/api/client',       clientAuthRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.API_PORT ?? 3001
app.listen(PORT, () => {
  console.log(`[API] http://localhost:${PORT}`)
})
