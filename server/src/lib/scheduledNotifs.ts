import cron from 'node-cron'
import { pool } from '../db.js'
import { sendText, notifyClient } from './whatsapp.js'
import type { SendMeta } from './whatsapp.js'

const TZ            = 'America/Sao_Paulo'
const SITE_BASE_URL = process.env.SITE_BASE_URL

interface Tenant { id: number; name: string; slug: string; phone: string; whatsapp_instance: string | null }
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

async function tenantsWithPhone(): Promise<Tenant[]> {
  const { rows } = await pool.query(`
    SELECT t.id, t.name, t.slug, t.whatsapp_instance, tc.value AS phone
    FROM tenants t
    JOIN tenant_config tc ON tc.tenant_id = t.id AND tc.key = 'notification_phone'
    WHERE tc.value IS NOT NULL AND tc.value <> ''
  `)
  return rows
}

async function todayAppts(tenantId: number, fromTime?: string): Promise<ApptRow[]> {
  const today = todayBRT()
  const params: unknown[] = [tenantId, today]
  let sql = `
    SELECT start_time::TEXT, end_time::TEXT, client_name, all_service_names
    FROM appointments_full
    WHERE tenant_id = $1 AND date = $2 AND status <> 'cancelled'
  `
  if (fromTime) { params.push(fromTime); sql += ` AND start_time >= $${params.length}::TIME` }
  sql += ' ORDER BY start_time'
  const { rows } = await pool.query(sql, params)
  return rows
}

function adminLink(slug: string): string {
  return SITE_BASE_URL ? `\n👉 ${SITE_BASE_URL}/${slug}/admin` : ''
}

function summaryMeta(tenant: Tenant): SendMeta {
  return { tenantId: tenant.id, kind: 'summary', instance: tenant.whatsapp_instance }
}

async function sendMorning() {
  const tenants = await tenantsWithPhone()
  for (const tenant of tenants) {
    try {
      const appts = await todayAppts(tenant.id)
      const link  = adminLink(tenant.slug)
      if (appts.length === 0) {
        await sendText(tenant.phone, `🌅 *Bom dia, ${tenant.name}!*\nNenhum agendamento hoje. Bom descanso! 😊${link}`, summaryMeta(tenant))
        continue
      }
      const dateStr = fmtDatePT(todayBRT())
      const lines   = appts.map(a => `*${a.start_time.slice(0,5)}* — ${a.client_name} (${a.all_service_names})`).join('\n')
      const msg = `🌅 *Bom dia, ${tenant.name}!*\nSua agenda de hoje, ${dateStr}:\n\n${lines}\n\nTotal: ${appts.length} cliente${appts.length > 1 ? 's' : ''}${link}`
      await sendText(tenant.phone, msg, summaryMeta(tenant))
    } catch (err) {
      console.error(`[scheduledNotifs] 07:00 error — ${tenant.slug}:`, err)
    }
  }
}

async function sendMidday() {
  const tenants = await tenantsWithPhone()
  for (const tenant of tenants) {
    try {
      const appts = await todayAppts(tenant.id, '10:00')
      const link  = adminLink(tenant.slug)
      if (appts.length === 0) {
        await sendText(tenant.phone, `☀️ *${tenant.name}* — sem mais clientes hoje. Aproveite! 🎉${link}`, summaryMeta(tenant))
        continue
      }
      const lines = appts.map(a => `*${a.start_time.slice(0,5)}* — ${a.client_name}`).join('\n')
      await sendText(tenant.phone, `☀️ *${tenant.name}* — você tem mais ${appts.length} cliente${appts.length > 1 ? 's' : ''} hoje:\n\n${lines}${link}`, summaryMeta(tenant))
    } catch (err) {
      console.error(`[scheduledNotifs] 10:00 error — ${tenant.slug}:`, err)
    }
  }
}

async function sendEvening() {
  const tenants = await tenantsWithPhone()
  for (const tenant of tenants) {
    try {
      const appts = await todayAppts(tenant.id, '17:30')
      const link  = adminLink(tenant.slug)
      if (appts.length === 0) {
        await sendText(tenant.phone, `🌆 *${tenant.name}* — sem mais clientes por hoje! Bom descanso 🥂${link}`, summaryMeta(tenant))
        continue
      }
      const last = appts[appts.length - 1]
      await sendText(tenant.phone, `🌆 Sua última cliente de hoje é:\n👤 *${last.client_name}*\n✨ ${last.all_service_names}\n🕐 às ${last.start_time.slice(0,5)} → ${last.end_time.slice(0,5)}${link}`, summaryMeta(tenant))
    } catch (err) {
      console.error(`[scheduledNotifs] 17:30 error — ${tenant.slug}:`, err)
    }
  }
}

// Lembrete pra cliente: dirigido por appointments.reminder_date (calculada no
// booking a partir de services.reminder_days_before). O `<=` + `date >=` dá
// retry no dia seguinte se o servidor estiver fora às 08:00, sem lembrar
// agendamento que já passou. Marca reminder_sent só quando o envio dá certo.
async function sendClientReminders() {
  const today = todayBRT()
  const { rows } = await pool.query(`
    SELECT a.id, a.tenant_id, a.customer_id, a.date::TEXT, a.start_time::TEXT, a.end_time::TEXT,
           a.total_price,
           c.name AS client_name, c.phone AS client_phone,
           (SELECT string_agg(e.value->>'name', ' + ' ORDER BY e.ordinality)
              FROM jsonb_array_elements(a.services) WITH ORDINALITY e) AS all_service_names,
           t.name AS tenant_name, t.slug AS tenant_slug, t.whatsapp_instance,
           tc.value AS contact_phone
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN tenants   t ON t.id = a.tenant_id
    LEFT JOIN tenant_config tc ON tc.tenant_id = t.id AND tc.key = 'notification_phone'
    WHERE a.reminder_date <= $1 AND a.date >= $1
      AND NOT a.reminder_sent AND a.status = 'confirmed'
    ORDER BY a.tenant_id, a.start_time
  `, [today])

  for (const appt of rows) {
    try {
      await notifyClient('reminder', {
        clientName:  appt.client_name,
        clientPhone: appt.client_phone,
        serviceName: appt.all_service_names,
        totalPrice:  Number(appt.total_price),
        date:        appt.date,
        startTime:   appt.start_time.slice(0, 5),
        endTime:     appt.end_time.slice(0, 5),
      }, appt.client_phone, appt.tenant_name, appt.contact_phone, appt.tenant_slug, {
        tenantId:      appt.tenant_id,
        kind:          'reminder',
        customerId:    appt.customer_id,
        appointmentId: appt.id,
        instance:      appt.whatsapp_instance,
      })
      await pool.query('UPDATE appointments SET reminder_sent = true WHERE id = $1', [appt.id])
    } catch (err) {
      console.error(`[clientReminder] appt ${appt.id}:`, err)
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
