import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function PageShell({
  children,
  className,
  contentClassName
}: PageShellProps) {
  return (
    <main
      className={cn(
        "min-h-screen bg-background px-6 py-16 text-foreground",
        className
      )}
    >
      <div className={cn("mx-auto flex max-w-4xl flex-col gap-10", contentClassName)}>
        {children}
      </div>
    </main>
  );
}
