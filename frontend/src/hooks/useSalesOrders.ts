import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { salesOrdersApi, type SalesOrderListParams, type CreateSalesOrderRequest, type ReviewOrderRequest, type KeyedToObmRequest } from '@/api/salesOrders'

export function useSalesOrders(params?: SalesOrderListParams) {
  return useQuery({
    queryKey: ['sales-orders', params],
    queryFn: () => salesOrdersApi.list(params).then((res) => res.data),
  })
}

export function useSalesOrder(id: number) {
  return useQuery({
    queryKey: ['sales-orders', id],
    queryFn: () => salesOrdersApi.get(id).then((res) => res.data),
    enabled: !!id,
  })
}

export function useCreateSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSalesOrderRequest) => salesOrdersApi.create(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
    },
  })
}

export function useSubmitOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: { delivery_address?: string } }) =>
      salesOrdersApi.submit(id, data).then((res) => res.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id] })
    },
  })
}

export function useReviewOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReviewOrderRequest }) =>
      salesOrdersApi.review(id, data).then((res) => res.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id] })
    },
  })
}

export function useMarkKeyedToObm() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: KeyedToObmRequest }) =>
      salesOrdersApi.markKeyedToObm(id, data).then((res) => res.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id] })
    },
  })
}

export function useCancelOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => salesOrdersApi.cancel(id).then((res) => res.data),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id] })
    },
  })
}
