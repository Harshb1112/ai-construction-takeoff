import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Priority: query param → env var → default
  const baseUrl = (
    searchParams.get("baseUrl") ??
    process.env.LMSTUDIO_BASE_URL ??
    "http://localhost:1234/v1"
  ).replace(/\/+$/, ""); // strip trailing slash

  const modelsUrl = `${baseUrl}/models`;

  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      // Allow self-signed certs on local network
      ...(modelsUrl.startsWith("https") ? { dispatcher: undefined } : {}),
    });

    if (!res.ok) {
      return NextResponse.json({
        error: `LM Studio returned ${res.status}`,
        baseUrl,
        status: "error",
      }, { status: 503 });
    }

    const data = await res.json();
    const models = data.data ?? [];

    return NextResponse.json({
      models,
      baseUrl,
      status: "connected",
      modelCount: models.length,
    });

  } catch (err) {
    const msg = (err as Error).message;
    const isTimeout     = msg.includes("timeout") || msg.includes("TimeoutError");
    const isRefused     = msg.includes("ECONNREFUSED");
    const isUnreachable = msg.includes("ENETUNREACH") || msg.includes("ENOTFOUND");
    const isSsl         = msg.includes("SSL") || msg.includes("certificate");

    let hint = "Make sure LM Studio is running and Local Server is enabled";
    if (isRefused)     hint = `Connection refused at ${baseUrl}. Start LM Studio server.`;
    if (isUnreachable) hint = `Cannot reach ${baseUrl}. Check IP/network.`;
    if (isTimeout)     hint = `Timeout connecting to ${baseUrl}. Check firewall.`;
    if (isSsl)         hint = `SSL error. Try http:// instead of https://.`;

    return NextResponse.json({
      error: "Cannot connect to LM Studio",
      detail: msg,
      baseUrl,
      status: "offline",
      hint,
    }, { status: 503 });
  }
}
