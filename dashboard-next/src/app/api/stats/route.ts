import { backend } from "@/lib/api";
import { StatsResponse } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  try {
    const data = await backend("/stats", StatsResponse);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
