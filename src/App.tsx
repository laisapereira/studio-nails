import { useState, useEffect, ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Booking  from './pages/Booking'
import Admin    from './pages/Admin'
import Services from './pages/Services'
import Login    from './pages/Login'
import Setup    from './pages/Setup'

function PrivateRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('token')
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    setAuthed(!!localStorage.getItem('token'))
  }, [])

  if (authed === null) return null

  return (
    <BrowserRouter>
      <Routes>
        {/* Página pública de agendamento — cada estúdio tem seu próprio slug */}
        <Route path="/book/:slug" element={<Booking />} />

        {/* Área admin */}
        <Route path="/setup" element={authed ? <Navigate to="/admin" replace /> : <Setup onSetup={() => setAuthed(true)} />} />
        <Route path="/login" element={authed ? <Navigate to="/admin" replace /> : <Login onLogin={() => setAuthed(true)} />} />
        <Route path="/admin"          element={<PrivateRoute><Admin /></PrivateRoute>} />
        <Route path="/admin/services" element={<PrivateRoute><Services /></PrivateRoute>} />

        {/* Raiz redireciona para login */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
