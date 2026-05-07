import { backend } from "@/lib/api";
import { CandlesResponse, SymbolParam } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MinutesParam = z.coerce.number().int().min(1).max(1440);

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  const { symbol } = await params;
  const parsedSymbol = SymbolParam.safeParse(symbol);
  if (!parsedSymbol.success) return new NextResponse("invalid symbol", { status: 400 });
  const url = new URL(req.url);
  const parsedMinutes = MinutesParam.safeParse(url.searchParams.get("minutes") ?? 60);
  if (!parsedMinutes.success) return new NextResponse("invalid minutes", { status: 400 });
  try {
    const data = await backend(
      `/candles/${parsedSymbol.data}?minutes=${parsedMinutes.data}`,
      CandlesResponse,
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
