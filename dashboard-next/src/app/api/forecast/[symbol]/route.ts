import { backend } from "@/lib/api";
import { ForecastResponse, SymbolParam } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HoursParam = z.coerce.number().int().min(1).max(24);

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  const { symbol } = await params;
  const parsedSymbol = SymbolParam.safeParse(symbol);
  if (!parsedSymbol.success) return new NextResponse("invalid symbol", { status: 400 });
  const url = new URL(req.url);
  const parsedHours = HoursParam.safeParse(url.searchParams.get("hours") ?? 6);
  if (!parsedHours.success) return new NextResponse("invalid hours", { status: 400 });
  try {
    const data = await backend(
      `/forecast/${parsedSymbol.data}?hours=${parsedHours.data}`,
      ForecastResponse,
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
