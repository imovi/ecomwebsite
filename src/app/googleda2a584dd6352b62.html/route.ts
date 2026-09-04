export async function GET() {
  return new Response("google-site-verification: googleda2a584dd6352b62.html\n", {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
