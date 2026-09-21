import { useCallback, useRef, useEffect } from 'react'
import client from '@/api/client'

interface GeoPosition {
  latitude: number
  longitude: number
  accuracy: number
}

export function useGeolocation() {
  const watchId = useRef<number | null>(null)

  const getCurrentPosition = useCallback((): Promise<GeoPosition | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    })
  }, [])

  const sendLocation = useCallback(async (source: string, opts?: { orderId?: number; customerId?: number }) => {
    const pos = await getCurrentPosition()
    if (!pos) return

    try {
      await client.post('/tracking/location', {
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
        source,
        order_id: opts?.orderId,
        customer_id: opts?.customerId,
      })
    } catch {
      // silent — location tracking is best-effort
    }
  }, [getCurrentPosition])

  const startHeartbeat = useCallback((intervalMs = 120000) => {
    if (watchId.current !== null) return

    sendLocation('HEARTBEAT')
    watchId.current = window.setInterval(() => {
      sendLocation('HEARTBEAT')
    }, intervalMs)
  }, [sendLocation])

  const stopHeartbeat = useCallback(() => {
    if (watchId.current !== null) {
      clearInterval(watchId.current)
      watchId.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopHeartbeat()
  }, [stopHeartbeat])

  return { getCurrentPosition, sendLocation, startHeartbeat, stopHeartbeat }
}
