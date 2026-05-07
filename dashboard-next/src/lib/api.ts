/**
 * Server-side wrapper around the FastAPI backend.
 *
 * Critical: this module is only imported by route handlers (server) and
 * server components. It must never be bundled into the client. The
 * FastAPI host is private (Cloud Run --no-allow-unauthenticated); we
 * authenticate with the Cloud Run service identity by minting a Google
 * ID token for the API URL audience.
 *
 * The browser never sees API_BASE_URL or any token — it only talks to
 * /api/* routes hosted by Next.js itself.
 */
import { z } from "zod";

const API_BASE = process.env.API_BASE_URL;
if (!API_BASE) {
  // Don't throw at module-load — Next.js evaluates this in build too.
  // Throw at first request so build still works without env vars.
  console.warn("[api] API_BASE_URL not set; requests will fail at runtime");
}

const METADATA_SERVER_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a Google-issued ID token for the FastAPI audience.
 * On Cloud Run, the metadata server returns one for the active service
 * account. Cached for 50 minutes (tokens expire at 60).
 */
async function getIdToken(audience: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const url = `${METADATA_SERVER_TOKEN_URL}?audience=${encodeURIComponent(audience)}&format=full`;
  const res = await fetch(url, {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`metadata server returned ${res.status}`);
  }
  const token = (await res.text()).trim();
  cachedToken = { token, expiresAt: now + 50 * 60_000 };
  return token;
}

export async function backend<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
  if (!API_BASE) {
    throw new Error("API_BASE_URL is not configured");
  }
  let headers: Record<string, string> = { Accept: "application/json" };
  // Only attempt ID-token auth in real GCP environments.
  if (process.env.NODE_ENV === "production" && !process.env.SKIP_ID_TOKEN) {
    try {
      const token = await getIdToken(API_BASE);
      headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      // Fall through to unauthenticated — useful for local dev where
      // the API is publicly reachable.
      console.warn("[api] could not mint ID token, calling unauthenticated:", err);
    }
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`backend ${path} returned ${res.status}`);
  }
  const data = await res.json();
  return schema.parse(data);
}
