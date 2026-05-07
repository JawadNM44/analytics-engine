import { backend } from "@/lib/api";
import { StatsResponse } from "@/lib/schemas";
import { allow, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 2_000;
const STREAM_MAX_MS = 5 * 60_000; // 5 minutes; clients reconnect after

export async function GET(req: Request) {
  if (!allow(clientIp(req))) return new NextResponse("rate limited", { status: 429 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: string, data: unknown) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          /* connection closed */
        }
      }

      send("hello", { startedAt: new Date().toISOString() });

      while (Date.now() - startedAt < STREAM_MAX_MS) {
        try {
          const data = await backend("/stats", StatsResponse);
          send("stats", data);
        } catch (err) {
          send("error", { message: String(err) });
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
      send("bye", { reason: "stream-max" });
      controller.close();
    },
    cancel() {
      /* client disconnected; nothing to clean up */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
