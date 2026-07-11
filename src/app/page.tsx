'use client'

import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import AppShell from '@/components/layout/app-shell'

const TestSuitePage = dynamic(() => import('@/components/pages/test-suite-page'), {
  ssr: false,
})

export default function Home() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view')

  if (view === 'test-suite') {
    return <TestSuitePage />
  }

  return <AppShell />
}