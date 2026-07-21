import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconArrowUpRight, IconDatabaseOff } from "@tabler/icons-react";
import { Link } from "react-router";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-2 p-5 sm:p-7">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function SetupEmptyState({
  title = "Connect a CRM to begin",
  description = "CRM works from the workspace connections you authorize. No credentials are stored in this app.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <IconDatabaseOff className="size-5" />
        </div>
        <h2 className="mt-4 text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        <Button asChild variant="outline" className="mt-5 gap-2">
          <Link to="/settings#connections">
            Open shared connections <IconArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
