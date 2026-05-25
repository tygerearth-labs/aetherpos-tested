import { safeJson } from '@/lib/safe-response'

export async function GET() {
  return safeJson({ message: "Hello, world!" });
}
