import { NextResponse, type NextRequest } from "next/server";
import { getVisitorStats } from "@/lib/analytics/visitor-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || undefined;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const startDate = searchParams.get("startDate") || from || undefined;
    const endDate = searchParams.get("endDate") || to || undefined;
    const preset = searchParams.get("preset") || undefined;

    const stats = getVisitorStats({
      date,
      startDate,
      endDate,
      from,
      to,
      preset,
    });
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch visitor stats" },
      { status: 500 }
    );
  }
}
