import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    service: "procura",
    api: "v1",
    status: "ok",
    time: new Date().toISOString(),
  });
}
