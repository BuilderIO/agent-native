import {
  requestAgentSidebarOpen,
  startAgentChatViewTransition,
} from "@agent-native/core/client/agent-chat";
import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  IconCamera,
  IconCompass,
  IconCopy,
  IconDotsVertical,
  IconExternalLink,
  IconNotebook,
} from "@tabler/icons-react";
import { forwardRef } from "react";

import { toast } from "../../../../hooks/use-toast.js";
import type {
  DataWidgetChartAction,
  DataWidgetActionIcon,
  DataWidgetDataSource,
  DataWidgetDisplay,
  DataWidgetDisplayAction,
} from "./data-widget-types.js";

const SAFE_ACTION_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function normalizeActionHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const hasWindow = typeof window !== "undefined";
  const isRelative =
    !/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !trimmed.startsWith("//");
  const base = hasWindow ? window.location.href : "http://agent-native.local/";
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }

  if (!SAFE_ACTION_PROTOCOLS.has(url.protocol)) return null;

  if (!hasWindow && isRelative) {
    return appPath(`${url.pathname}${url.search}${url.hash}`);
  }

  if (hasWindow && url.origin === window.location.origin) {
    return appPath(`${url.pathname}${url.search}${url.hash}`);
  }

  return url.toString();
}

function navigateSameAppHref(href: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(href, window.location.href);
  startAgentChatViewTransition(() => {
    requestAgentSidebarOpen();
    window.history.pushState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

const WidgetActionLink = forwardRef<
  HTMLAnchorElement,
  {
    href: string;
    label: string;
    className: string;
    icon?: DataWidgetActionIcon;
    iconOnly?: boolean;
  }
>(function WidgetActionLink({ href, label, className, icon, iconOnly }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          typeof window === "undefined"
        ) {
          return;
        }

        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;

        event.preventDefault();
        navigateSameAppHref(href);
      }}
      className={className}
    >
      <span className={iconOnly ? "sr-only" : "truncate"}>{label}</span>
      {icon === "explore" ? (
        <IconCompass aria-hidden="true" className="size-3.5 shrink-0" />
      ) : icon === "camera" ? (
        <IconCamera aria-hidden="true" className="size-3.5 shrink-0" />
      ) : icon === "notebook" ? (
        <IconNotebook aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <IconExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      )}
    </a>
  );
});

type PreparedDisplayAction =
  | {
      type: "link";
      action: Extract<DataWidgetDisplayAction, { type: "link" }>;
      href: string;
      key: string;
    }
  | {
      type: "copy";
      action: Extract<DataWidgetDisplayAction, { type: "copy" }>;
      href: null;
      key: string;
    };

export function DataWidgetDisplayControls({
  display,
  chartActions = [],
  variant = "primary",
  kind = "chart",
}: {
  display?: DataWidgetDisplay;
  chartActions?: DataWidgetChartAction[];
  variant?: "primary" | "secondary" | "quiet";
  kind?: "chart" | "table";
}) {
  const t = useT();
  const copyText = async (text: string) => {
    let copied = false;
    try {
      copied = await writeClipboardText(text);
    } catch {
      copied = false;
    }

    toast({
      title: copied
        ? t("agentChat.common.copied")
        : t("agentChat.recovery.copyFailed"),
    });
  };
  const displayActions: DataWidgetDisplayAction[] = [
    ...(display?.actions ?? []),
    ...chartActions.map((action) => ({ ...action, type: "link" as const })),
  ];
  const primary = display?.primaryAction
    ? {
        ...display.primaryAction,
        href: normalizeActionHref(display.primaryAction.href),
      }
    : null;
  const actions: PreparedDisplayAction[] = [];
  for (const [index, action] of displayActions.entries()) {
    if (action.type === "link") {
      const href = normalizeActionHref(action.href);
      if (href) {
        actions.push({
          type: "link",
          action,
          href,
          key: action.id ?? `link-${index}`,
        });
      }
      continue;
    }
    actions.push({
      type: "copy",
      action,
      href: null,
      key: action.id ?? `copy-${index}`,
    });
  }
  const directActions = actions.filter(
    (item): item is Extract<PreparedDisplayAction, { type: "link" }> =>
      item.type === "link" && item.action.presentation === "icon",
  );
  const overflowActions = actions.filter(
    (item) => item.type !== "link" || item.action.presentation !== "icon",
  );
  const actionsLabel =
    kind === "table"
      ? t("agentChat.widget.tableActions", { defaultValue: "Table actions" })
      : t("agentChat.widget.chartActions", { defaultValue: "Chart actions" });

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {primary?.href ? (
        <WidgetActionLink
          href={primary.href}
          label={primary.label}
          icon={primary.icon}
          className={
            variant === "secondary"
              ? "inline-flex max-w-44 items-center gap-1.5 truncate rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground no-underline hover:bg-muted hover:no-underline"
              : variant === "quiet"
                ? "inline-flex max-w-44 items-center gap-1.5 truncate rounded-sm px-1 py-0.5 text-[11px] font-medium text-muted-foreground no-underline hover:bg-muted hover:text-foreground hover:no-underline"
                : "inline-flex max-w-44 items-center gap-1.5 truncate rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground no-underline hover:bg-primary/90 hover:no-underline"
          }
        />
      ) : null}
      {directActions.map((item) => (
        <WidgetActionLink
          key={item.key}
          href={item.href}
          label={item.action.label}
          icon={item.action.icon}
          iconOnly
          className={`inline-flex ${variant === "quiet" ? "size-7" : "size-8"} shrink-0 items-center justify-center rounded-md ${variant === "quiet" ? "" : "border border-border"} text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        />
      ))}
      {overflowActions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={actionsLabel}
              title={actionsLabel}
              className={`inline-flex ${variant === "quiet" ? "size-7" : "size-8"} shrink-0 items-center justify-center rounded-md ${variant === "quiet" ? "" : "border border-border"} text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <IconDotsVertical aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflowActions.map((item) =>
              item.type === "copy" ? (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={() => void copyText(item.action.text)}
                >
                  <IconCopy aria-hidden="true" className="size-4" />
                  {item.action.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={item.key} asChild>
                  <WidgetActionLink
                    href={item.href}
                    label={item.action.label}
                    icon={
                      item.action.type === "link" ? item.action.icon : undefined
                    }
                    className="flex w-full items-center justify-between gap-3"
                  />
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function DataWidgetSourceChips({
  sources,
}: {
  sources: DataWidgetDataSource[];
}) {
  const t = useT();

  if (sources.length === 0) return null;

  return (
    <div
      aria-label={t("agentChat.widget.dataSources", {
        defaultValue: "Data sources",
      })}
      className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2"
      role="group"
    >
      <span className="text-[10px] font-medium text-muted-foreground">
        {t("agentChat.widget.dataSources", { defaultValue: "Data sources" })}
      </span>
      {sources.map((source, index) => {
        const href = source.href ? normalizeActionHref(source.href) : null;
        const className =
          "inline-flex max-w-52 items-center truncate rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground no-underline hover:bg-muted hover:text-foreground hover:no-underline";

        return href ? (
          <WidgetActionLink
            key={source.id ?? `${source.label}-${index}`}
            href={href}
            label={source.label}
            className={className}
          />
        ) : (
          <span
            key={source.id ?? `${source.label}-${index}`}
            className={className}
          >
            {source.label}
          </span>
        );
      })}
    </div>
  );
}
