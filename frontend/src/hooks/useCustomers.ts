import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customersApi, type CustomerListParams, type CreateCustomerRequest, type UpdateCustomerRequest } from '@/api/customers'

export function useCustomers(params?: CustomerListParams) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => customersApi.list(params).then((res) => res.data),
  })
}

export function useAllCustomers(params?: CustomerListParams) {
  return useQuery({
    queryKey: ['customers', 'all', params],
    queryFn: () => customersApi.listAll(params).then((res) => res.data),
  })
}

export function useCustomer(id: number) {
  return useQuery({
    queryKey: ['customers', id],
    queryFn: () => customersApi.get(id).then((res) => res.data),
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCustomerRequest) => customersApi.create(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCustomerRequest }) =>
      customersApi.update(id, data).then((res) => res.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['customers', id] })
    },
  })
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}
