import { pool } from './db.js'

export async function resolveStudio(slug: string): Promise<number | null> {
  const { rows } = await pool.query('SELECT id FROM studios WHERE slug = $1', [slug])
  return rows[0]?.id ?? null
}
