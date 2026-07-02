const BASE         = process.env.UAZAPI_URL
const TOKEN        = process.env.UAZAPI_TOKEN
const INSTANCE     = process.env.UAZAPI_INSTANCE
const SITE_BASE_URL = process.env.SITE_BASE_URL  // ex: https://venhagenda.com.br

type ApptEvent = 'new' | 'reschedule' | 'cancel' | 'client_cancel'

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

export async function sendText(toPhone: string, text: string): Promise<void> {
  if (!BASE || !TOKEN || !INSTANCE) {
    console.warn('[whatsapp] UAZAPI_* não configuradas — notificação ignorada')
    return
  }
  const res = await fetch(`${BASE}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: TOKEN, instance: INSTANCE },
    body: JSON.stringify({ number: normalizePhone(toPhone), text }),
  })
  if (!res.ok) throw new Error(`UazAPI ${res.status}: ${await res.text()}`)
}

export async function notifyAppt(
  event: ApptEvent,
  appt: ApptInfo,
  toPhone: string,
  studioSlug?: string,
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

  await sendText(toPhone, text)
}
