import type { CrmKind } from "@/lib/types";

export type CrmView =
  | "work"
  | CrmKind
  | "record"
  | "tasks"
  | "proposals"
  | "views"
  | "dashboard"
  | "ask"
  | "setup"
  | "settings";

export const CRM_VIEW_PATHS: Record<Exclude<CrmView, "record">, string> = {
  work: "/",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  tasks: "/tasks",
  proposals: "/proposals",
  views: "/views",
  dashboard: "/dashboard",
  ask: "/ask",
  setup: "/setup",
  settings: "/settings",
};

export function viewFromPath(pathname: string): CrmView {
  if (pathname.startsWith("/records/")) return "record";
  if (pathname.startsWith("/accounts")) return "account";
  if (pathname.startsWith("/people")) return "person";
  if (pathname.startsWith("/opportunities")) return "opportunity";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/proposals")) return "proposals";
  if (pathname.startsWith("/views")) return "views";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/ask")) return "ask";
  if (pathname.startsWith("/setup")) return "setup";
  if (pathname.startsWith("/settings")) return "settings";
  return "work";
}

export function pathForView(
  view?: string,
  recordId?: string,
  settingsSection?: "intelligence",
): string {
  if (view === "record" && recordId)
    return `/records/${encodeURIComponent(recordId)}`;
  if (view === "settings" && settingsSection === "intelligence")
    return "/settings/intelligence";
  return CRM_VIEW_PATHS[view as Exclude<CrmView, "record">] ?? "/";
}
