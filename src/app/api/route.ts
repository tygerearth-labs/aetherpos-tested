import { safeJson } from '@/lib/api/safe-response'

export async function GET() {
  return safeJson({ message: "Hello, world!" });
}
