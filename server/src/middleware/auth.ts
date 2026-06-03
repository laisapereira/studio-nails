import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

declare global {
  namespace Express {
    interface Request {
      admin?:  { email: string; role: string; studio_id: number; studio_slug: string }
      clientAccount?: { client_account_id: string; phone: string; role: 'client' }
    }
  }
}

export function botAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-api-key'] === process.env.BOT_API_KEY) { next(); return }
  res.status(401).json({ error: 'Não autorizado' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const botKey = req.headers['apikey']

  if (botKey && botKey === process.env.BOT_API_KEY) {
    next(); return
  }

  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7)
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'fallback-secret') as {
        email: string; role: string; studio_id: number; studio_slug: string
      }
      req.admin = payload
      next(); return
    } catch {
      res.status(401).json({ error: 'Token inválido' }); return
    }
  }

  res.status(401).json({ error: 'Não autorizado' })
}
