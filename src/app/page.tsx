import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/auth'
import AppShell from '@/components/layout/app-shell'

// Server component — fetches the session on the server and passes it to the
// client AppShell. This is the recommended NextAuth v4 + Next.js App Router
// pattern: it avoids the client-side session fetch round-trip and prevents
// the `useSession()` hook from getting stuck on `status === 'loading'` when
// the client-side fetch is slow or blocked.
export default async function Home() {
  const session = await getServerSession(authOptions)
  return <AppShell session={session} />
}