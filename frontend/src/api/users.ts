import client from './client'
import type { User, PaginatedResponse } from '@/types'

export interface UserListParams {
  page?: number
  per_page?: number
  search?: string
  role?: string
  is_active?: boolean
}

export interface CreateUserRequest {
  username: string
  full_name: string
  email: string
  phone: string
  role: string
  password: string
}

export interface UpdateUserRequest {
  full_name?: string
  email?: string
  phone?: string
  role?: string
  is_active?: boolean
}

export interface UserCredential {
  id: number
  username: string
  full_name: string
  role: string
  temp_password: string | null
}

export const usersApi = {
  list: (params?: UserListParams) =>
    client.get<User[]>('/users', { params }),

  get: (id: number) =>
    client.get<User>(`/users/${id}`),

  create: (data: CreateUserRequest) =>
    client.post<User>('/users', data),

  update: (id: number, data: UpdateUserRequest) =>
    client.patch<User>(`/users/${id}`, data),

  toggleActive: (id: number, isActive: boolean) =>
    isActive
      ? client.post<User>(`/users/${id}/deactivate`)
      : client.post<User>(`/users/${id}/activate`),

  resetPassword: (id: number) =>
    client.post<{ temporary_password: string }>(`/users/${id}/reset-password`),

  credentials: () =>
    client.get<UserCredential[]>('/users/credentials'),
}
