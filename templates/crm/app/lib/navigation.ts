import type { CrmKind } from "@/lib/types";

export type CrmView =
  | "work"
  | CrmKind
  | "record"
  | "views"
  | "ask"
  | "setup"
  | "settings";

export const CRM_VIEW_PATHS: Record<Exclude<CrmView, "record">, string> = {
  work: "/",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  views: "/views",
  ask: "/ask",
  setup: "/setup",
  settings: "/settings",
};

export function viewFromPath(pathname: string): CrmView {
  if (pathname.startsWith("/records/")) return "record";
  if (pathname.startsWith("/accounts")) return "account";
  if (pathname.startsWith("/people")) return "person";
  if (pathname.startsWith("/opportunities")) return "opportunity";
  if (pathname.startsWith("/views")) return "views";
  if (pathname.startsWith("/ask")) return "ask";
  if (pathname.startsWith("/setup")) return "setup";
  if (pathname.startsWith("/settings")) return "settings";
  return "work";
}

export function pathForView(view?: string, recordId?: string): string {
  if (view === "record" && recordId)
    return `/records/${encodeURIComponent(recordId)}`;
  return CRM_VIEW_PATHS[view as Exclude<CrmView, "record">] ?? "/";
}
