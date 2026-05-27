'use client'

import { useServiceWorker } from '@/hooks/use-service-worker'

export function PwaRegister() {
  useServiceWorker()
  return null
}
