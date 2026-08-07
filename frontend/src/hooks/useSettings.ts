import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi, type SettingsData } from '@/api/settings'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then((res) => res.data.items),
  })
}

export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: any }) =>
      settingsApi.update(key, value).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

export function useBulkUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: SettingsData) => settingsApi.bulkUpdate(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}
