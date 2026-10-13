import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { FiscalProviderError, withRetry } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

/** Emisores (personas con sus certificados) dados de alta en el proveedor fiscal, para elegir cuál firma las facturas de esta organización. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  try { return NextResponse.json({ data: await withRetry(() => getFiscalProvider().listIssuers()) }); }
  catch (e) { if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : 502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
});
