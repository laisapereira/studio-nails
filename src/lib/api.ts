const BASE = '/api'

function token(): string | null {
  return localStorage.getItem('token')
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const t = token()
    if (t) headers['Authorization'] = `Bearer ${t}`
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  auth: {
    status: () =>
      req<{ setup: boolean }>('GET', '/auth/status', undefined, false),
    setup: (email: string, password: string, studio_name: string, slug: string) =>
      req<{ token: string }>('POST', '/auth/setup', { email, password, studio_name, slug }, false),
    login: (email: string, password: string) =>
      req<{ token: string }>('POST', '/auth/login', { email, password }, false),
    changePassword: (currentPassword: string, newPassword: string) =>
      req<void>('POST', '/auth/change-password', { currentPassword, newPassword }),
  },
  services: {
    list: (studio: string) =>
      req<{ services: ServiceApi[] }>('GET', `/services?studio=${studio}`, undefined, false)
        .then(r => r.services.map(apiServiceToService)),
    listAll: () =>
      req<ServiceRaw[]>('GET', '/services/all'),
    create: (data: Omit<ServiceRaw, 'id' | 'active' | 'created_at'>) =>
      req<ServiceRaw>('POST', '/services', data),
    update: (id: number, data: Partial<ServiceRaw>) =>
      req<ServiceRaw>('PATCH', `/services/${id}`, data),
    remove: (id: number) => req<void>('DELETE', `/services/${id}`),
  },
  appointments: {
    // Retorna Appointment[] desempacotando { appointments: [...] }
    list: (params?: { start?: string; end?: string; status?: string; phone?: string }) => {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null)) as Record<string, string>
      ).toString()
      return req<{ appointments: Appointment[] }>('GET', `/appointments${q ? '?' + q : ''}`)
        .then(r => r.appointments)
    },
    slots: (date: string, serviceId: number, studio: string) =>
      req<{ slots: { start: string; end: string }[] }>('GET', `/slots/available?date=${date}&service_id=${serviceId}&studio=${studio}`, undefined, false)
        .then(r => r.slots.map(s => s.start)),
    slotsWeek: (start: string, serviceId: number, studio: string) =>
      req<{ days: Record<string, { start: string; end: string }[]> }>(
        'GET', `/slots/week?start=${start}&service_id=${serviceId}&studio=${studio}`, undefined, false
      ).then(r => r.days),
    create: (data: CreateAppt) =>
      req<ApptCreated>('POST', '/appointments', data, false),
    cancel: (id: string, reason?: string) =>
      req<{ id: string; status: string }>('PATCH', `/appointments/${id}/cancel`, { reason }),
    update: (id: string, data: { status?: string; notes?: string }) =>
      req<Appointment>('PATCH', `/appointments/${id}/cancel`, data),
  },
  dashboard: {
    stats: (start?: string, end?: string) => {
      const q = new URLSearchParams({ ...(start ? { start } : {}), ...(end ? { end } : {}) }).toString()
      return req<DashStats>('GET', `/dashboard/stats${q ? '?' + q : ''}`)
    },
  },
  config: {
    get: (studio?: string) =>
      studio
        ? req<StudioConfig>('GET', `/config?studio=${studio}`, undefined, false)
        : req<StudioConfig>('GET', '/config/me'),
    update: (data: Partial<StudioConfig>) => req<void>('PATCH', '/config', data),
  },
  blocks: {
    list: (start?: string, end?: string) => {
      const q = new URLSearchParams({ ...(start ? { start } : {}), ...(end ? { end } : {}) }).toString()
      return req<{ blocks: TimeBlock[] }>('GET', `/blocks${q ? '?' + q : ''}`)
        .then(r => r.blocks)
    },
    create: (data: { date: string; start_time: string; end_time: string; reason: string }) =>
      req<TimeBlock>('POST', '/blocks', data),
    remove: (id: number) => req<void>('DELETE', `/blocks/${id}`),
  },
}

// ── Types ─────────────────────────────────────────────────────

// Shape retornada pelo GET /api/services (formato bot)
interface ServiceApi {
  id: string           // slug
  numeric_id: number
  name: string
  duration_minutes: number
  price: number
  color: string
  emoji: string
}

// Shape interna do frontend (compatível com admin panel)
export interface Service {
  id: number
  slug: string | null
  name: string
  duration: number
  price: number
  color: string
  emoji: string
  active: boolean
  created_at: string
}

// Shape bruta retornada pelo listAll (admin)
export interface ServiceRaw {
  id: number
  slug: string | null
  name: string
  duration: number
  price: number
  color: string
  emoji: string
  active: boolean
  created_at: string
}

function apiServiceToService(s: ServiceApi): Service {
  return {
    id:         s.numeric_id,
    slug:       s.id,
    name:       s.name,
    duration:   s.duration_minutes,
    price:      s.price,
    color:      s.color,
    emoji:      s.emoji,
    active:     true,
    created_at: '',
  }
}

export interface Appointment {
  id: string
  date: string
  start_time: string
  end_time: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  client_name: string
  client_phone: string
  service_id: number
  service_name: string
  service_duration: number
  service_price: number
  service_color: string
  service_emoji: string
  notes?: string
  created_via: string
}

export interface CreateAppt {
  client_name: string
  client_phone?: string
  phone?: string
  service?: string       // slug (bot)
  service_id?: number    // numeric (booking page)
  date: string
  start_time: string
  created_via?: string
}

export interface ApptCreated {
  id: string
  status: string
  service: string
  date: string
  start_time: string
  end_time: string
}

export interface DashStats {
  totalAppointments: number
  totalRevenue: number
  totalHours: number
  confirmed: number
  completed: number
  cancelled: number
}

export interface StudioConfig {
  studio_name: string
  studio_slug: string
  work_days:   number[]
  work_start:  string
  work_end:    string
}

export interface TimeBlock {
  id:         number
  date:       string
  start_time: string
  end_time:   string
  reason:     string
  created_at: string
}
