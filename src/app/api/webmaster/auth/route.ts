import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return safeJsonError('Email dan password wajib diisi', 400)
    }

    const webmaster = await db.webmaster.findUnique({
      where: { email },
    })

    if (!webmaster) {
      return safeJsonError('Email tidak ditemukan', 401)
    }

    const isPasswordValid = await bcrypt.compare(password, webmaster.password)
    if (!isPasswordValid) {
      return safeJsonError('Password salah', 401)
    }

    return safeJson({
      id: webmaster.id,
      name: webmaster.name,
      email: webmaster.email,
      role: 'WEBMASTER',
    })
  } catch {
    return safeJsonError('Terjadi kesalahan internal')
  }
}
