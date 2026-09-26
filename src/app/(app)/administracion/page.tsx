"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { ADMIN_TABS } from "@/lib/ui/admin-tabs";

export default function AdminIndex() {
  const router = useRouter();
  const session = useSession();
  useEffect(() => {
    if (session.loading) return;
    const first = ADMIN_TABS.find((t) => t.perms.some((p) => session.can(p)));
    if (first) router.replace(first.href);
  }, [session, router]);
  return null;
}
