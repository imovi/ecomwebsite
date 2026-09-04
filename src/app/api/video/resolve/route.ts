import { NextResponse, type NextRequest } from "next/server";
import { resolveDirectVideoUrl } from "@/lib/video-embed";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ success: false, error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const info = await resolveDirectVideoUrl(url);
    if (!info) {
      return NextResponse.json({ success: false, error: "Could not parse video URL" }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: info });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Resolution failed" },
      { status: 500 },
    );
  }
}
