import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ServiceRaw } from '../lib/api'
import { Icon } from '../components/Icon'
import { T, serviceTint, serviceIcon } from '../theme/terra'

type Service = ServiceRaw

const EMPTY: Omit<Service, 'id' | 'active' | 'created_at'> = {
  name: '', duration: 60, price: 0, color: T.primary, emoji: '', slug: '',
}

export default function Services() {
  const navigate = useNavigate()
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading]   = useState(true)
  const [sheet, setSheet]       = useState<'edit' | 'new' | null>(null)
  const [editSvc, setEditSvc]   = useState<Service | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [form, setForm]         = useState({ ...EMPTY })

  async function load() {
    try {
      setLoading(true)
      setServices(await api.services.listAll())
    } catch {
      localStorage.removeItem('token')
      navigate('/login')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openEdit(svc: Service) {
    setEditSvc(svc)
    setForm({ name: svc.name, duration: svc.duration, price: Number(svc.price), color: svc.color, emoji: svc.emoji, slug: svc.slug ?? '' })
    setError(null)
    setSheet('edit')
  }

  function openCreate() {
    setEditSvc(null)
    setForm({ ...EMPTY })
    setError(null)
    setSheet('new')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editSvc) {
        await api.services.update(editSvc.id, form)
      } else {
        await api.services.create(form)
      }
      setSheet(null)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(svc: Service) {
    await api.services.update(svc.id, { active: !svc.active })
    await load()
  }

  const dur = (m: number) => { const h=Math.floor(m/60), r=m%60; return h===0?`${r}min`:r===0?`${h}h`:`${h}h${String(r).padStart(2,'0')}` }
  const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace('.',',')}`

  const fld = {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '13px 14px', border: `1.5px solid ${T.line}`,
    borderRadius: T.radiusSm, fontSize: 15, color: T.ink,
    background: T.surface, fontFamily: T.body, outline: 'none',
    appearance: 'none' as const,
  }
  const lbl = {
    display: 'block', fontSize: 11.5, fontWeight: 700,
    color: T.inkSoft, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, marginBottom: 6,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: T.bg, color: T.ink, fontFamily: T.body }}>

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.lineSoft}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 20px' }}>
          <button onClick={() => navigate('/admin')} style={{ width: 36, height: 36, borderRadius: 999, border: `1px solid ${T.lineSoft}`, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Icon name="chevronLeft" size={18} color={T.ink} />
          </button>
          <div>
            <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Painel</div>
            <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 24, lineHeight: 1, color: T.ink }}>Serviços</div>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, padding: '18px 18px 110px' }}>
        <p style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 16 }}>
          Toque para editar preço e duração. Serviços pausados somem do agendamento online.
        </p>

        {loading ? (
          <p style={{ color: T.inkSoft, fontSize: 14 }}>Carregando…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {services.map(svc => {
              const c = serviceTint(svc.id)
              return (
                <div key={svc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px',
                  background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius,
                  opacity: svc.active ? 1 : 0.55,
                }}>
                  <button onClick={() => openEdit(svc)} style={{ display: 'flex', alignItems: 'center', gap: 13, flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: T.body }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: c.tint, color: c.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={serviceIcon(svc.id)} size={22} sw={1.5} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc.name}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>
                        {dur(svc.duration)} · <strong style={{ color: T.ink }}>{brl(Number(svc.price)).replace('R$ ','R$')}</strong>
                        {!svc.active && ' · pausado'}
                        {svc.slug && <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>#{svc.slug}</span>}
                      </div>
                    </div>
                  </button>
                  <Toggle on={svc.active} onClick={() => toggleActive(svc)} />
                </div>
              )
            })}
          </div>
        )}

        <button onClick={openCreate} style={{
          marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          background: 'transparent', border: `1.5px dashed ${T.line}`, color: T.primary,
          borderRadius: T.radius, padding: '15px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: T.body,
        }}>
          <Icon name="plus" size={19} color={T.primary} sw={2} /> Adicionar serviço
        </button>
      </div>

      {/* Sheet overlay */}
      {sheet && (
        <Overlay onClose={() => setSheet(null)}>
          <div style={{ background: T.surface, borderRadius: `${T.radius+8}px ${T.radius+8}px 0 0`, padding: '10px 20px 40px', boxShadow: '0 -10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ width: 38, height: 4, borderRadius: 999, background: T.line, margin: '0 auto 16px' }} />
            <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 23, color: T.ink, marginBottom: 18 }}>
              {sheet === 'edit' ? 'Editar serviço' : 'Novo serviço'}
            </div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: T.radiusSm, padding: '10px 14px', fontSize: 14, marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <label style={lbl}>Nome</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Esmaltação Completa" style={fld} required />

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Duração</label>
                  <select value={form.duration} onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))} style={fld}>
                    {[30, 40, 45, 60, 90, 120, 150, 180].map(m => <option key={m} value={m}>{dur(m)}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Preço (R$)</label>
                  <input
                    value={form.price} inputMode="numeric"
                    onChange={e => setForm(f => ({ ...f, price: Number(e.target.value.replace(/\D/g,'')) || 0 }))}
                    style={fld}
                  />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={lbl}>ID do bot (slug)</label>
                <input
                  value={form.slug ?? ''}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g,'_') }))}
                  placeholder="Ex: gel, esmaltacao"
                  style={fld}
                />
                <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 6 }}>Usado pelo WhatsApp bot para reconhecer o serviço.</p>
              </div>

              <button type="submit" disabled={saving} style={{
                marginTop: 22, width: '100%', background: T.primary, color: T.primaryInk, border: 'none',
                borderRadius: T.radius, padding: '15px', fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: T.body,
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>

              {sheet === 'edit' && editSvc && (
                <button type="button" onClick={async () => {
                  if (window.confirm(`Desativar "${editSvc.name}"?`)) {
                    await api.services.update(editSvc.id, { active: false })
                    setSheet(null)
                    await load()
                  }
                }} style={{ marginTop: 10, width: '100%', background: 'transparent', color: '#c2453b', border: `1.5px solid #e7b3ae`, borderRadius: T.radius, padding: '13px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: T.body }}>
                  Desativar serviço
                </button>
              )}
            </form>
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 46, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
      background: on ? T.primary : T.line, position: 'relative', transition: 'background .2s', padding: 0,
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
    </button>
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,18,14,0.4)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}
