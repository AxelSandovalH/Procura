import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "@/lib/ui/status";

export function StatusBadge({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone], className)}>{label}</span>;
}
