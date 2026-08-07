import client from './client'
import type { LoginRequest, LoginResponse, AuthUser } from '@/types'

export const authApi = {
  login: (data: LoginRequest) =>
    client.post<LoginResponse>('/auth/login', data),

  logout: () =>
    client.post('/auth/logout'),

  getMe: () =>
    client.get<{ user: AuthUser }>('/auth/me'),

  changePassword: (data: { current_password: string; new_password: string }) =>
    client.post('/auth/change-password', data),
}
