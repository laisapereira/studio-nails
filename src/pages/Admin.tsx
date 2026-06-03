import { useState, useEffect, useCallback, useRef, ReactNode, CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, Appointment, DashStats, TimeBlock, StudioConfig } from '../lib/api'
import { Icon } from '../components/Icon'
import { T, serviceTint, serviceIcon } from '../theme/terra'

// ── constants ────────────────────────────────────────────────────
const PX_PER_MIN = 80 / 60
const WORK_START  = 9 * 60
const WORK_END    = 18 * 60

const DOW      = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DOW_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MON      = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// ── helpers ──────────────────────────────────────────────────────
const hhmm      = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
const timeMin   = (t: string) => { const [h,m] = t.split(':').map(Number); return h*60+m }
const brl       = (n: number) => `R$ ${Number(n).toFixed(2).replace('.',',')}`
const dur       = (m: number) => { const h=Math.floor(m/60), r=m%60; return h===0?`${r}min`:r===0?`${h}h`:`${h}h${String(r).padStart(2,'0')}` }
const phoneMask = (raw: string) => { const s = raw.startsWith('55') && raw.length>=13 ? raw.slice(2) : raw; return s.length===11?`(${s.slice(0,2)}) ${s.slice(2,7)}-${s.slice(7)}`:raw }

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Retorna sempre 7 dias a partir de Segunda (Mon-Sun)
function getWeekDates(ref: Date): Date[] {
  const d = new Date(ref)
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(d.getDate()+i); return day })
}

// JS getDay(): Sun=0 Mon=1..Sat=6 → ISODOW: Mon=1..Sat=6 Sun=7
function jsToIsodow(jsDow: number): number { return jsDow === 0 ? 7 : jsDow }

function allTimeSlots(): string[] {
  const slots: string[] = []
  for (let m = WORK_START; m <= WORK_END; m += 30) slots.push(hhmm(m))
  return slots
}

// ── component ────────────────────────────────────────────────────
export default function Admin() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()
  const [view, setView]         = useState<'dia' | 'semana'>('dia')
  const [ref, setRef]           = useState(new Date())
  const [selectedDate, setSelDate] = useState(toISO(new Date()))
  const [appts, setAppts]       = useState<Appointment[]>([])
  const [blocks, setBlocks]     = useState<TimeBlock[]>([])
  const [config, setConfig]     = useState<StudioConfig>({ studio_name: '', studio_slug: '', work_days: [1,2,3,4,5], work_start: '09:00', work_end: '18:00' })
  const [stats, setStats]       = useState<DashStats | null>(null)
  const [loading, setLoading]   = useState(false)
  const [sheet, setSheet]       = useState<'detail' | 'add' | 'block' | 'menu' | 'password' | 'config' | null>(null)
  const [selAppt, setSelAppt]   = useState<Appointment | null>(null)
  const [toast, setToast]       = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const weekDates   = getWeekDates(ref)                    // 7 dias Mon–Sun
  const weekStart   = toISO(weekDates[0])                   // segunda
  const weekEnd     = toISO(weekDates[6])                   // domingo
  const displayDates = weekDates.filter(d =>
    config.work_days.includes(jsToIsodow(d.getDay()))
  )
  const today     = toISO(new Date())
  const nowMin    = new Date().getHours() * 60 + new Date().getMinutes()

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000) }

  const doFetch = useCallback(async () => {
    setLoading(true)
    try {
      const [data, s, blks, cfg] = await Promise.all([
        api.appointments.list({ start: weekStart, end: weekEnd, status: 'active' }),
        api.dashboard.stats(weekStart, weekEnd),
        api.blocks.list(weekStart, weekEnd),
        api.config.get(),
      ])
      setAppts(data)
      setStats(s)
      setBlocks(blks)
      setConfig(cfg)
    } catch {
      localStorage.removeItem('token')
      navigate(`/${slug}/login`)
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd, navigate])

  useEffect(() => { doFetch() }, [doFetch])

  const fetchRef = useRef(doFetch)
  useEffect(() => { fetchRef.current = doFetch }, [doFetch])
  useEffect(() => {
    const t = setInterval(() => fetchRef.current(), 30_000)
    return () => clearInterval(t)
  }, [])

  async function cancelAppt(id: string) {
    setCancelling(true)
    try {
      await api.appointments.cancel(id)
      setAppts(prev => prev.filter(a => a.id !== id))
      setSelAppt(null)
      setSheet(null)
      flash('Agendamento cancelado')
    } finally {
      setCancelling(false)
    }
  }

  function logout() { localStorage.removeItem('token'); navigate(`/${slug}/login`) }

  async function addBlock(date: string, start_time: string, end_time: string, reason: string) {
    try {
      const block = await api.blocks.create({ date, start_time, end_time, reason })
      setBlocks(prev => [...prev, block])
      setSheet(null)
      flash(`Horário bloqueado · ${reason}`)
    } catch {
      flash('Erro ao bloquear horário')
    }
  }

  async function removeBlock(id: number) {
    await api.blocks.remove(id)
    setBlocks(prev => prev.filter(b => b.id !== id))
    flash('Bloqueio removido')
  }

  function prevDay() {
    const d = new Date(selectedDate + 'T00:00:00')
    do { d.setDate(d.getDate()-1) } while (!config.work_days.includes(jsToIsodow(d.getDay())))
    const iso = toISO(d)
    setSelDate(iso)
    if (iso < weekStart || iso > weekEnd) setRef(d)
  }

  function nextDay() {
    const d = new Date(selectedDate + 'T00:00:00')
    do { d.setDate(d.getDate()+1) } while (!config.work_days.includes(jsToIsodow(d.getDay())))
    const iso = toISO(d)
    setSelDate(iso)
    if (iso < weekStart || iso > weekEnd) setRef(d)
  }

  const selDayAppts = appts
    .filter(a => a.date === selectedDate && a.status !== 'cancelled')
    .sort((a, b) => timeMin(a.start_time) - timeMin(b.start_time))

  const current = selectedDate === today
    ? selDayAppts.find(a => nowMin >= timeMin(a.start_time) && nowMin < timeMin(a.end_time))
    : undefined
  const next  = selDayAppts.find(a => timeMin(a.start_time) > (selectedDate === today ? nowMin : -1))
  const hero  = current || next

  const weekCount = Object.fromEntries(
    weekDates.map(d => { const iso = toISO(d); return [iso, appts.filter(a => a.date===iso && a.status!=='cancelled').length] })
  )
  const maxCount = Math.max(...Object.values(weekCount), 1)

  const selObj     = new Date(selectedDate + 'T00:00:00')
  const selDayFull = DOW_FULL[selObj.getDay()]
  const selDayNum  = selObj.getDate()
  const selMon     = MON[selObj.getMonth()]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: T.bg, color: T.ink, fontFamily: T.body, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.lineSoft}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 8px' }}>
          <div>
            <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 22, lineHeight: 1, color: T.ink }}>{config.studio_name || '…'}</div>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: T.accent, marginTop: 4, fontWeight: 600 }}>Agenda</div>
          </div>
          <button style={iconBtnS()} onClick={() => setSheet('menu')}>
            <Icon name="list" size={20} color={T.inkSoft} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={view==='dia' ? prevDay : () => setRef(d => { const n=new Date(d); n.setDate(n.getDate()-7); return n })} style={navBtnS()}>
              <Icon name="chevronLeft" size={15} color={T.inkSoft} />
            </button>
            <div>
              <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                {view==='dia' ? (selectedDate===today ? 'Hoje' : selMon) : 'Semana'}
              </div>
              <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 26, lineHeight: 1.05, color: T.ink, whiteSpace: 'nowrap' }}>
                {view==='dia'
                  ? `${selDayFull}, ${selDayNum}`
                  : `${weekDates[0].getDate()}–${weekDates[4].getDate()} ${MON[weekDates[0].getMonth()]}`}
              </div>
            </div>
            <button onClick={view==='dia' ? nextDay : () => setRef(d => { const n=new Date(d); n.setDate(n.getDate()+7); return n })} style={navBtnS()}>
              <Icon name="chevronRight" size={15} color={T.inkSoft} />
            </button>
          </div>
          <div style={{ display: 'flex', background: T.surfaceAlt, borderRadius: 999, padding: 3, gap: 2 }}>
            {(['dia','semana'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 13px',
                fontSize: 12, fontWeight: 700, fontFamily: T.body, textTransform: 'capitalize',
                background: view===v ? T.surface : 'transparent',
                color: view===v ? T.ink : T.inkSoft,
                boxShadow: view===v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' as unknown as undefined }}>

        {/* Hero card */}
        {view==='dia' && hero && (
          <div style={{ padding: '16px 16px 4px' }}>
            <div style={{
              background: current ? T.primary : T.surface, color: current ? T.primaryInk : T.ink,
              borderRadius: T.radius, padding: '15px 16px',
              border: current ? 'none' : `1px solid ${T.line}`,
              boxShadow: current ? '0 8px 24px -10px rgba(0,0,0,0.35)' : '0 2px 10px -6px rgba(0,0,0,0.12)',
              display: 'flex', alignItems: 'center', gap: 13,
            }}>
              {(() => {
                const c = serviceTint(hero.service_id)
                return (
                  <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: current ? 'rgba(255,255,255,0.18)' : c.tint, color: current ? T.primaryInk : c.ink }}>
                    <Icon name={serviceIcon(hero.service_id)} size={24} sw={1.5} />
                  </div>
                )
              })()}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: current ? 'rgba(255,255,255,0.8)' : T.accent }}>
                  {current ? 'Atendendo agora' : 'Próximo cliente'}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hero.client_name}</div>
                <div style={{ fontSize: 12.5, marginTop: 1, color: current ? 'rgba(255,255,255,0.85)' : T.inkSoft }}>
                  {hero.service_name} · {hero.start_time.slice(0,5)}–{hero.end_time.slice(0,5)}
                </div>
              </div>
              <a href={`https://wa.me/${hero.client_phone}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ width: 42, height: 42, borderRadius: 999, flexShrink: 0, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: current ? 'rgba(255,255,255,0.2)' : '#25955420', color: current ? T.primaryInk : '#1f8a4c' }}>
                <Icon name="whatsapp" size={22} sw={1.5} />
              </a>
            </div>
          </div>
        )}

        {/* Stats */}
        {(() => {
          const statsData = view==='dia'
            ? [
                { v: String(selDayAppts.length), l: 'clientes' },
                { v: brl(selDayAppts.reduce((s,a) => s + Number(a.service_price), 0)).replace('R$ ','R$'), l: 'previsto' },
                { v: hero ? (current ? 'agora' : hero.start_time.slice(0,5)) : '–', l: current ? 'em atend.' : 'próxima' },
              ]
            : [
                { v: String(stats?.totalAppointments ?? 0), l: 'semana' },
                { v: brl(stats?.totalRevenue ?? 0).replace('R$ ','R$'), l: 'faturamento' },
                { v: `${(stats?.totalHours ?? 0).toFixed(1)}h`, l: 'trabalhadas' },
              ]
          return (
            <div style={{ display: 'flex', gap: 8, padding: '12px 16px 4px' }}>
              {statsData.map((st, i) => (
                <div key={i} style={{ flex: 1, background: T.surface, border: `1px solid ${T.lineSoft}`, borderRadius: T.radiusSm, padding: '11px 12px' }}>
                  <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 20, lineHeight: 1, color: T.ink }}>{st.v}</div>
                  <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{st.l}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {loading && <div style={{ height: 3, background: `linear-gradient(90deg,${T.primary},${T.accent})`, margin: '4px 16px', borderRadius: 2 }} />}

        {view==='dia'
          ? <DayTimeline appts={selDayAppts} blocks={blocks} today={today} selectedDate={selectedDate} nowMin={nowMin} onTap={a => { setSelAppt(a); setSheet('detail') }} onRemoveBlock={removeBlock} />
          : <WeekView weekDates={displayDates} today={today} selectedDate={selectedDate} countByDate={weekCount} maxCount={maxCount} onPickDay={iso => { setSelDate(iso); setView('dia') }} />}

        <div style={{ height: 96 }} />
      </div>

      {/* FAB */}
      <button onClick={() => setSheet('add')} style={{ position: 'fixed', right: 18, bottom: 24, width: 56, height: 56, borderRadius: 999, border: 'none', cursor: 'pointer', background: T.primary, color: T.primaryInk, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px -6px rgba(0,0,0,0.4)', zIndex: 30 }}>
        <Icon name="plus" size={26} sw={2} />
      </button>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 100, display: 'flex', justifyContent: 'center', zIndex: 40, pointerEvents: 'none' }}>
          <div style={{ background: T.nav, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '9px 16px', borderRadius: 999, boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>{toast}</div>
        </div>
      )}

      {/* Sheets */}
      {sheet && (
        <Overlay onClose={() => setSheet(null)}>
          {sheet==='detail' && selAppt && <DetailSheet appt={selAppt} onCancel={cancelAppt} cancelling={cancelling} />}
          {sheet==='add'    && <AddSheet onBlock={() => setSheet('block')} onNew={() => setSheet(null)} />}
          {sheet==='block'  && <BlockSheet defaultDate={selectedDate} config={config} onConfirm={addBlock} />}
          {sheet==='config'   && <ConfigSheet config={config} onSave={async (c) => { await api.config.update(c); setConfig(prev => ({ ...prev, ...c })); setSheet(null); flash('Configurações salvas') }} />}
          {sheet==='menu'     && <MenuSheet onServices={() => { setSheet(null); navigate(`/${slug}/admin/services`) }} onPassword={() => setSheet('password')} onConfig={() => setSheet('config')} onLogout={() => { setSheet(null); logout() }} />}
          {sheet==='password' && <ChangePasswordSheet onDone={() => { setSheet(null); flash('Senha alterada com sucesso') }} />}
        </Overlay>
      )}
    </div>
  )
}

// ── DayTimeline ──────────────────────────────────────────────────
interface DayTimelineProps {
  appts: Appointment[]; blocks: TimeBlock[]; today: string
  selectedDate: string; nowMin: number
  onTap: (a: Appointment) => void
  onRemoveBlock: (id: number) => void
}

function DayTimeline({ appts, blocks, today, selectedDate, nowMin, onTap, onRemoveBlock }: DayTimelineProps) {
  const total = (WORK_END - WORK_START) * PX_PER_MIN
  const hours = Array.from({ length: 10 }, (_, i) => 9+i)

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ position: 'relative', height: total, marginLeft: 50 }}>
        {hours.map((h, i) => (
          <div key={h} style={{ position: 'absolute', top: i*60*PX_PER_MIN, left: -50, right: 0 }}>
            <span style={{ position: 'absolute', left: 0, top: -7, fontSize: 10.5, color: T.inkSoft, width: 42, textAlign: 'right' }}>
              {`${String(h).padStart(2,'0')}:00`}
            </span>
            <div style={{ position: 'absolute', left: 8, right: 0, top: 0, height: 1, background: T.lineSoft }} />
          </div>
        ))}

        {appts.map(a => {
          const startMin = timeMin(a.start_time), endMin = timeMin(a.end_time)
          const top    = (startMin - WORK_START) * PX_PER_MIN
          const height = Math.max((endMin - startMin) * PX_PER_MIN - 4, 26)
          const c      = serviceTint(a.service_id)
          const isNow  = selectedDate===today && nowMin>=startMin && nowMin<endMin
          return (
            <button key={a.id} onClick={() => onTap(a)} style={{
              position: 'absolute', top, left: 8, right: 0, height,
              borderRadius: T.radiusSm, border: 'none', cursor: 'pointer', textAlign: 'left',
              background: c.tint, padding: '8px 12px', overflow: 'hidden',
              display: 'flex', flexDirection: 'column', gap: 2,
              boxShadow: isNow ? `0 0 0 2px ${T.primary}, 0 6px 16px -8px rgba(0,0,0,0.3)` : 'none',
            }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: c.ink, borderRadius: '4px 0 0 4px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name={serviceIcon(a.service_id)} size={14} color={c.ink} sw={1.6} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.client_name.split(' ')[0]}</span>
              </div>
              {height > 40 && <span style={{ fontSize: 11.5, color: c.ink, fontWeight: 600 }}>{a.service_name} · {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)}</span>}
            </button>
          )
        })}

        {blocks.filter(b => b.date === selectedDate).map(b => {
          const startMin = timeMin(b.start_time)
          const endMin   = timeMin(b.end_time)
          const top    = (startMin - WORK_START) * PX_PER_MIN
          const height = Math.max((endMin - startMin) * PX_PER_MIN - 4, 26)
          return (
            <div key={b.id} style={{ position: 'absolute', top, left: 8, right: 0, height, borderRadius: T.radiusSm, border: `1px dashed ${T.line}`, background: `repeating-linear-gradient(45deg,${T.surfaceAlt},${T.surfaceAlt} 7px,transparent 7px,transparent 14px)`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', color: T.inkSoft, cursor: 'pointer' }}
              onClick={() => { if (window.confirm(`Remover bloqueio "${b.reason}"?`)) onRemoveBlock(b.id) }}>
              <Icon name="coffee" size={16} color={T.inkSoft} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{b.reason}</span>
              <span style={{ fontSize: 11, marginLeft: 'auto' }}>{b.start_time.slice(0,5)}–{b.end_time.slice(0,5)}</span>
            </div>
          )
        })}

        {selectedDate===today && nowMin>=WORK_START && nowMin<=WORK_END && (
          <div style={{ position: 'absolute', left: -50, right: 0, top: (nowMin-WORK_START)*PX_PER_MIN, height: 2, background: T.primary, zIndex: 5 }}>
            <div style={{ position: 'absolute', left: -2, top: -4, width: 9, height: 9, borderRadius: 999, background: T.primary }} />
            <span style={{ position: 'absolute', right: 0, top: -16, fontSize: 9.5, fontWeight: 700, color: T.primary, background: T.bg, padding: '0 4px' }}>{hhmm(nowMin)}</span>
          </div>
        )}

        {appts.length===0 && blocks.length===0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: T.inkSoft }}>
            <Icon name="calendar" size={40} color={T.line} />
            <span style={{ fontSize: 14 }}>Nenhum agendamento neste dia</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── WeekView ─────────────────────────────────────────────────────
interface WeekViewProps { weekDates: Date[]; today: string; selectedDate: string; countByDate: Record<string,number>; maxCount: number; onPickDay: (iso:string)=>void }

function WeekView({ weekDates, today, selectedDate, countByDate, maxCount, onPickDay }: WeekViewProps) {
  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {weekDates.map(d => {
          const iso = toISO(d), count = countByDate[iso]??0, isToday = iso===today, isSel = iso===selectedDate
          return (
            <button key={iso} onClick={() => onPickDay(iso)} style={{ flex: 1, border: 'none', cursor: 'pointer', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 0, fontFamily: T.body }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? T.primary : T.inkSoft, textTransform: 'uppercase' }}>{DOW[d.getDay()]}</div>
              <div style={{ width: '100%', height: 140, background: T.surface, border: `1px solid ${T.lineSoft}`, borderRadius: T.radiusSm, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 5, position: 'relative' }}>
                {(isToday || isSel) && <div style={{ position: 'absolute', inset: -1, border: `2px solid ${T.primary}`, borderRadius: T.radiusSm+1, pointerEvents: 'none' }} />}
                <div style={{ height: `${(count/maxCount)*100}%`, background: T.primarySoft, borderRadius: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 6, minHeight: 26 }}>
                  <span style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 18, color: T.primary }}>{count}</span>
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{d.getDate()}</div>
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: 12, color: T.inkSoft, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
        Toque num dia para abrir a agenda completa.<br />Segunda a sexta · 09:00–18:00
      </p>
    </div>
  )
}

// ── Overlay ──────────────────────────────────────────────────────
function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,18,14,0.4)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}

function SheetShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: T.surface, borderRadius: `${T.radius+8}px ${T.radius+8}px 0 0`, padding: '10px 20px 40px', boxShadow: '0 -10px 40px rgba(0,0,0,0.2)' }}>
      <div style={{ width: 38, height: 4, borderRadius: 999, background: T.line, margin: '0 auto 16px' }} />
      {children}
    </div>
  )
}

const fldS: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: `1.5px solid ${T.line}`, borderRadius: T.radiusSm, fontSize: 15, color: T.ink, background: T.surface, fontFamily: T.body, outline: 'none', appearance: 'none' as unknown as undefined }
const lblS: CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }

// ── DetailSheet ──────────────────────────────────────────────────
function DetailSheet({ appt: a, onCancel, cancelling }: { appt: Appointment; onCancel: (id:string)=>void; cancelling: boolean }) {
  const c = serviceTint(a.service_id)
  return (
    <SheetShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: c.tint, color: c.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={serviceIcon(a.service_id)} size={26} sw={1.5} />
        </div>
        <div>
          <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 22, color: T.ink, lineHeight: 1.1 }}>{a.service_name}</div>
          <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 2 }}>{a.start_time.slice(0,5)} – {a.end_time.slice(0,5)} · {dur(a.service_duration)}</div>
        </div>
      </div>
      {[['Cliente', a.client_name], ['WhatsApp', phoneMask(a.client_phone)], ['Valor', brl(Number(a.service_price))], ['Via', a.created_via]].map(([k,v], i) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderTop: `1px solid ${T.lineSoft}`, borderBottom: i===3 ? `1px solid ${T.lineSoft}` : 'none' }}>
          <span style={{ fontSize: 13.5, color: T.inkSoft }}>{k}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{v}</span>
        </div>
      ))}
      <a href={`https://wa.me/${a.client_phone}`} target="_blank" rel="noreferrer" style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: '#25d366', color: '#fff', borderRadius: T.radius, padding: '14px', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
        <Icon name="whatsapp" size={20} color="#fff" sw={1.6} /> Chamar no WhatsApp
      </a>
      <button onClick={() => { if (window.confirm(`Cancelar agendamento de ${a.client_name}?`)) onCancel(a.id) }} disabled={cancelling} style={{ marginTop: 10, width: '100%', background: 'transparent', color: '#c2453b', border: `1.5px solid #e7b3ae`, borderRadius: T.radius, padding: '13px', fontWeight: 700, fontSize: 14.5, fontFamily: T.body, cursor: 'pointer' }}>
        {cancelling ? 'Cancelando…' : 'Cancelar agendamento'}
      </button>
    </SheetShell>
  )
}

// ── AddSheet ─────────────────────────────────────────────────────
function AddSheet({ onBlock, onNew }: { onBlock: ()=>void; onNew: ()=>void }) {
  const opt = (icon: string, title: string, sub: string, onClick: ()=>void, primary: boolean) => (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: primary ? T.primarySoft : T.surfaceAlt, border: 'none', cursor: 'pointer', borderRadius: T.radius, padding: '15px 16px', marginBottom: 10, fontFamily: T.body }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', color: primary ? T.primary : T.inkSoft }}><Icon name={icon} size={22} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: T.ink }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 1 }}>{sub}</div>
      </div>
      <Icon name="chevronRight" size={18} color={T.inkSoft} />
    </button>
  )
  return (
    <SheetShell>
      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 16 }}>Adicionar</div>
      {opt('calendar', 'Novo agendamento', 'Abre a página pública de agendamento', onNew, true)}
      {opt('moon', 'Bloquear horário', 'Folga, almoço ou compromisso pessoal', onBlock, false)}
    </SheetShell>
  )
}

// ── BlockSheet ───────────────────────────────────────────────────
function BlockSheet({ defaultDate, config, onConfirm }: { defaultDate: string; config: StudioConfig; onConfirm: (date:string, start:string, end:string, reason:string)=>void }) {
  const presets = [
    { label: 'Almoço',       start: '12:00', end: '13:00' },
    { label: 'Pausa',        start: '15:00', end: '15:30' },
    { label: 'Folga (tarde)',start: '13:00', end: '18:00' },
  ]
  const [date, setDate]     = useState(defaultDate)
  const [start, setStart]   = useState('12:00')
  const [end, setEnd]       = useState('13:00')
  const [reason, setReason] = useState('Almoço')
  const times = allTimeSlots()

  return (
    <SheetShell>
      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 4 }}>Bloquear horário</div>
      <p style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 16 }}>Esse período some da agenda pública.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {presets.map(p => (
          <button key={p.label} onClick={() => { setStart(p.start); setEnd(p.end); setReason(p.label) }}
            style={{ border: `1px solid ${reason===p.label ? T.primary : T.line}`, background: reason===p.label ? T.primarySoft : T.surface, color: reason===p.label ? T.primary : T.inkSoft, borderRadius: 999, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: T.body }}>
            {p.label}
          </button>
        ))}
      </div>

      <label style={lblS}>Data</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...fldS, marginBottom: 14 }} />

      <label style={lblS}>Motivo</label>
      <input value={reason} onChange={e => setReason(e.target.value)} style={{ ...fldS, marginBottom: 14 }} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={lblS}>Início</label>
          <select value={start} onChange={e => setStart(e.target.value)} style={fldS}>
            {times.map(tm => <option key={tm} value={tm}>{tm}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lblS}>Fim</label>
          <select value={end} onChange={e => setEnd(e.target.value)} style={fldS}>
            {times.filter(tm => tm > start).map(tm => <option key={tm} value={tm}>{tm}</option>)}
          </select>
        </div>
      </div>

      <button onClick={() => onConfirm(date, start, end, reason)} style={{ marginTop: 22, width: '100%', background: T.primary, color: T.primaryInk, border: 'none', borderRadius: T.radius, padding: '15px', fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: T.body }}>
        Bloquear {start}–{end}
      </button>
    </SheetShell>
  )
}

// ── MenuSheet ────────────────────────────────────────────────────
function MenuSheet({ onServices, onPassword, onConfig, onLogout }: { onServices:()=>void; onPassword:()=>void; onConfig:()=>void; onLogout:()=>void }) {
  const row = (icon: string, title: string, sub: string, onClick: ()=>void, danger = false) => (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: T.surfaceAlt, border: 'none', cursor: 'pointer', borderRadius: T.radius, padding: '15px 16px', marginBottom: 10, fontFamily: T.body }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? '#c2453b' : T.primary }}><Icon name={icon} size={22} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: danger ? '#c2453b' : T.ink }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 1 }}>{sub}</div>
      </div>
      <Icon name="chevronRight" size={18} color={T.inkSoft} />
    </button>
  )
  return (
    <SheetShell>
      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 16 }}>Menu</div>
      {row('polish',   'Gerenciar serviços',  'Preços, durações e ativar/desativar', onServices)}
      {row('calendar', 'Configurações',        'Dias e horários de funcionamento',    onConfig)}
      {row('shield',   'Alterar senha',        'Troque a senha de acesso ao painel',  onPassword)}
      {row('close',    'Sair',                 'Encerrar a sessão da Michele',        onLogout, true)}
    </SheetShell>
  )
}

// ── ConfigSheet ───────────────────────────────────────────────────
const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function getSlug(): string {
  try {
    const token = localStorage.getItem('token') ?? ''
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.studio_slug ?? ''
  } catch { return '' }
}

function ConfigSheet({ config, onSave }: { config: StudioConfig; onSave: (c: Partial<StudioConfig>) => Promise<void> }) {
  const [days, setDays]     = useState<number[]>(config.work_days)
  const [start, setStart]   = useState(config.work_start)
  const [end, setEnd]       = useState(config.work_end)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const times = allTimeSlots()

  const slug    = getSlug()
  const bookUrl = `${window.location.origin}/book/${slug}`

  function share() {
    if (navigator.share) {
      navigator.share({ title: 'Agende aqui', url: bookUrl })
    } else {
      navigator.clipboard.writeText(bookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function handleSave() {
    setSaving(true)
    await onSave({ work_days: days, work_start: start, work_end: end })
    setSaving(false)
  }

  return (
    <SheetShell>
      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 4 }}>Configurações</div>
      <p style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 20 }}>Define quando o estúdio aceita agendamentos.</p>

      <label style={lblS}>Dias de funcionamento</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[1,2,3,4,5,6,0].map(d => {
          const on = days.includes(d)
          return (
            <button key={d} onClick={() => toggleDay(d)} style={{
              padding: '9px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: T.body,
              fontSize: 13, fontWeight: 700,
              border: `1px solid ${on ? T.primary : T.line}`,
              background: on ? T.primarySoft : T.surface,
              color: on ? T.primary : T.inkSoft,
            }}>
              {DAY_LABELS[d]}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <label style={lblS}>Abre às</label>
          <select value={start} onChange={e => setStart(e.target.value)} style={fldS}>
            {times.map(tm => <option key={tm} value={tm}>{tm}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lblS}>Fecha às</label>
          <select value={end} onChange={e => setEnd(e.target.value)} style={fldS}>
            {times.filter(tm => tm > start).map(tm => <option key={tm} value={tm}>{tm}</option>)}
          </select>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving || days.length === 0} style={{ width: '100%', background: T.primary, color: T.primaryInk, border: 'none', borderRadius: T.radius, padding: '15px', fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: T.body, opacity: saving || days.length === 0 ? 0.6 : 1 }}>
        {saving ? 'Salvando…' : 'Salvar configurações'}
      </button>

      {/* Link de agendamento */}
      <div style={{ marginTop: 18, background: T.surfaceAlt, borderRadius: T.radiusSm, padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Link das clientes
        </div>
        <div style={{ fontSize: 13, color: T.ink, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 12 }}>
          {bookUrl}
        </div>
        <button onClick={share} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: copied ? '#16a34a' : T.surface, color: copied ? '#fff' : T.primary,
          border: `1.5px solid ${copied ? '#16a34a' : T.primary}`,
          borderRadius: T.radiusSm, padding: '11px', fontWeight: 700, fontSize: 14,
          cursor: 'pointer', fontFamily: T.body, transition: 'all .2s',
        }}>
          <Icon name={copied ? 'check' : 'whatsapp'} size={18} color={copied ? '#fff' : T.primary} sw={1.8} />
          {copied ? 'Link copiado!' : 'Compartilhar agenda'}
        </button>
      </div>
    </SheetShell>
  )
}

// ── ChangePasswordSheet ───────────────────────────────────────────
function ChangePasswordSheet({ onDone }: { onDone: ()=>void }) {
  const [current, setCurrent]   = useState('')
  const [next, setNext]         = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [show, setShow]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 6)  { setError('Nova senha deve ter ao menos 6 caracteres.'); return }
    if (next !== confirm)  { setError('As senhas não coincidem.'); return }
    setSaving(true)
    try {
      await api.auth.changePassword(current, next)
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SheetShell>
      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 4 }}>Alterar senha</div>
      <p style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 18 }}>Escolha uma senha forte de pelo menos 6 caracteres.</p>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: T.radiusSm, padding: '10px 14px', fontSize: 14, marginBottom: 14 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <label style={lblS}>Senha atual</label>
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <input type={show ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" style={{ ...fldS, paddingRight: 56 }} required />
          <button type="button" onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 6, top: 6, bottom: 6, width: 44, border: 'none', background: 'transparent', color: T.inkSoft, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: T.body }}>{show ? 'ocultar' : 'ver'}</button>
        </div>

        <label style={lblS}>Nova senha</label>
        <input type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)} placeholder="Mínimo 6 caracteres" style={{ ...fldS, marginBottom: 14 }} required />

        <label style={lblS}>Confirmar nova senha</label>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repita a nova senha" style={{ ...fldS, borderColor: confirm && confirm !== next ? '#fca5a5' : T.line }} required />

        <button type="submit" disabled={saving} style={{ marginTop: 22, width: '100%', background: T.primary, color: T.primaryInk, border: 'none', borderRadius: T.radius, padding: '15px', fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: T.body, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </SheetShell>
  )
}

// ── style helpers ────────────────────────────────────────────────
function iconBtnS(): CSSProperties { return { width: 40, height: 40, borderRadius: 999, border: `1px solid ${T.lineSoft}`, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' } }
function navBtnS(): CSSProperties  { return { width: 30, height: 30, borderRadius: 999, border: `1px solid ${T.lineSoft}`, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' } }
