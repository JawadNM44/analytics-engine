import { backend } from "@/lib/api";
import { WhalesResponse } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LimitParam = z.coerce.number().int().min(1).max(100);

export async function GET(req: Request) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  const url = new URL(req.url);
  const parsed = LimitParam.safeParse(url.searchParams.get("limit") ?? 20);
  if (!parsed.success) return new NextResponse("invalid limit", { status: 400 });
  try {
    const data = await backend(`/whales/recent?limit=${parsed.data}`, WhalesResponse);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
