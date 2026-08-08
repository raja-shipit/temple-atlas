import { NextRequest, NextResponse } from "next/server";

// Basic auth for /admin — resolved decision (spec Section 6, 9): adequate
// for a single-maintainer tool, no Supabase Auth needed for v1.
export function middleware(request: NextRequest) {
  const basicAuth = request.headers.get("authorization");

  if (basicAuth) {
    const authValue = basicAuth.split(" ")[1];
    const [user, password] = Buffer.from(authValue, "base64")
      .toString()
      .split(":");

    if (
      user === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD
    ) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Temple Atlas Admin"' },
  });
}

export const config = {
  matcher: "/admin/:path*",
};
