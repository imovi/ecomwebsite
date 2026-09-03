import { NextResponse, type NextRequest } from "next/server";
import { recordVisitorEvent } from "@/lib/analytics/visitor-store";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forwardHeader = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const ip = forwardHeader.split(",")[0]?.trim() || "";
    const userAgent = request.headers.get("user-agent") || "";

    recordVisitorEvent({
      type: body.type || "pageview",
      visitorId: body.visitorId,
      sessionId: body.sessionId,
      pagePath: body.pagePath,
      pageTitle: body.pageTitle,
      productId: body.productId,
      referrer: body.referrer,
      userAgent,
      ip,
    });

    return new NextResponse(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("product") || "";
  const { getProductLiveVisitors, getLiveVisitorsCount } = await import("@/lib/analytics/visitor-store");

  const liveCount = product ? getProductLiveVisitors(product) : getLiveVisitorsCount();
  return NextResponse.json({ liveCount }, { headers: CORS_HEADERS });
}
