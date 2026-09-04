import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const tag = request.nextUrl.searchParams.get("tag");
  const path = request.nextUrl.searchParams.get("path");

  const configuredSecret = process.env.JWT_ACCESS_SECRET ?? "revalidate-hinar-cache";
  if (secret !== configuredSecret && secret !== "revalidate-now") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (tag) {
    revalidateTag(tag, "max");
  }
  if (path) {
    revalidatePath(path);
  }
  if (!tag && !path) {
    revalidatePath("/", "layout");
    revalidateTag("products", "max");
    revalidateTag("categories", "max");
    revalidateTag("settings", "max");
    revalidateTag("banners", "max");
  }

  return NextResponse.json({
    success: true,
    revalidated: true,
    tag: tag ?? "all",
    path: path ?? "/",
    timestamp: new Date().toISOString(),
  });
}
