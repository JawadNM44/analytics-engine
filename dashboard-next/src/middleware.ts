import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: "/api/:path*" };

export function middleware(req: NextRequest) {
  // Block non-GET on API. Read-only system; CSRF surface = zero.
  if (req.method !== "GET") {
    return new NextResponse("method not allowed", { status: 405 });
  }
  return NextResponse.next();
}
