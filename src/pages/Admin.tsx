import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { supabase } from '../lib/supabase'

type Appt = {
  id: string
  date: string
  start_time: string
  end_time: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  client_name: string
  client_phone: string
  service_name: string
  service_duration: number
  service_price: number
  service_color: string
  service_emoji: string
}

const PX_PER_MIN = 80 / 60
const WORK_START = 9 * 60
const WORK_END = 18 * 60
const TOTAL_H = (WORK_END - WORK_START) * PX_PER_MIN

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MON = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const HOUR_LABELS = Array.from({ length: 9 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`)

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getWeekDates(ref: Date): Date[] {
  const d = new Date(ref)
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(d)
    day.setDate(d.getDate() + i)
    return day
  })
}

function timeMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function fmtPrice(n: number): string {
  return `R$ ${n.toFixed(2).replace('.', ',')}`
}

function fmtPhone(raw: string): string {
  const s = raw.startsWith('55') && raw.length >= 13 ? raw.slice(2) : raw
  return s.length === 11 ? `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}` : raw
}

export default function Admin() {
  const [ref, setRef] = useState(new Date())
  const [appts, setAppts] = useState<Appt[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Appt | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const weekDates = getWeekDates(ref)
  const weekStart = toISO(weekDates[0])
  const weekEnd = toISO(weekDates[4])

  const doFetch = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('appointments_full')
      .select('id,date,start_time,end_time,status,client_name,client_phone,service_name,service_duration,service_price,service_color,service_emoji')
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .neq('status', 'cancelled')
      .order('date')
      .order('start_time')
    setLoading(false)
    if (!error && data) setAppts(data as Appt[])
  }, [weekStart, weekEnd])

  useEffect(() => { doFetch() }, [doFetch])

  const fetchRef = useRef(doFetch)
  useEffect(() => { fetchRef.current = doFetch }, [doFetch])

  useEffect(() => {
    const ch = supabase
      .channel('admin-appts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        fetchRef.current()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  async function cancelAppt(id: string) {
    setCancelling(true)
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', id)
    setCancelling(false)
    if (!error) {
      setAppts(prev => prev.filter(a => a.id !== id))
      setSelected(null)
    }
  }

  const today = toISO(new Date())
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMin - WORK_START) * PX_PER_MIN

  const revenue = appts.reduce((sum, a) => sum + a.service_price, 0)
  const totalHours = appts.reduce((sum, a) => sum + a.service_duration, 0) / 60

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <div>
          <h1 style={s.htitle}>Agenda 💅</h1>
          <p style={s.hsub}>
            {weekDates[0].getDate()} {MON[weekDates[0].getMonth()]} –{' '}
            {weekDates[4].getDate()} {MON[weekDates[4].getMonth()]}
          </p>
        </div>
        <div style={s.navRow}>
          <button style={s.navBtn} onClick={() => setRef(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}>‹</button>
          <button style={s.navToday} onClick={() => setRef(new Date())}>Hoje</button>
          <button style={s.navBtn} onClick={() => setRef(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}>›</button>
        </div>
      </header>

      {/* Stats */}
      <div style={s.statsRow}>
        <StatCard label="Atendimentos" value={String(appts.length)} />
        <StatCard label="Faturamento" value={fmtPrice(revenue)} />
        <StatCard label="Horas" value={`${totalHours.toFixed(1)}h`} />
      </div>

      {loading && <div style={s.loaderBar} />}

      {/* Calendar */}
      <div style={s.calOuter}>
        <div style={s.calInner}>
          {/* Day headers */}
          <div style={s.headRow}>
            <div style={s.cornerCell} />
            {weekDates.map(d => {
              const iso = toISO(d)
              const isToday = iso === today
              return (
                <div key={iso} style={{ ...s.dayHead, ...(isToday ? s.dayHeadToday : {}) }}>
                  <span style={s.dayDow}>{DOW[d.getDay()]}</span>
                  <span style={{ ...s.dayNum, ...(isToday ? s.dayNumToday : {}) }}>{d.getDate()}</span>
                </div>
              )
            })}
          </div>

          {/* Scrollable content */}
          <div style={s.scrollArea}>
            {/* Time axis */}
            <div style={{ ...s.timeAxis, height: TOTAL_H }}>
              {HOUR_LABELS.map(h => (
                <div key={h} style={s.hLabel}>{h}</div>
              ))}
            </div>

            {/* Day columns */}
            {weekDates.map(d => {
              const iso = toISO(d)
              const isToday = iso === today
              const dayAppts = appts.filter(a => a.date === iso)
              return (
                <div
                  key={iso}
                  style={{ ...s.dayCol, height: TOTAL_H, ...(isToday ? s.dayColToday : {}) }}
                >
                  {/* Hour grid lines */}
                  {HOUR_LABELS.map((_, i) => (
                    <div key={i} style={{ ...s.hLine, top: i * 80 }} />
                  ))}

                  {/* Now indicator */}
                  {isToday && nowMin >= WORK_START && nowMin <= WORK_END && (
                    <div style={{ ...s.nowLine, top: nowTop }} />
                  )}

                  {/* Appointments */}
                  {dayAppts.map(a => {
                    const top = (timeMin(a.start_time) - WORK_START) * PX_PER_MIN
                    const height = Math.max(a.service_duration * PX_PER_MIN, 24)
                    return (
                      <button
                        key={a.id}
                        style={{
                          ...s.apptBlock,
                          top,
                          height,
                          background: `${a.service_color}2a`,
                          borderColor: a.service_color,
                        }}
                        onClick={() => setSelected(a)}
                      >
                        <span style={s.aTime}>{a.start_time.slice(0, 5)}</span>
                        <span style={s.aName}>{a.client_name.split(' ')[0]}</span>
                        {height > 44 && <span style={s.aEmoji}>{a.service_emoji}</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modal */}
      {selected && (
        <div style={s.overlay} onClick={() => setSelected(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={{ ...s.modalTop, borderLeftColor: selected.service_color }}>
              <span style={s.mEmoji}>{selected.service_emoji}</span>
              <div>
                <div style={s.mService}>{selected.service_name}</div>
                <div style={s.mTime}>
                  {selected.start_time.slice(0, 5)} → {selected.end_time.slice(0, 5)}
                </div>
              </div>
            </div>
            <div style={s.mBody}>
              <MRow label="Cliente" value={selected.client_name} />
              <MRow label="WhatsApp" value={fmtPhone(selected.client_phone)} />
              <MRow label="Data" value={selected.date} />
              <MRow label="Duração" value={`${selected.service_duration}min`} />
              <MRow label="Valor" value={fmtPrice(selected.service_price)} />
            </div>
            <div style={s.mActions}>
              <a
                href={`https://wa.me/${selected.client_phone}`}
                target="_blank"
                rel="noopener noreferrer"
                style={s.btnWA}
              >
                💬 Chamar no WhatsApp
              </a>
              <button
                style={s.btnCancel}
                disabled={cancelling}
                onClick={() => {
                  if (window.confirm(`Cancelar agendamento de ${selected.client_name}?`)) {
                    cancelAppt(selected.id)
                  }
                }}
              >
                {cancelling ? 'Cancelando...' : '✕ Cancelar agendamento'}
              </button>
            </div>
            <button style={s.btnClose} onClick={() => setSelected(null)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statCard}>
      <span style={s.statVal}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  )
}

function MRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.mRow}>
      <span style={s.mLabel}>{label}</span>
      <span style={s.mVal}>{value}</span>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#fafafa',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    background: '#d63384',
    color: '#fff',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  htitle: { margin: 0, fontSize: 20, fontWeight: 700 },
  hsub: { margin: '2px 0 0', fontSize: 12, opacity: 0.85 },
  navRow: { display: 'flex', gap: 6, alignItems: 'center' },
  navBtn: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    borderRadius: 8,
    width: 36,
    height: 36,
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
  },
  navToday: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    borderRadius: 8,
    padding: '0 12px',
    height: 36,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  statsRow: {
    display: 'flex',
    borderBottom: '1px solid #f0f0f0',
    background: '#fff',
  },
  statCard: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 8px',
    borderRight: '1px solid #f0f0f0',
  },
  statVal: { fontSize: 18, fontWeight: 700, color: '#d63384' },
  statLabel: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  loaderBar: {
    height: 3,
    background: 'linear-gradient(90deg, #d63384 0%, #f9a8d4 100%)',
    animation: 'none',
  },
  calOuter: {
    flex: 1,
    overflowX: 'auto',
  },
  calInner: {
    minWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  headRow: {
    display: 'flex',
    background: '#fff',
    borderBottom: '2px solid #fce7f3',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  cornerCell: { width: 44, flexShrink: 0 },
  dayHead: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 4px',
    gap: 2,
  },
  dayHeadToday: { background: '#fdf2f8' },
  dayDow: { fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' },
  dayNum: { fontSize: 18, fontWeight: 700, color: '#374151' },
  dayNumToday: {
    background: '#d63384',
    color: '#fff',
    borderRadius: '50%',
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
  },
  scrollArea: {
    display: 'flex',
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 160px)',
  },
  timeAxis: {
    width: 44,
    flexShrink: 0,
    position: 'relative',
    borderRight: '1px solid #f0f0f0',
    background: '#fff',
  },
  hLabel: {
    position: 'absolute',
    right: 6,
    fontSize: 10,
    color: '#9ca3af',
    height: 80,
    lineHeight: '80px',
    transform: 'translateY(-50%)',
  },
  dayCol: {
    flex: 1,
    position: 'relative',
    borderRight: '1px solid #f0f0f0',
    minWidth: 60,
  },
  dayColToday: { background: '#fdf2f8' },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    background: '#f3f4f6',
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    background: '#ef4444',
    zIndex: 5,
    borderRadius: 2,
  },
  apptBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    border: '1.5px solid',
    borderRadius: 6,
    padding: '3px 5px',
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    textAlign: 'left',
    zIndex: 2,
  },
  aTime: { fontSize: 10, fontWeight: 700, color: '#374151', lineHeight: 1.2 },
  aName: { fontSize: 11, fontWeight: 600, color: '#1f2937', lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  aEmoji: { fontSize: 12, lineHeight: 1 },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 100,
    padding: '0',
  },
  modal: {
    background: '#fff',
    borderRadius: '20px 20px 0 0',
    width: '100%',
    maxWidth: 520,
    maxHeight: '85vh',
    overflowY: 'auto',
    padding: '0 0 24px',
  },
  modalTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '20px',
    borderLeft: '5px solid',
    borderBottom: '1px solid #f3f4f6',
    margin: '0 0 4px',
  },
  mEmoji: { fontSize: 36 },
  mService: { fontSize: 17, fontWeight: 700, color: '#1f2937' },
  mTime: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  mBody: { padding: '0 20px' },
  mRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #f9fafb',
  },
  mLabel: { fontSize: 13, color: '#6b7280' },
  mVal: { fontSize: 13, fontWeight: 600, color: '#1f2937' },
  mActions: { padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 },
  btnWA: {
    display: 'block',
    padding: '13px',
    background: '#25d366',
    color: '#fff',
    textAlign: 'center',
    textDecoration: 'none',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 15,
  },
  btnCancel: {
    padding: '13px',
    background: 'transparent',
    color: '#dc2626',
    border: '2px solid #dc2626',
    borderRadius: 12,
    fontWeight: 600,
    fontSize: 15,
    cursor: 'pointer',
  },
  btnClose: {
    display: 'block',
    margin: '12px 20px 0',
    width: 'calc(100% - 40px)',
    padding: '13px',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: 12,
    fontWeight: 600,
    fontSize: 15,
    color: '#374151',
    cursor: 'pointer',
  },
}
