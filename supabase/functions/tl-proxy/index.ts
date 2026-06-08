// TrustLayer API Proxy — Supabase Edge Function
// Deploy: supabase functions deploy tl-proxy
// Purpose: Relay write methods (POST/PATCH/PUT/DELETE) from the browser
// to TrustLayer's API server-to-server, bypassing CORS restrictions.
// GET requests are NOT proxied — they go direct from the browser.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://hubcertsecure.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: {
    method: string;
    url: string;
    body?: unknown;
    token: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { method, url, body: tlBody, token } = body;

  // Only allow write methods — GETs go direct from browser
  const allowed = ["POST", "PATCH", "PUT", "DELETE"];
  if (!allowed.includes(method?.toUpperCase())) {
    return new Response(
      JSON.stringify({ error: `Method ${method} not proxied. Use GET directly from browser.` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Must target TrustLayer API only
  if (!url?.startsWith("https://api.trustlayer.io/")) {
    return new Response(
      JSON.stringify({ error: "URL must target api.trustlayer.io" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!token) {
    return new Response(
      JSON.stringify({ error: "TrustLayer token required" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Forward to TrustLayer
  const fetchOpts: RequestInit = {
    method: method.toUpperCase(),
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };

  if (tlBody && ["POST", "PATCH", "PUT"].includes(method.toUpperCase())) {
    fetchOpts.body = JSON.stringify(tlBody);
  }

  try {
    const tlRes = await fetch(url, fetchOpts);
    const text = await tlRes.text();

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return new Response(JSON.stringify(data), {
      status: tlRes.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Proxy fetch failed: ${err instanceof Error ? err.message : err}` }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
