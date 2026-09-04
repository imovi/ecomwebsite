import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "facebook.com",
  "tiktokcdn.com",
  "byteoversea.com",
  "ibyteimg.com",
];

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

async function fetchImageBuffer(imageUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function fetchByReelId(reelId: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    const embedRes = await fetch(`https://www.instagram.com/reel/${reelId}/embed/`);
    if (!embedRes.ok) return null;

    const html = await embedRes.text();
    const dMatch = html.match(/\\"display_url\\":\\"(https:[^"\s]+?)\\"/);
    if (!dMatch) return null;

    let posterUrl: string;
    try {
      posterUrl = JSON.parse(`"${dMatch[1]}"`);
    } catch {
      posterUrl = dMatch[1].replace(/\\+(\/)/g, "/").replace(/\\u0026/g, "&");
    }
    posterUrl = posterUrl.replace(/\\+(\/)/g, "/");

    if (!posterUrl.startsWith("http")) return null;

    return await fetchImageBuffer(posterUrl);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  const reelId = request.nextUrl.searchParams.get("id");

  if (!targetUrl && !reelId) {
    return NextResponse.json(
      { success: false, error: "Missing url or id parameter" },
      { status: 400 },
    );
  }

  let result: { buffer: ArrayBuffer; contentType: string } | null = null;

  if (targetUrl) {
    try {
      const parsed = new URL(targetUrl);
      if (isAllowedHost(parsed.hostname)) {
        result = await fetchImageBuffer(targetUrl);
      }
    } catch {
      // Invalid URL syntax
    }
  }

  // Fallback to fresh resolve by Reel ID if direct URL failed or wasn't provided
  if (!result && reelId && /^[a-zA-Z0-9_-]+$/.test(reelId)) {
    result = await fetchByReelId(reelId);
  }

  if (!result) {
    return NextResponse.json({ success: false, error: "Image unavailable" }, { status: 404 });
  }

  return new NextResponse(result.buffer, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
