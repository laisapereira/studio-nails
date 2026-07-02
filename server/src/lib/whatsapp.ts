const BASE     = process.env.UAZAPI_URL
const TOKEN    = process.env.UAZAPI_TOKEN
const INSTANCE = process.env.UAZAPI_INSTANCE
const PHONE    = process.env.MICHELE_PHONE

type Event = 'new' | 'cancel'

interface ApptInfo {
  clientName:  string
  clientPhone: string
  serviceName: string
  totalPrice:  number
  date:        string  // YYYY-MM-DD
  startTime:   string  // HH:MM
  endTime?:    string
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const day  = new Date(y, m - 1, d).getDay()
  return `${days[day]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
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

function buildMessage(event: Event, a: ApptInfo): string {
  const date  = formatDate(a.date)
  const phone = formatPhone(a.clientPhone)
  const price = formatPrice(a.totalPrice)
  if (event === 'new') {
    const range = a.endTime ? ` → ${a.endTime}` : ''
    return `📅 *Novo agendamento!*\n👤 ${a.clientName}\n📱 ${phone}\n✨ ${a.serviceName}\n💰 ${price}\n🕐 ${date} às ${a.startTime}${range}`
  }
  return `❌ *Cancelamento*\n👤 ${a.clientName}\n📱 ${phone}\n✨ ${a.serviceName}\n💰 ${price}\n🗓️ ${date} às ${a.startTime}`
}

// normaliza para 5571999990001 (adiciona 55 se vier sem DDI)
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `55${digits}`
  if (digits.length === 13) return digits
  return digits
}

export async function notifyMichele(event: Event, appt: ApptInfo): Promise<void> {
  if (!BASE || !TOKEN || !INSTANCE || !PHONE) {
    console.warn('[whatsapp] UAZAPI_* não configuradas — notificação ignorada')
    return
  }
  const res = await fetch(`${BASE}/send/text`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      token:    TOKEN,
      instance: INSTANCE,
    },
    body: JSON.stringify({
      number: normalizePhone(PHONE),
      text:   buildMessage(event, appt),
    }),
  })
  if (!res.ok) throw new Error(`UazAPI ${res.status}: ${await res.text()}`)
}
