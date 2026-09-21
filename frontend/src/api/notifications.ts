import client from './client'

export interface Notification {
  id: number
  type: string
  title: string
  message: string
  link?: string
  is_read: boolean
  created_at?: string
}

export const notificationsApi = {
  list: (params?: { page?: number; page_size?: number; unread_only?: boolean }) =>
    client.get<{ items: Notification[]; total: number; page: number; page_size: number; pages: number }>(
      '/notifications', { params }
    ),

  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count'),

  markAllRead: () =>
    client.post('/notifications/mark-read'),
}
