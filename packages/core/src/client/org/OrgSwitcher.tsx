import { useEffect, useRef, useState } from "react";
import { IconBuilding, IconCheck, IconSelector } from "@tabler/icons-react";
import { useOrg, useSwitchOrg } from "./hooks.js";

export interface OrgSwitcherProps {
  className?: string;
  /** Hide entirely when the user only belongs to one org. Default: false. */
  hideWhenSingle?: boolean;
}

/**
 * Compact org switcher button. Shows the active org name; opens a dropdown of
 * other orgs the user belongs to. Renders nothing in solo / dev mode or when
 * the user has no orgs.
 *
 * Uses headless DOM (no shadcn deps) so it works in any template.
 */
export function OrgSwitcher({ className, hideWhenSingle }: OrgSwitcherProps) {
  const { data: org } = useOrg();
  const switchOrg = useSwitchOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!org || org.email === "local@localhost") return null;
  if (!org.orgId) return null;

  const orgs = org.orgs ?? [];
  const orgCount = orgs.length;
  if (hideWhenSingle && orgCount < 2) return null;

  const interactive = orgCount > 1;

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => interactive && setOpen((v) => !v)}
        disabled={!interactive}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground border border-border/50 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <IconBuilding className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1 text-left">{org.orgName}</span>
        {interactive && (
          <IconSelector className="h-3 w-3 shrink-0 opacity-50" />
        )}
      </button>
      {open && interactive && (
        <div className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-md border border-border bg-popover shadow-md py-1">
          {orgs.map((o) => (
            <button
              key={o.orgId}
              type="button"
              onClick={async () => {
                if (o.orgId === org.orgId) {
                  setOpen(false);
                  return;
                }
                try {
                  await switchOrg.mutateAsync(o.orgId);
                  setOpen(false);
                } catch {
                  /* error surfaced via switchOrg.error */
                }
              }}
              disabled={switchOrg.isPending}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              <IconBuilding className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1 text-left">{o.orgName}</span>
              {o.orgId === org.orgId && (
                <IconCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
