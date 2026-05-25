import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * GET /favicon.ico
 *
 * Serves the favicon.png as favicon.ico to prevent browser 404s.
 * Browsers request /favicon.ico by default even when <link rel="icon" href="/favicon.png"> is set.
 */
export async function GET() {
  try {
    const filePath = join(process.cwd(), 'public', 'favicon.png')
    const buffer = await readFile(filePath)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not Found', { status: 404 })
  }
}
