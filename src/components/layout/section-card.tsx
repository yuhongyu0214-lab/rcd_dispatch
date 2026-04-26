import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function SectionCard({
  children,
  className,
  ...props
}: SectionCardProps) {
  return (
    <section
      className={cn("rounded-3xl border border-slate-200 bg-white p-8 shadow-sm", className)}
      {...props}
    >
      {children}
    </section>
  );
}
