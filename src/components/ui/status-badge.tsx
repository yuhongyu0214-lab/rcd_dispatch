import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusBadgeTone = "primary" | "muted";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusBadgeTone;
};

const toneClassName: Record<StatusBadgeTone, string> = {
  primary: "bg-blue-50 text-primary",
  muted: "bg-slate-100 text-slate-700"
};

export function StatusBadge({
  children,
  tone = "muted"
}: StatusBadgeProps) {
  return (
    <span className={cn("rounded-full px-4 py-2 text-sm", toneClassName[tone])}>
      {children}
    </span>
  );
}
