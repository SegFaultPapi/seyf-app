import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.warn("[CSP Violation]", JSON.stringify(body, null, 2));
  } catch {
    // body may be empty or malformed — swallow silently
  }

  return new NextResponse(null, { status: 204 });
}
