import { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Booking  from './pages/Booking'
import Admin    from './pages/Admin'
import Services from './pages/Services'
import Login    from './pages/Login'
import Setup    from './pages/Setup'

function PrivateRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('token')
  const { slug } = useParams()
  return token ? <>{children}</> : <Navigate to={`/${slug}/login`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Página pública de agendamento */}
        <Route path="/book/:slug" element={<Booking />} />

        {/* Setup global — criação de novo estúdio */}
        <Route path="/setup" element={<Setup />} />

        {/* Área admin — cada estúdio tem seu próprio slug */}
        <Route path="/:slug/login"          element={<Login />} />
        <Route path="/:slug/admin"          element={<PrivateRoute><Admin /></PrivateRoute>} />
        <Route path="/:slug/admin/services" element={<PrivateRoute><Services /></PrivateRoute>} />

        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
