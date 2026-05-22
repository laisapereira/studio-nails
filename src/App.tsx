import { useState, useEffect, ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Booking from './pages/Booking'
import Admin   from './pages/Admin'
import Login   from './pages/Login'

function PrivateRoute({ session, children }: { session: Session | null; children: ReactNode }) {
  if (session === undefined) return null   // ainda carregando
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<Booking />} />
        <Route path="/login" element={session ? <Navigate to="/admin" replace /> : <Login />} />
        <Route
          path="/admin"
          element={
            <PrivateRoute session={session ?? null}>
              <Admin />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
