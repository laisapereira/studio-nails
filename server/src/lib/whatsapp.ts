const BASE     = process.env.UAZAPI_URL       // ex: https://sua-instancia.uazapi.dev
const TOKEN    = process.env.UAZAPI_TOKEN
const INSTANCE = process.env.UAZAPI_INSTANCE
const PHONE    = process.env.MICHELE_PHONE    // ex: 5571999990001

type Event = 'new' | 'cancel'

interface ApptInfo {
  clientName:  string
  serviceName: string
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

function buildMessage(event: Event, a: ApptInfo): string {
  const date = formatDate(a.date)
  if (event === 'new') {
    const range = a.endTime ? ` → ${a.endTime}` : ''
    return `📅 *Novo agendamento!*\n👤 ${a.clientName}\n✨ ${a.serviceName}\n🕐 ${date} às ${a.startTime}${range}`
  }
  return `❌ *Cancelamento*\n👤 ${a.clientName}\n✨ ${a.serviceName}\n🗓️ ${date} às ${a.startTime}`
}

export async function notifyMichele(event: Event, appt: ApptInfo): Promise<void> {
  if (!BASE || !TOKEN || !INSTANCE || !PHONE) {
    console.warn('[whatsapp] UAZAPI_* não configuradas — notificação ignorada')
    return
  }
  // Ajuste o path conforme sua versão do UazAPI
  const res = await fetch(`${BASE}/send-text/${INSTANCE}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', token: TOKEN },
    body:    JSON.stringify({ phone: PHONE, message: buildMessage(event, appt) }),
  })
  if (!res.ok) throw new Error(`UazAPI ${res.status}: ${await res.text()}`)
}
