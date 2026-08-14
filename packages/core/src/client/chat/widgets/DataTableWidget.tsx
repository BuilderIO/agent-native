import { IconDownload, IconExternalLink, IconTable } from "@tabler/icons-react";

import { requestAgentSidebarOpen } from "../../agent-sidebar-state.js";
import { appPath } from "../../api-path.js";
import { startAgentChatViewTransition } from "../../chat-view-transition.js";
import { downloadFile, toCSVTable } from "../../db-admin/export-utils.js";
import { DEFAULT_LOCALE, useOptionalLocale, useT } from "../../i18n.js";
import { cn } from "../../utils.js";
import type { DataTableWidget as DataTableWidgetData } from "./data-widget-types.js";

const SAFE_ACTION_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function formatCell(
  value: unknown,
  locale?: string,
  booleanLabels: { yes: string; no: string } = { yes: "Yes", no: "No" },
): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean")
    return value ? booleanLabels.yes : booleanLabels.no;
  if (typeof value === "number") return value.toLocaleString(locale);
  if (Array.isArray(value))
    return value
      .map((item) => formatCell(item, locale, booleanLabels))
      .join(", ");
  if (typeof value === "object") return JSON.stringify(value);

  const text = String(value);
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }
  return text;
}

function normalizeActionHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return appPath(trimmed);
  }

  const base =
    typeof window === "undefined"
      ? "http://agent-native.local/"
      : window.location.href;
  try {
    const url = new URL(trimmed, base);
    if (!SAFE_ACTION_PROTOCOLS.has(url.protocol)) return null;

    if (
      typeof window !== "undefined" &&
      url.origin === window.location.origin
    ) {
      return appPath(`${url.pathname}${url.search}${url.hash}`);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isSameAppHref(href: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(href, window.location.href);
    return (
      url.origin === window.location.origin && url.pathname.startsWith("/")
    );
  } catch {
    return false;
  }
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

function slugifyFilenamePart(value: string | undefined): string {
  const slug = (value ?? "data-table")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "data-table";
}

export function DataTableWidget({
  table,
  action,
}: {
  table: DataTableWidgetData;
  action?: { label: string; href: string };
}) {
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const rows = table.rows ?? [];
  const actionHref = action ? normalizeActionHref(action.href) : null;
  const canExportCsv = table.columns.length > 0;
  const exportCsv = () => {
    if (!canExportCsv) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      `${slugifyFilenamePart(table.title)}-${stamp}.csv`,
      "text/csv;charset=utf-8",
      toCSVTable(
        table.columns.map((column) => column.label),
        rows.map((row) => table.columns.map((column) => row[column.key])),
      ),
    );
  };

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconTable className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {table.title ?? t("agentChat.widget.dataTable")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {typeof table.totalRows === "number"
              ? t("agentChat.widget.rows", {
                  count: table.totalRows,
                  formattedCount: table.totalRows.toLocaleString(locale),
                })
              : t("agentChat.widget.rows", {
                  count: rows.length,
                  formattedCount: rows.length.toLocaleString(locale),
                })}
            {table.truncated ? ` ${t("agentChat.widget.sampled")}` : ""}
          </div>
        </div>
        {action && actionHref ? (
          <a
            href={actionHref}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                !isSameAppHref(actionHref)
              ) {
                return;
              }
              event.preventDefault();
              navigateSameAppHref(actionHref);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground no-underline hover:bg-muted hover:no-underline"
          >
            {action.label}
            <IconExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <button
          type="button"
          onClick={exportCsv}
          disabled={!canExportCsv}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          <IconDownload className="h-3 w-3" />
          {t("agentChat.widget.downloadCsv")}
        </button>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[420px] border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "border-b border-border px-3 py-2 font-medium text-muted-foreground",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, table.columns.length)}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {t("agentChat.widget.noRows")}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr
                  key={String(row.id ?? rowIndex)}
                  className="border-b border-border/70 last:border-0"
                >
                  {table.columns.map((column) => (
                    <td
                      key={`${rowIndex}-${column.key}`}
                      className={cn(
                        "max-w-[260px] px-3 py-2 align-top text-foreground",
                        column.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      <span className="line-clamp-3 break-words">
                        {formatCell(row[column.key], locale, {
                          yes: t("agentChat.common.yes"),
                          no: t("agentChat.common.no"),
                        })}
                      </span>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
