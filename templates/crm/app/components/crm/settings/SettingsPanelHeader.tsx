import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CrmSettingsPanelProps {
  /**
   * Drop the panel's own title and description where the surface already
   * names it, like its tab on the redesigned CRM › General page.
   */
  embedded?: boolean;
}

export function crmSettingsPanelClassName(
  embedded: boolean | undefined,
  width: "max-w-2xl" | "max-w-4xl" = "max-w-2xl",
): string {
  return embedded ? "w-full" : cn("mx-auto w-full", width);
}

export function CrmSettingsPanelHeader({
  embedded,
  title,
  description,
  descriptionClassName,
  action,
}: CrmSettingsPanelProps & {
  title: string;
  description?: string;
  descriptionClassName?: string;
  action?: ReactNode;
}) {
  if (embedded) {
    return action ? <div className="flex justify-end">{action}</div> : null;
  }
  const heading = (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p
          className={cn(
            "mt-1 text-sm leading-6 text-muted-foreground",
            descriptionClassName,
          )}
        >
          {description}
        </p>
      ) : null}
    </>
  );
  if (!action) return heading;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">{heading}</div>
      {action}
    </div>
  );
}
