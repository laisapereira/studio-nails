import cron from 'node-cron'
import { pool } from '../db.js'
import { sendText, notifyClient } from './whatsapp.js'

const TZ            = 'America/Sao_Paulo'
const SITE_BASE_URL = process.env.SITE_BASE_URL

interface Studio { id: number; name: string; slug: string; phone: string }
interface ApptRow { start_time: string; end_time: string; client_name: string; all_service_names: string }

function todayBRT(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}

function fmtDatePT(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const days   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  return `${days[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2,'0')} de ${months[m-1]}`
}

async function studiosWithPhone(): Promise<Studio[]> {
  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.slug, sc.value AS phone
    FROM studios s
    JOIN studio_config sc ON sc.studio_id = s.id AND sc.key = 'notification_phone'
    WHERE sc.value IS NOT NULL AND sc.value <> ''
  `)
  return rows
}

async function todayAppts(studioId: number, fromTime?: string): Promise<ApptRow[]> {
  const today = todayBRT()
  const params: unknown[] = [studioId, today]
  let sql = `
    SELECT a.start_time::TEXT, a.end_time::TEXT, c.name AS client_name,
           COALESCE(
             (SELECT string_agg(sv.name, ' + ' ORDER BY aps.sort_order)
              FROM appointment_services aps
              JOIN services sv ON sv.id = aps.service_id
              WHERE aps.appointment_id = a.id),
             s.name
           ) AS all_service_names
    FROM appointments a
    JOIN clients  c ON c.id = a.client_id
    JOIN services s ON s.id = a.service_id
    WHERE a.studio_id = $1 AND a.date = $2 AND a.status <> 'cancelled'
  `
  if (fromTime) { params.push(fromTime); sql += ` AND a.start_time >= $${params.length}::TIME` }
  sql += ' ORDER BY a.start_time'
  const { rows } = await pool.query(sql, params)
  return rows
}

function adminLink(slug: string): string {
  return SITE_BASE_URL ? `\n👉 ${SITE_BASE_URL}/${slug}/admin` : ''
}

async function sendMorning() {
  const studios = await studiosWithPhone()
  for (const studio of studios) {
    try {
      const appts  = await todayAppts(studio.id)
      const link   = adminLink(studio.slug)
      if (appts.length === 0) {
        await sendText(studio.phone, `🌅 *Bom dia, ${studio.name}!*\nNenhum agendamento hoje. Bom descanso! 😊${link}`)
        continue
      }
      const dateStr = fmtDatePT(todayBRT())
      const lines   = appts.map(a => `*${a.start_time.slice(0,5)}* — ${a.client_name} (${a.all_service_names})`).join('\n')
      const msg = `🌅 *Bom dia, ${studio.name}!*\nSua agenda de hoje, ${dateStr}:\n\n${lines}\n\nTotal: ${appts.length} cliente${appts.length > 1 ? 's' : ''}${link}`
      await sendText(studio.phone, msg)
    } catch (err) {
      console.error(`[scheduledNotifs] 07:00 error — ${studio.slug}:`, err)
    }
  }
}

async function sendMidday() {
  const studios = await studiosWithPhone()
  for (const studio of studios) {
    try {
      const appts = await todayAppts(studio.id, '10:00')
      const link  = adminLink(studio.slug)
      if (appts.length === 0) {
        await sendText(studio.phone, `☀️ *${studio.name}* — sem mais clientes hoje. Aproveite! 🎉${link}`)
        continue
      }
      const lines = appts.map(a => `*${a.start_time.slice(0,5)}* — ${a.client_name}`).join('\n')
      await sendText(studio.phone, `☀️ *${studio.name}* — você tem mais ${appts.length} cliente${appts.length > 1 ? 's' : ''} hoje:\n\n${lines}${link}`)
    } catch (err) {
      console.error(`[scheduledNotifs] 10:00 error — ${studio.slug}:`, err)
    }
  }
}

async function sendEvening() {
  const studios = await studiosWithPhone()
  for (const studio of studios) {
    try {
      const appts = await todayAppts(studio.id, '17:30')
      const link  = adminLink(studio.slug)
      if (appts.length === 0) {
        await sendText(studio.phone, `🌆 *${studio.name}* — sem mais clientes por hoje! Bom descanso 🥂${link}`)
        continue
      }
      const last = appts[appts.length - 1]
      await sendText(studio.phone, `🌆 Sua última cliente de hoje é:\n👤 *${last.client_name}*\n✨ ${last.all_service_names}\n🕐 às ${last.start_time.slice(0,5)} → ${last.end_time.slice(0,5)}${link}`)
    } catch (err) {
      console.error(`[scheduledNotifs] 17:30 error — ${studio.slug}:`, err)
    }
  }
}

async function sendClientReminders() {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  const targetDate = d.toLocaleDateString('sv-SE', { timeZone: TZ })

  const { rows: studios } = await pool.query(`
    SELECT s.id, s.name, s.slug,
           MAX(CASE WHEN sc.key = 'notification_phone' THEN sc.value END) AS contact_phone
    FROM studios s
    LEFT JOIN studio_config sc ON sc.studio_id = s.id
    GROUP BY s.id, s.name, s.slug
  `)

  for (const studio of studios) {
    try {
      const { rows } = await pool.query(`
        SELECT a.id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT,
               c.name AS client_name, c.phone AS client_phone,
               COALESCE(
                 (SELECT string_agg(sv.name, ' + ' ORDER BY aps.sort_order)
                  FROM appointment_services aps
                  JOIN services sv ON sv.id = aps.service_id
                  WHERE aps.appointment_id = a.id),
                 s.name
               ) AS all_service_names,
               COALESCE(
                 (SELECT SUM(sv.price::numeric)
                  FROM appointment_services aps
                  JOIN services sv ON sv.id = aps.service_id
                  WHERE aps.appointment_id = a.id),
                 s.price
               ) AS total_price
        FROM appointments a
        JOIN clients c ON c.id = a.client_id
        JOIN services s ON s.id = a.service_id
        WHERE a.studio_id = $1 AND a.date = $2 AND a.status = 'confirmed'
        ORDER BY a.start_time
      `, [studio.id, targetDate])

      for (const appt of rows) {
        await notifyClient('reminder', {
          clientName:  appt.client_name,
          clientPhone: appt.client_phone,
          serviceName: appt.all_service_names,
          totalPrice:  Number(appt.total_price),
          date:        appt.date,
          startTime:   appt.start_time.slice(0, 5),
          endTime:     appt.end_time.slice(0, 5),
        }, appt.client_phone, studio.name, studio.contact_phone, studio.slug)
          .catch(err => console.error(`[clientReminder] appt ${appt.id}:`, err))
      }
    } catch (err) {
      console.error(`[clientReminder] studio ${studio.slug}:`, err)
    }
  }
}

export function startScheduledNotifs() {
  cron.schedule('0 7 * * 1-5',  sendMorning,        { timezone: TZ })
  cron.schedule('0 10 * * 1-5', sendMidday,          { timezone: TZ })
  cron.schedule('30 17 * * 1-5', sendEvening,        { timezone: TZ })
  cron.schedule('0 8 * * *',     sendClientReminders, { timezone: TZ })
  console.log('[scheduledNotifs] Crons registrados (07:00, 10:00, 17:30 admin + 08:00 lembrete clientes BRT)')
}
