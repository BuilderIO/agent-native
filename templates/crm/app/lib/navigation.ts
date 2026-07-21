import type { CrmKind } from "@/lib/types";

export type CrmView = "work" | CrmKind | "record" | "views" | "ask" | "setup";

export const CRM_VIEW_PATHS: Record<Exclude<CrmView, "record">, string> = {
  work: "/",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  views: "/views",
  ask: "/ask",
  setup: "/setup",
};

export function viewFromPath(pathname: string): CrmView {
  if (pathname.startsWith("/records/")) return "record";
  if (pathname.startsWith("/accounts")) return "account";
  if (pathname.startsWith("/people")) return "person";
  if (pathname.startsWith("/opportunities")) return "opportunity";
  if (pathname.startsWith("/views")) return "views";
  if (pathname.startsWith("/ask")) return "ask";
  if (pathname.startsWith("/setup")) return "setup";
  return "work";
}

export function pathForView(view?: string, recordId?: string): string {
  if (view === "record" && recordId) return `/records/${encodeURIComponent(recordId)}`;
  return CRM_VIEW_PATHS[view as Exclude<CrmView, "record">] ?? "/";
}
