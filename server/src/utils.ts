import { pool } from './db.js'

export async function resolveTenant(slug: string): Promise<number | null> {
  const { rows } = await pool.query('SELECT id FROM tenants WHERE slug = $1', [slug])
  return rows[0]?.id ?? null
}
