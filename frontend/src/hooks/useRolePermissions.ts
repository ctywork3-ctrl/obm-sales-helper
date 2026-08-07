import { useQuery } from '@tanstack/react-query'
import client from '@/api/client'

interface RolePermission {
  id: number
  role: string
  page_key: string
  label: string
  is_visible: boolean
}

interface RolePermissionsByRole {
  role: string
  pages: RolePermission[]
}

export function useRolePermissions() {
  return useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => client.get<RolePermissionsByRole[]>('/role-permissions').then((res) => res.data),
    staleTime: 300000,
  })
}
