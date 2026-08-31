const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api-production-f729.up.railway.app'
if (!process.env.NEXT_PUBLIC_API_URL && process.env.NODE_ENV === 'production') {
  console.warn('[INFO] Using production fallback for API URL.')
}
const API_BASE = `${rawApiUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '').replace(/\/v1$/, '')}/v1`

interface FetchOptions extends RequestInit {
  token?: string
}

let isRefreshing = false
let refreshPromise: Promise<any> | null = null

export class ApiError extends Error {
  status: number
  statusCode: number
  code?: string
  data?: unknown
  [key: string]: unknown
  constructor(message: string, status: number, code?: string, data?: unknown, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.statusCode = status
    this.code = code
    this.data = data
    if (details) Object.assign(this, details)
    this.name = 'ApiError'
  }
}

export function sanitizeErrorMessage(rawMessage: unknown): string {
  if (!rawMessage) return 'An unexpected error occurred. Please try again.'
  const msg = String(rawMessage).trim()
  if (!msg) return 'An unexpected error occurred. Please try again.'

  const lower = msg.toLowerCase()

  // Database / Prisma connection error
  if (
    lower.includes('reach database') ||
    lower.includes('database server') ||
    lower.includes('15432') ||
    lower.includes('econnrefused') ||
    lower.includes('prisma') ||
    lower.includes('invocation in')
  ) {
    return 'Unable to connect to the database server. Please ensure the database is running and try again.'
  }

  // Network / Fetch failure
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('enotfound')
  ) {
    return 'Unable to reach the server. Please check your network connection or make sure the API is running.'
  }

  // SQL / DB syntax / Internal errors
  if (
    lower.includes('syntax error') ||
    lower.includes('column') ||
    lower.includes('relation') ||
    lower.includes('pg_') ||
    lower.includes('select ') ||
    lower.includes('update ') ||
    lower.includes('insert ')
  ) {
    return 'A database error occurred. Please try again shortly.'
  }

  return msg
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options
  const cleanPath = path.startsWith('/api/v1') ? path.replace('/api/v1', '') : path

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${cleanPath}`, {
      ...fetchOptions,
      headers,
      cache: 'no-store',
    })
  } catch (fetchErr: any) {
    const cleanMsg = sanitizeErrorMessage(fetchErr?.message || fetchErr)
    throw new ApiError(cleanMsg, 0, 'NETWORK_ERROR')
  }

  if (res.status === 401 && !path.includes('/auth/refresh') && !path.includes('/auth/login')) {
    // Attempt silent refresh
    const { useAuthStore } = await import('../stores/auth.store')
    const { refreshToken, setTokens, logout } = useAuthStore.getState()

    if (refreshToken) {
      try {
        if (!isRefreshing) {
          isRefreshing = true
          refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          }).then(async (r) => {
            if (!r.ok) throw new Error('Refresh failed')
            return r.json()
          })
        }

        const data = await refreshPromise
        setTokens(data)
        isRefreshing = false
        refreshPromise = null

        // Retry the original request with the NEW token
        return apiFetch<T>(path, { ...options, token: data.accessToken })
      } catch (err) {
        isRefreshing = false
        refreshPromise = null
        logout()
        if (typeof window !== 'undefined') window.location.href = '/login'
        throw err
      }
    } else {
      logout()
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ message: res.statusText })) as Record<string, unknown>
    const rawErrorMessage = String(errorBody.message || errorBody.error || `API Error: ${res.status}`)
    const errorMessage = sanitizeErrorMessage(rawErrorMessage)
    
    // Log specialized warning for multi-tenancy blocks
    if (res.status === 403) {
      console.warn(`[api] Security Block on ${path}:`, errorMessage)
    } else {
      console.error(`[api] Request to ${path} failed (${res.status}):`, errorMessage)
    }

    throw new ApiError(
      errorMessage,
      res.status,
      typeof errorBody.code === 'string' ? errorBody.code : undefined,
      errorBody.data,
      errorBody
    )
  }


  // Handle 204 No Content or empty responses
  if (res.status === 204) {
    return {} as T
  }

  const text = await res.text()
  return text ? JSON.parse(text) : ({} as T)
}

export const api = {
  get: <T>(path: string, token?: string) =>
    apiFetch<T>(path, { method: 'GET', token }),

  post: <T>(path: string, body: unknown, token?: string, extraHeaders?: Record<string, string>) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      token,
      headers: extraHeaders,
    }),

  patch: <T>(path: string, body: unknown, token?: string) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      token,
    }),

  put: <T>(path: string, body: unknown, token?: string) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      token,
    }),

  delete: <T>(path: string, token?: string, body?: any) =>
    apiFetch<T>(path, { 
      method: 'DELETE', 
      token,
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
} as const
