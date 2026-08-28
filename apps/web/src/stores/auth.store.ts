import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  username: string
  email: string
  role: string
  mfaEnabled: boolean
  channelId: string | null
  channel?: { id: string; name: string; code: string; type?: string; isMainWarehouse?: boolean }
  enterpriseId?: string | null
  enterprise?: { id: string; name: string; slug: string; logoUrl?: string; plan?: string }
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  isAuthenticated: boolean
  isPlatformOwnerSwitched: boolean
  setAuth: (tokens: { accessToken: string; refreshToken: string }, user: User) => void
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void
  switchWorkspace: (
    enterprise: { id: string; name: string; slug: string; plan?: string },
    channel: { id: string; name: string; code: string; type?: string; isMainWarehouse?: boolean },
    tokens: { accessToken: string; refreshToken: string }
  ) => void
  exitWorkspace: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isPlatformOwnerSwitched: false,
      setAuth: (tokens, user) =>
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user,
          isAuthenticated: true,
          isPlatformOwnerSwitched: false,
        }),
      setTokens: (tokens) =>
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
      switchWorkspace: (enterprise, channel, tokens) =>
        set((state) => ({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          isPlatformOwnerSwitched: true,
          user: state.user
            ? {
                ...state.user,
                enterpriseId: enterprise.id,
                enterprise,
                channelId: channel.id,
                channel,
              }
            : null,
        })),
      exitWorkspace: () =>
        set((state) => ({
          isPlatformOwnerSwitched: false,
          user: state.user
            ? {
                ...state.user,
                enterpriseId: null,
                enterprise: undefined,
              }
            : null,
        })),
      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isPlatformOwnerSwitched: false,
        }),
    }),
    {
      name: 'brayn-auth-storage',
    }
  )
)
