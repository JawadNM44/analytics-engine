import { backend } from "@/lib/api";
import { HealthResponse } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });
  try {
    const data = await backend("/health", HealthResponse);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { status: "degraded", error: String(err) },
      { status: 503 },
    );
  }
}
