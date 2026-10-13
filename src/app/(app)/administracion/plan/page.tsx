import { redirect } from "next/navigation";

/** La suscripción ahora es su propio módulo (/suscripcion). Esta ruta se conserva para los enlaces anteriores. */
export default async function PlanAntiguo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  redirect(`/suscripcion${q ? `?${q}` : ""}`);
}
