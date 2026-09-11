import { IconHelpCircle } from "@tabler/icons-react";

import { cn } from "../lib/utils";

export const DISPATCH_DOCS = {
  dispatch: "https://agent-native.com/docs/dispatch#what-it-does",
  workspace: "https://agent-native.com/docs/agent-resources#global-resources",
  integrations: "https://agent-native.com/docs/dispatch#secret-vault",
  audit: "https://agent-native.com/docs/audit-log",
  threadDebug: "https://agent-native.com/docs/dispatch#reliability",
  dreams: "https://agent-native.com/docs/dispatch#dreams",
  settings: "https://agent-native.com/docs/agent-surfaces",
} as const;

export function dispatchDocsHrefForPath(pathname: string): string | undefined {
  if (pathname === "/admin/workspace") return DISPATCH_DOCS.workspace;
  if (pathname === "/admin/integrations") return DISPATCH_DOCS.integrations;
  if (pathname === "/admin/audit") return DISPATCH_DOCS.audit;
  if (pathname === "/admin/thread-debug") return DISPATCH_DOCS.threadDebug;
  if (pathname === "/admin/dreams") return DISPATCH_DOCS.dreams;
  if (pathname.startsWith("/admin/")) return DISPATCH_DOCS.dispatch;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return DISPATCH_DOCS.settings;
  }
  return undefined;
}

export function DocsLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground",
        className,
      )}
    >
      <IconHelpCircle className="size-3" />
    </a>
  );
}
