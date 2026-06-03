import { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Booking        from './pages/Booking'
import Admin          from './pages/Admin'
import Services       from './pages/Services'
import Login          from './pages/Login'
import Setup          from './pages/Setup'
import MyAppointments from './pages/MyAppointments'
import Vip            from './pages/Vip'

function PrivateRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('token')
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Página pública de agendamento */}
        <Route path="/book/:slug"          element={<Booking />} />
        <Route path="/meus-agendamentos" element={<MyAppointments />} />

        {/* Setup global — criação de novo estúdio */}
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />

        {/* Área admin — cada estúdio tem seu próprio slug */}
        <Route path="/:slug/admin"          element={<PrivateRoute><Admin /></PrivateRoute>} />
        <Route path="/:slug/admin/services" element={<PrivateRoute><Services /></PrivateRoute>} />
        <Route path="/:slug/admin/vip"      element={<PrivateRoute><Vip /></PrivateRoute>} />

        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
