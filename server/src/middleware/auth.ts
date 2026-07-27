import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../db.js'

declare global {
  namespace Express {
    interface Request {
      admin?: { email: string; role: string; tenant_id: number; tenant_slug: string }
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
        email: string; role: string
        tenant_id?: number; tenant_slug?: string
        // claims legados — tokens emitidos antes da migration 003 (7d de vida);
        // remover o fallback quando expirarem
        studio_id?: number; studio_slug?: string
      }
      const tenantId   = payload.tenant_id   ?? payload.studio_id
      const tenantSlug = payload.tenant_slug ?? payload.studio_slug
      if (tenantId == null || !tenantSlug) {
        res.status(401).json({ error: 'Token inválido' }); return
      }
      req.admin = { email: payload.email, role: payload.role, tenant_id: tenantId, tenant_slug: tenantSlug }
      // Contexto RLS: seta numa conexão aleatória do pool — defesa em
      // profundidade, não isolamento confiável por request
      pool.query(`SELECT set_config('app.tenant_id', $1, FALSE)`, [String(tenantId)]).catch(() => {})
      next(); return
    } catch {
      res.status(401).json({ error: 'Token inválido' }); return
    }
  }

  res.status(401).json({ error: 'Não autorizado' })
}
