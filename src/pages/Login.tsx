import { useState, FormEvent, CSSProperties } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: err } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (err) {
      setError('E-mail ou senha incorretos.')
    }
    // Sucesso: App.tsx detecta mudança de sessão e redireciona para /admin
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>💅</div>
        <h1 style={s.title}>Studio da Michele</h1>
        <p style={s.sub}>Acesso exclusivo</p>

        <form onSubmit={handleSubmit} style={s.form}>
          {error && <div style={s.error}>{error}</div>}

          <div style={s.group}>
            <label style={s.label}>E-mail</label>
            <input
              style={s.input}
              type="email"
              autoComplete="email"
              placeholder="michele@exemplo.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={s.group}>
            <label style={s.label}>Senha</label>
            <input
              style={s.input}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#fdf2f8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '40px 32px',
    width: '100%',
    maxWidth: 380,
    boxShadow: '0 4px 24px rgba(214,51,132,0.10)',
    textAlign: 'center',
  },
  logo: { fontSize: 52, marginBottom: 12 },
  title: { margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#831843' },
  sub: { margin: '0 0 28px', fontSize: 14, color: '#9ca3af' },
  form: { textAlign: 'left' },
  error: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 14,
    marginBottom: 16,
  },
  group: { marginBottom: 18 },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '2px solid #fce7f3',
    borderRadius: 10,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    color: '#1f2937',
    background: '#fff',
  },
  btn: {
    width: '100%',
    padding: '14px',
    background: '#d63384',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
  },
}
