import { pool } from '../db.js'

const BASE          = process.env.UAZAPI_URL
const TOKEN         = process.env.UAZAPI_TOKEN
const INSTANCE      = process.env.UAZAPI_INSTANCE   // número central (plano basic)
const SITE_BASE_URL = process.env.SITE_BASE_URL     // ex: https://venhagenda.com.br

type ApptEvent   = 'new' | 'reschedule' | 'cancel' | 'client_cancel'
export type ClientEvent = 'confirmed' | 'rescheduled' | 'reminder' | 'client_cancelled'

export interface SendMeta {
  tenantId:       number
  kind:           'bot' | 'notification' | 'reminder' | 'summary'
  customerId?:    string
  appointmentId?: string
  // Tenant premium envia pela instância própria; sem instance cai no número central
  instance?:      string | null
  replyToId?:     string
}

export interface ApptInfo {
  clientName:   string
  clientPhone:  string
  serviceName:  string
  totalPrice:   number
  date:         string   // YYYY-MM-DD
  startTime:    string   // HH:MM
  endTime?:     string
  oldDate?:     string   // só para evento reschedule
  oldStartTime?: string
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${days[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return phone
}

function formatPrice(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `55${digits}`
  if (digits.length === 13) return digits
  return digits
}

async function recordMessage(
  meta: SendMeta,
  phone: string,
  body: string,
  instance: string,
  status: 'sent' | 'failed',
  externalId: string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO messages (tenant_id, customer_id, appointment_id, reply_to_id,
                             phone, direction, kind, body, whatsapp_instance, external_id, status)
       VALUES ($1, $2, $3, $4, $5, 'outbound', $6, $7, $8, $9, $10)`,
      [meta.tenantId, meta.customerId ?? null, meta.appointmentId ?? null, meta.replyToId ?? null,
       phone, meta.kind, body, instance, externalId, status]
    )
  } catch (err) {
    console.error('[whatsapp] falha ao gravar em messages:', err)
  }
}

export async function sendText(toPhone: string, text: string, meta?: SendMeta): Promise<void> {
  const instance = meta?.instance ?? INSTANCE
  if (!BASE || !TOKEN || !instance) {
    console.warn('[whatsapp] UAZAPI_* não configuradas — notificação ignorada')
    return
  }
  const phone = normalizePhone(toPhone)
  const res = await fetch(`${BASE}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: TOKEN, instance },
    body: JSON.stringify({ number: phone, text }),
  })

  let externalId: string | null = null
  if (res.ok) {
    try {
      const data: any = await res.json()
      externalId = data?.id ?? data?.messageid ?? data?.key?.id ?? null
    } catch { /* resposta sem JSON — sem external_id */ }
  }

  if (meta) await recordMessage(meta, phone, text, instance, res.ok ? 'sent' : 'failed', externalId)

  if (!res.ok) throw new Error(`UazAPI ${res.status}: ${await res.text()}`)
}

export async function notifyAppt(
  event: ApptEvent,
  appt: ApptInfo,
  toPhone: string,
  studioSlug?: string,
  meta?: SendMeta,
): Promise<void> {
  const date  = formatDate(appt.date)
  const phone = formatPhone(appt.clientPhone)
  const price = formatPrice(appt.totalPrice)
  const link  = (SITE_BASE_URL && studioSlug) ? `\n👉 ${SITE_BASE_URL}/${studioSlug}/admin` : ''

  let text: string
  if (event === 'new') {
    const range = appt.endTime ? ` → ${appt.endTime}` : ''
    text = `📅 *Novo agendamento!*\n👤 ${appt.clientName}\n📱 ${phone}\n✨ ${appt.serviceName}\n💰 ${price}\n🕐 ${date} às ${appt.startTime}${range}${link}`
  } else if (event === 'reschedule') {
    const range   = appt.endTime ? ` → ${appt.endTime}` : ''
    const oldLine = (appt.oldDate && appt.oldStartTime)
      ? `\n🕐 Antes: ${formatDate(appt.oldDate)} às ${appt.oldStartTime}`
      : ''
    text = `🔄 *Remarcação!*\n👤 ${appt.clientName}\n📱 ${phone}\n✨ ${appt.serviceName}\n💰 ${price}${oldLine}\n🕐 Agora: ${date} às ${appt.startTime}${range}${link}`
  } else if (event === 'client_cancel') {
    text = `❌ *Cancelamento pela cliente*\n👤 ${appt.clientName}\n📱 ${phone}\n✨ ${appt.serviceName}\n💰 ${price}\n🗓️ ${date} às ${appt.startTime}${link}`
  } else {
    text = `❌ *Cancelamento*\n👤 ${appt.clientName}\n📱 ${phone}\n✨ ${appt.serviceName}\n💰 ${price}\n🗓️ ${date} às ${appt.startTime}${link}`
  }

  await sendText(toPhone, text, meta)
}

export async function notifyClient(
  event: ClientEvent,
  appt: ApptInfo,
  toPhone: string,
  studioName: string,
  contactPhone?: string | null,
  studioSlug?: string,
  meta?: SendMeta,
): Promise<void> {
  const date    = formatDate(appt.date)
  const price   = formatPrice(appt.totalPrice)
  const range   = appt.endTime ? ` → ${appt.endTime}` : ''
  const contact = contactPhone
    ? `\n\nSe tiver dúvidas, fala com a gente pelo ${formatPhone(contactPhone)} 💅`
    : '\n\nQualquer dúvida é só responder essa mensagem 💅'
  const bookLink = (SITE_BASE_URL && studioSlug)
    ? `\n📲 ${SITE_BASE_URL}/book/${studioSlug}`
    : ''

  let text: string
  if (event === 'confirmed') {
    text = `Oi! 👋 Aqui é a assistente de agenda da *${studioName}*.\n\nSeu agendamento foi confirmado!\n✨ ${appt.serviceName}\n📅 ${date} às ${appt.startTime}${range}\n💰 ${price}${contact}`
  } else if (event === 'rescheduled') {
    const oldLine = (appt.oldDate && appt.oldStartTime)
      ? `\n🕐 Antes: ${formatDate(appt.oldDate)} às ${appt.oldStartTime}`
      : ''
    text = `Oi! 👋 Aqui é a assistente de agenda da *${studioName}*.\n\nSua remarcação foi confirmada!${oldLine}\n📅 Agora: ${date} às ${appt.startTime}${range}\n✨ ${appt.serviceName}\n💰 ${price}${contact}`
  } else if (event === 'reminder') {
    text = `Oi! 🌸 Aqui é a assistente de agenda da *${studioName}*.\n\nLembrando do seu agendamento que está se aproximando:\n✨ ${appt.serviceName}\n📅 ${date} às ${appt.startTime}${range}\n💰 ${price}${contact}`
  } else {
    text = `Oi! Aqui é a assistente de agenda da *${studioName}*.\n\nSeu cancelamento foi confirmado.\n✨ ${appt.serviceName}\n📅 ${date} às ${appt.startTime}\n\nPara reagendar quando quiser:${bookLink} 💅`
  }

  await sendText(toPhone, text, meta)
}
