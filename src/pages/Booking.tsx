import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '../lib/supabase'

type Service = {
  id: number
  name: string
  duration: number
  price: number
  color: string
  emoji: string
}

type Step = 'service' | 'date' | 'time' | 'info' | 'confirm' | 'success'

type BookingState = {
  service: Service | null
  date: string
  time: string
  name: string
  phone: string
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return `${DAYS[d.getDay()]}, ${day} de ${MONTHS[month - 1]}`
}

function formatPrice(price: number): string {
  return `R$ ${price.toFixed(2).replace('.', ',')}`
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h${m}`
}

function applyPhoneMask(digits: string): string {
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

function toSupabasePhone(formatted: string): string {
  const digits = formatted.replace(/\D/g, '')
  return digits.length === 11 ? `55${digits}` : digits
}

function calcEndTime(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMin
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function getAvailableDates(): string[] {
  const dates: string[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < 60 && dates.length < 30; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      dates.push(`${yyyy}-${mm}-${dd}`)
    }
  }
  return dates
}

const STEPS: Step[] = ['service', 'date', 'time', 'info', 'confirm']

export default function Booking() {
  const [step, setStep] = useState<Step>('service')
  const [services, setServices] = useState<Service[]>([])
  const [booking, setBooking] = useState<BookingState>({
    service: null, date: '', time: '', name: '', phone: '',
  })
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, name, duration, price, color, emoji')
      .eq('active', true)
      .order('id')
      .then(({ data, error: err }) => {
        if (!err && data) setServices(data as Service[])
      })
  }, [])

  useEffect(() => {
    if (!booking.date || !booking.service) return
    setSlotsLoading(true)
    setSlots([])
    supabase
      .rpc('available_slots', {
        p_date: booking.date,
        p_service_id: booking.service.id,
      })
      .then(({ data, error: err }) => {
        setSlotsLoading(false)
        if (err) {
          setError('Erro ao buscar horários. Tente novamente.')
          return
        }
        const result = (data as { slot_time: string }[] | null) ?? []
        setSlots(result.map(r => r.slot_time.slice(0, 5)))
      })
  }, [booking.date, booking.service])

  async function handleConfirm() {
    if (!booking.service) return
    setLoading(true)
    setError(null)

    const { error: err } = await supabase.rpc('create_appointment', {
      p_client_name: booking.name.trim(),
      p_phone: toSupabasePhone(booking.phone),
      p_service_id: booking.service.id,
      p_date: booking.date,
      p_start_time: `${booking.time}:00`,
      p_created_via: 'panel',
    })

    setLoading(false)

    if (err) {
      if (err.message.toLowerCase().includes('conflict') || err.message.toLowerCase().includes('overlap')) {
        setError('Este horário acabou de ser ocupado. Escolha outro horário.')
        setStep('time')
      } else {
        setError('Não foi possível confirmar. Tente novamente.')
      }
      return
    }

    setStep('success')
  }

  const availableDates = getAvailableDates()
  const stepIndex = STEPS.indexOf(step)

  return (
    <div style={s.page}>
      <header style={s.header}>
        <span style={s.headerEmoji}>💅</span>
        <div>
          <h1 style={s.headerTitle}>Studio da Michele</h1>
          <p style={s.headerSub}>Agendamento online</p>
        </div>
      </header>

      {step !== 'success' && (
        <div style={s.progressBar}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{ ...s.progressDot, background: stepIndex >= i ? '#d63384' : '#e5e7eb' }}
            />
          ))}
        </div>
      )}

      {step !== 'service' && step !== 'success' && booking.service && (
        <div style={s.chips}>
          <span style={{ ...s.chip, background: `${booking.service.color}22`, borderColor: booking.service.color }}>
            {booking.service.emoji} {booking.service.name}
          </span>
          {booking.date && <span style={s.chip}>{formatDate(booking.date)}</span>}
          {booking.time && <span style={s.chip}>{booking.time}</span>}
        </div>
      )}

      <main style={s.main}>
        {error && <div style={s.errorBox}>{error}</div>}

        {/* STEP 1 — Serviço */}
        {step === 'service' && (
          <div>
            <h2 style={s.title}>Qual serviço você quer? 💅</h2>
            {services.length === 0 && <p style={s.hint}>Carregando serviços...</p>}
            <div style={s.serviceGrid}>
              {services.map(svc => (
                <button
                  key={svc.id}
                  style={{ ...s.serviceCard, borderColor: svc.color }}
                  onClick={() => {
                    setBooking(b => ({ ...b, service: svc, time: '', date: '' }))
                    setError(null)
                    setStep('date')
                  }}
                >
                  <span style={s.serviceEmoji}>{svc.emoji}</span>
                  <span style={s.serviceName}>{svc.name}</span>
                  <span style={s.serviceMeta}>
                    {formatDuration(svc.duration)} · {formatPrice(svc.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2 — Data */}
        {step === 'date' && (
          <div>
            <h2 style={s.title}>Qual data?</h2>
            <p style={s.hint}>Segunda a sexta, próximos 30 dias úteis</p>
            <div style={s.dateGrid}>
              {availableDates.map(d => {
                const [, month, day] = d.split('-').map(Number)
                const dow = DAYS[new Date(d).getDay()]
                const active = booking.date === d
                return (
                  <button
                    key={d}
                    style={{ ...s.dateCard, ...(active ? s.dateCardActive : {}) }}
                    onClick={() => {
                      setBooking(b => ({ ...b, date: d, time: '' }))
                      setError(null)
                      setStep('time')
                    }}
                  >
                    <span style={s.dateDow}>{dow}</span>
                    <span style={s.dateDay}>{day}</span>
                    <span style={s.dateMon}>{MONTHS[month - 1].slice(0, 3)}</span>
                  </button>
                )
              })}
            </div>
            <button style={s.back} onClick={() => setStep('service')}>← Voltar</button>
          </div>
        )}

        {/* STEP 3 — Horário */}
        {step === 'time' && (
          <div>
            <h2 style={s.title}>Qual horário?</h2>
            {slotsLoading ? (
              <p style={s.hint}>Carregando horários disponíveis...</p>
            ) : slots.length === 0 ? (
              <div>
                <p style={s.hint}>Nenhum horário disponível nesta data.</p>
                <button style={s.btnPrimary} onClick={() => setStep('date')}>
                  Escolher outra data
                </button>
              </div>
            ) : (
              <div style={s.slotGrid}>
                {slots.map(slot => (
                  <button
                    key={slot}
                    style={{ ...s.slotBtn, ...(booking.time === slot ? s.slotBtnActive : {}) }}
                    onClick={() => {
                      setBooking(b => ({ ...b, time: slot }))
                      setError(null)
                      setStep('info')
                    }}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
            <button style={s.back} onClick={() => setStep('date')}>← Voltar</button>
          </div>
        )}

        {/* STEP 4 — Dados */}
        {step === 'info' && (
          <div>
            <h2 style={s.title}>Seus dados</h2>
            <div style={s.formGroup}>
              <label style={s.label}>Nome completo</label>
              <input
                style={s.input}
                type="text"
                placeholder="Ex: Ana Lima"
                value={booking.name}
                onChange={e => setBooking(b => ({ ...b, name: e.target.value }))}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>WhatsApp</label>
              <input
                style={s.input}
                type="tel"
                placeholder="(71) 99999-0000"
                value={booking.phone}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 11)
                  setBooking(b => ({ ...b, phone: digits ? applyPhoneMask(digits) : '' }))
                }}
              />
            </div>
            <button
              style={{
                ...s.btnPrimary,
                opacity: booking.name.trim().length < 2 || booking.phone.replace(/\D/g, '').length < 10 ? 0.5 : 1,
              }}
              disabled={booking.name.trim().length < 2 || booking.phone.replace(/\D/g, '').length < 10}
              onClick={() => { setError(null); setStep('confirm') }}
            >
              Continuar →
            </button>
            <button style={s.back} onClick={() => setStep('time')}>← Voltar</button>
          </div>
        )}

        {/* STEP 5 — Confirmar */}
        {step === 'confirm' && booking.service && (
          <div>
            <h2 style={s.title}>Confirmar agendamento</h2>
            <div style={s.summary}>
              <SummaryRow label="Serviço" value={`${booking.service.emoji} ${booking.service.name}`} />
              <SummaryRow label="Data" value={formatDate(booking.date)} />
              <SummaryRow label="Horário" value={`${booking.time} → ${calcEndTime(booking.time, booking.service.duration)}`} />
              <SummaryRow label="Duração" value={formatDuration(booking.service.duration)} />
              <SummaryRow label="Valor" value={formatPrice(booking.service.price)} />
              <SummaryRow label="Nome" value={booking.name} />
              <SummaryRow label="WhatsApp" value={booking.phone} />
            </div>
            <button style={s.btnPrimary} disabled={loading} onClick={handleConfirm}>
              {loading ? 'Agendando...' : 'Confirmar ✅'}
            </button>
            <button style={s.back} onClick={() => setStep('info')}>← Voltar</button>
          </div>
        )}

        {/* SUCESSO */}
        {step === 'success' && booking.service && (
          <div style={s.successBox}>
            <div style={s.successIcon}>✅</div>
            <h2 style={s.successTitle}>
              Agendado, {booking.name.split(' ')[0]}!
            </h2>
            <p style={s.successSub}>Você receberá um lembrete 2 dias antes 💅</p>
            <div style={s.summary}>
              <SummaryRow label="📅 Data" value={formatDate(booking.date)} />
              <SummaryRow
                label="🕐 Horário"
                value={`${booking.time} → ${calcEndTime(booking.time, booking.service.duration)}`}
              />
              <SummaryRow label={`${booking.service.emoji} Serviço`} value={booking.service.name} />
              <SummaryRow label="💰 Valor" value={formatPrice(booking.service.price)} />
            </div>
            <a
              href={`https://wa.me/5571999990000?text=${encodeURIComponent(
                `Olá Michele! Agendei meu ${booking.service.name} para ${formatDate(booking.date)} às ${booking.time}. 💅`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              style={s.btnWhatsApp}
            >
              💬 Falar com a Michele
            </a>
            <button
              style={s.btnSecondary}
              onClick={() => {
                setBooking({ service: null, date: '', time: '', name: '', phone: '' })
                setError(null)
                setStep('service')
              }}
            >
              Fazer outro agendamento
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.summaryRow}>
      <span style={s.summaryLabel}>{label}</span>
      <strong style={s.summaryValue}>{value}</strong>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#fdf2f8',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#1f2937',
  },
  header: {
    background: '#d63384',
    color: '#fff',
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  headerEmoji: { fontSize: 36 },
  headerTitle: { margin: 0, fontSize: 22, fontWeight: 700 },
  headerSub: { margin: '2px 0 0', fontSize: 13, opacity: 0.85 },
  progressBar: {
    display: 'flex',
    gap: 6,
    padding: '14px 24px',
    background: '#fff',
    borderBottom: '1px solid #fce7f3',
  },
  progressDot: {
    flex: 1,
    height: 4,
    borderRadius: 4,
    transition: 'background 0.3s',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 24px',
    background: '#fff',
    borderBottom: '1px solid #fce7f3',
  },
  chip: {
    fontSize: 13,
    padding: '4px 12px',
    borderRadius: 20,
    border: '1px solid #fbcfe8',
    background: '#fdf2f8',
    color: '#9d174d',
    fontWeight: 500,
  },
  main: {
    maxWidth: 560,
    margin: '0 auto',
    padding: '24px 20px 48px',
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
    borderRadius: 10,
    padding: '12px 16px',
    marginBottom: 20,
    fontSize: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8,
    color: '#831843',
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
  },
  serviceGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginTop: 16,
  },
  serviceCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '16px 18px',
    border: '2px solid',
    borderRadius: 14,
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'transform 0.15s, box-shadow 0.15s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  serviceEmoji: { fontSize: 28, minWidth: 36 },
  serviceName: { flex: 1, fontWeight: 600, fontSize: 16 },
  serviceMeta: { fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' },
  dateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
    gap: 10,
    marginBottom: 24,
  },
  dateCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 6px',
    border: '2px solid #fce7f3',
    borderRadius: 12,
    background: '#fff',
    cursor: 'pointer',
    gap: 2,
  },
  dateCardActive: {
    borderColor: '#d63384',
    background: '#fdf2f8',
  },
  dateDow: { fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' },
  dateDay: { fontSize: 22, fontWeight: 700, color: '#1f2937' },
  dateMon: { fontSize: 11, color: '#6b7280' },
  slotGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
    gap: 10,
    marginBottom: 24,
  },
  slotBtn: {
    padding: '12px 8px',
    border: '2px solid #fce7f3',
    borderRadius: 10,
    background: '#fff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    color: '#374151',
  },
  slotBtnActive: {
    borderColor: '#d63384',
    background: '#d63384',
    color: '#fff',
  },
  formGroup: { marginBottom: 20 },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 6,
    color: '#374151',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '2px solid #fce7f3',
    borderRadius: 10,
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
  },
  summary: {
    background: '#fff',
    border: '1px solid #fce7f3',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 20,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #fdf2f8',
  },
  summaryLabel: { fontSize: 14, color: '#6b7280' },
  summaryValue: { fontSize: 14, color: '#1f2937', textAlign: 'right' },
  btnPrimary: {
    width: '100%',
    padding: '14px',
    background: '#d63384',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 12,
  },
  btnWhatsApp: {
    display: 'block',
    width: '100%',
    padding: '14px',
    background: '#25d366',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 12,
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
  },
  btnSecondary: {
    width: '100%',
    padding: '14px',
    background: 'transparent',
    color: '#d63384',
    border: '2px solid #d63384',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: 12,
  },
  back: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: 14,
    padding: '8px 0',
  },
  successBox: { textAlign: 'center' },
  successIcon: { fontSize: 64, marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: 800, color: '#831843', marginBottom: 6 },
  successSub: { color: '#6b7280', marginBottom: 24 },
}
