import { NextResponse } from "next/server";
import { runDispatchCycle } from "@/lib/events/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Invocado por Vercel Cron cada minuto (vercel.json). Protegido por CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });

  const result = await runDispatchCycle();
  return NextResponse.json({ ok: true, ...result });
}
