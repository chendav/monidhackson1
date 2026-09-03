import { GET as getHealth } from "@/app/api/v1/health/route";

export const runtime = "nodejs";

export async function GET() {
  return getHealth();
}
