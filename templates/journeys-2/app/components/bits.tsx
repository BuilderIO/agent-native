import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const TONES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  published: "bg-emerald-100 text-emerald-800",
  connected: "bg-emerald-100 text-emerald-800",
  verified: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  invited: "bg-amber-100 text-amber-800",
  "needs attention": "bg-amber-100 text-amber-800",
  draft: "bg-slate-100 text-slate-700",
  disconnected: "bg-slate-100 text-slate-700",
  finished: "bg-indigo-100 text-indigo-800",
  Hot: "bg-red-100 text-red-800",
  Warm: "bg-amber-100 text-amber-800",
  Cold: "bg-slate-100 text-slate-700",
};

export function Pill({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TONES[value] ?? "bg-slate-100 text-slate-700"}`}>{value}</span>;
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full p-6 ${wide ? "max-w-6xl" : "max-w-5xl"}`}>{children}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error instanceof Error ? error.message : "Something went wrong."}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export const tableCls = "w-full text-sm [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-b";

export const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
