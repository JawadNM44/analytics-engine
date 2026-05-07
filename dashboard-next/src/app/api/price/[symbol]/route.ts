import { backend } from "@/lib/api";
import { PriceResponse, SymbolParam } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  const { symbol } = await params;
  const parsed = SymbolParam.safeParse(symbol);
  if (!parsed.success) return new NextResponse("invalid symbol", { status: 400 });
  try {
    const data = await backend(`/price/${parsed.data}`, PriceResponse);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=5" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
