import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, VipContact } from '../lib/api'
import { Icon } from '../components/Icon'
import { T } from '../theme/terra'

function applyPhoneMask(digits: string): string {
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`
}

export default function Vip() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()

  const [contacts, setContacts] = useState<VipContact[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [name,  setName]  = useState('')
  const [phone, setPhone] = useState('')
  const [note,  setNote]  = useState('')

  async function load() {
    try {
      setLoading(true)
      setContacts(await api.vip.list())
    } catch {
      localStorage.removeItem('token')
      navigate(`/${slug}/login`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.vip.add(phone.replace(/\D/g, ''), name.trim(), note.trim() || undefined)
      setName(''); setPhone(''); setNote('')
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(phone: string) {
    await api.vip.remove(phone)
    setContacts(prev => prev.filter(c => c.phone !== phone))
  }

  const fld = {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '12px 14px', border: `1.5px solid ${T.line}`,
    borderRadius: T.radiusSm, fontSize: 15, color: T.ink,
    background: T.surface, fontFamily: T.body, outline: 'none',
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: T.body }}>
      {/* Header */}
      <div style={{ background: T.primary, color: T.primaryInk, padding: '40px 20px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={() => navigate(`/${slug}/admin`)} style={{ background: 'transparent', border: 'none', color: T.primaryInk, cursor: 'pointer', padding: 0, display: 'flex' }}>
          <Icon name="arrowLeft" size={24} color={T.primaryInk} sw={2} />
        </button>
        <div>
          <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 24 }}>Contatos VIP</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>Pessoas que não recebem mensagens automáticas do bot</div>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px' }}>

        {/* Botão adicionar */}
        <button
          onClick={() => { setShowForm(s => !s); setError(null) }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: T.primary, color: T.primaryInk, border: 'none',
            borderRadius: T.radius, padding: '14px', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: T.body, marginBottom: 20,
          }}
        >
          <Icon name="plus" size={18} color={T.primaryInk} sw={2} />
          {showForm ? 'Cancelar' : 'Adicionar contato VIP'}
        </button>

        {/* Formulário */}
        {showForm && (
          <form onSubmit={handleSubmit} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: '16px', marginBottom: 20 }}>
            {error && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: T.radiusSm, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                placeholder="Nome"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                style={fld}
              />
              <input
                placeholder="Telefone (ex: 71 99999-0001)"
                value={phone}
                onChange={e => setPhone(applyPhoneMask(e.target.value.replace(/\D/g, '')))}
                required
                style={fld}
              />
              <input
                placeholder="Nota (ex: mãe, marido, pai)"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={fld}
              />
              <button
                type="submit"
                disabled={saving}
                style={{
                  background: T.primary, color: T.primaryInk, border: 'none',
                  borderRadius: T.radius, padding: '13px', fontSize: 15,
                  fontWeight: 700, cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.7 : 1, fontFamily: T.body,
                }}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        )}

        {/* Lista */}
        {loading && <p style={{ textAlign: 'center', color: T.inkSoft }}>Carregando…</p>}

        {!loading && contacts.length === 0 && (
          <div style={{ textAlign: 'center', color: T.inkSoft, marginTop: 40 }}>
            <Icon name="shield" size={36} color={T.line} sw={1.5} />
            <p style={{ marginTop: 12, fontSize: 14 }}>Nenhum contato VIP cadastrado.</p>
          </div>
        )}

        {contacts.map(c => (
          <div
            key={c.phone}
            style={{
              background: T.surface, border: `1px solid ${T.line}`,
              borderRadius: T.radius, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10,
            }}
          >
            <div style={{ width: 42, height: 42, borderRadius: 999, background: T.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="user" size={20} color={T.primary} sw={1.5} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
              <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 1 }}>
                {applyPhoneMask(c.phone)}
                {c.note && <span style={{ marginLeft: 6, background: T.line, borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>{c.note}</span>}
              </div>
            </div>
            <button
              onClick={() => handleRemove(c.phone)}
              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 6, display: 'flex' }}
            >
              <Icon name="trash" size={18} color="#ef4444" sw={1.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
