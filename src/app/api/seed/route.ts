import { NextRequest } from 'next/server';
import { seedDatabase } from '@/lib/seed';
import { getAuthUser, unauthorized } from '@/lib/get-auth';
import { safeJson } from '@/lib/safe-response';

export async function POST(request: NextRequest) {
  // ?force=true bypasses auth ONLY in development mode
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  let user = null;
  if (!force || process.env.NODE_ENV !== 'development') {
    user = await getAuthUser(request);
    if (!user) return unauthorized();
    if (user.role !== 'OWNER') {
      return safeJson({ error: 'Hanya pemilik yang dapat mengakses' }, 403);
    }
  }

  try {
    const result = await seedDatabase();
    return safeJson(result);
  } catch (error) {
    console.error('Seed error:', error);
    // Don't expose internal error details to client
    return safeJson(
      { error: 'Failed to seed database' },
      500
    );
  }
}
