import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Icon } from '../components/Icon'
import { T } from '../theme/terra'

export default function Setup() {
  const navigate = useNavigate()
  const [studioName, setStudioName] = useState('')
  const [slug, setSlug]             = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  function handleStudioName(val: string) {
    setStudioName(val)
    if (!slug || slug === toSlug(studioName)) {
      setSlug(toSlug(val))
    }
  }

  function toSlug(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError('Senha deve ter ao menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    if (!/^[a-z0-9-]+$/.test(slug)) { setError('Slug deve conter apenas letras minúsculas, números e hífens.'); return }

    setLoading(true)
    try {
      const { token } = await api.auth.setup(email, password, studioName, slug)
      localStorage.setItem('token', token)
      navigate(`/${slug}/admin`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta.')
    } finally {
      setLoading(false)
    }
  }

  const fld = {
    width: '100%', boxSizing: 'border-box' as const, padding: '13px 14px',
    border: `1.5px solid ${T.line}`, borderRadius: T.radiusSm, fontSize: 15,
    color: T.ink, background: T.surface, fontFamily: T.body, outline: 'none',
  }
  const lbl = {
    display: 'block', fontSize: 11.5, fontWeight: 700, color: T.inkSoft,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6,
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: T.body, display: 'flex', flexDirection: 'column' }}>

      <div style={{ position: 'relative', paddingTop: 64, paddingBottom: 30, textAlign: 'center', background: T.primary, color: T.primaryInk, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', top: -70, right: -60 }} />
        <div style={{ position: 'absolute', width: 150, height: 150, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', bottom: -50, left: -40 }} />
        <div style={{ width: 60, height: 60, borderRadius: 999, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Icon name="sparkle" size={30} color={T.primaryInk} sw={1.5} fill />
        </div>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: 'uppercase', opacity: 0.8, fontWeight: 600 }}>Novo estúdio</div>
        <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 32, lineHeight: 1.05, marginTop: 4 }}>Criar minha conta</div>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.85, marginTop: 6 }}>Agendamento online</div>
      </div>

      <div style={{ flex: 1, padding: '30px 24px', maxWidth: 440, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <p style={{ fontSize: 13, color: T.inkSoft, textAlign: 'center', marginTop: 0, marginBottom: 26, lineHeight: 1.6 }}>
          Cada estúdio tem seu próprio link de agendamento.<br />
          Você pode ter quantos quiser.
        </p>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: T.radiusSm, padding: '11px 14px', fontSize: 14, marginBottom: 20 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={lbl}>Nome do estúdio</label>
          <input style={fld} type="text" placeholder="Ex: Studio da Michele" value={studioName} onChange={e => handleStudioName(e.target.value)} required />

          <div style={{ marginTop: 14 }}>
            <label style={lbl}>Link de agendamento</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: T.inkSoft, pointerEvents: 'none' }}>
                /book/
              </span>
              <input
                style={{ ...fld, paddingLeft: 58, fontFamily: 'monospace' }}
                type="text"
                placeholder="michele"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                required
              />
            </div>
            <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 6 }}>
              Clientes acessam em: <strong style={{ color: T.ink }}>/book/{slug || 'seu-slug'}</strong>
            </p>
          </div>

          <div style={{ height: 20, borderTop: `1px solid ${T.lineSoft}`, margin: '20px 0 20px' }} />

          <label style={lbl}>Seu e-mail</label>
          <input style={fld} type="email" autoComplete="email" placeholder="voce@email.com" value={email} onChange={e => setEmail(e.target.value)} required />

          <div style={{ height: 14 }} />
          <label style={lbl}>Senha</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...fld, paddingRight: 56 }} type={showPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShowPass(s => !s)} style={{ position: 'absolute', right: 6, top: 6, bottom: 6, width: 44, border: 'none', background: 'transparent', color: T.inkSoft, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: T.body }}>
              {showPass ? 'ocultar' : 'ver'}
            </button>
          </div>

          <div style={{ height: 14 }} />
          <label style={lbl}>Confirme a senha</label>
          <input
            style={{ ...fld, borderColor: confirm && confirm !== password ? '#fca5a5' : T.line }}
            type={showPass ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Repita a senha"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />

          <button type="submit" disabled={loading || !studioName || !slug || !email || !password || password !== confirm} style={{
            marginTop: 26, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            background: T.primary, color: T.primaryInk, border: 'none', borderRadius: T.radius,
            padding: '16px', fontSize: 16, fontWeight: 700, fontFamily: T.body,
            cursor: loading ? 'default' : 'pointer',
            opacity: (loading || !studioName || !slug || !email || !password || password !== confirm) ? 0.5 : 1,
            boxShadow: '0 10px 24px -10px rgba(0,0,0,0.4)',
          }}>
            {loading ? 'Criando estúdio…' : 'Criar estúdio e entrar'}
            {!loading && <Icon name="arrowRight" size={19} color={T.primaryInk} />}
          </button>
        </form>

        <p style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: T.inkSoft }}>
          Já tem conta? Acesse <strong>/seu-slug/login</strong>
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 24, color: T.inkSoft }}>
          <Icon name="shield" size={15} color={T.accent} />
          <span style={{ fontSize: 11.5 }}>Senha armazenada com criptografia</span>
        </div>
      </div>
    </div>
  )
}
