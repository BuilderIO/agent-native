import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import type { AgentNativeConfig } from "../config.js";
import {
  parseRuntimeConfigReport,
  type RuntimeConfigReport,
} from "../shared/runtime-config.js";
import { agentNativePath } from "./api-path.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";
import { writeClipboardText } from "./clipboard.js";
import { useT } from "./i18n.js";

declare const __AGENT_NATIVE_APP_CONFIG__: AgentNativeConfig | undefined;

function injectedAppConfig(): AgentNativeConfig {
  return typeof __AGENT_NATIVE_APP_CONFIG__ === "undefined"
    ? {}
    : __AGENT_NATIVE_APP_CONFIG__;
}

function configurationUrl(config: AgentNativeConfig): string {
  const params = new URLSearchParams({ configuration: "1" });
  const requiredEnv = config.runtime?.environment?.required ?? [];
  if (requiredEnv.length > 0) params.set("requiredEnv", requiredEnv.join(","));
  if (config.runtime?.auth?.enabled === false) params.set("auth", "0");
  if (config.runtime?.database?.required === false) {
    params.set("database", "0");
  }
  return agentNativePath("/_agent-native/ping") + "?" + params.toString();
}

export function RuntimeConfigNotice() {
  const t = useT();
  const [report, setReport] = useState<RuntimeConfigReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const config = useMemo(injectedAppConfig, []);

  useEffect(() => {
    if (typeof window.fetch !== "function") return;
    if (agentNativeApiDisabledReason()) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    window
      .fetch(configurationUrl(config), {
        headers: { accept: "application/json" },
        signal: controller.signal,
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("configuration probe: " + response.status);
        }
        return (await response.json()) as { configuration?: unknown };
      })
      .then((body) => {
        if (!active) return;
        const next = parseRuntimeConfigReport(body.configuration);
        if (next && !next.ok) setReport(next);
      })
      .catch(() => {
        // The notice is an enhancement. A missing optional probe must not
        // become a false "configuration is healthy" result.
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [config]);

  if (!report) return null;

  const currentReport = report;
  const isError = currentReport.status === "error";
  const Icon = isError ? IconAlertCircle : IconAlertTriangle;
  const issueCount = t("runtimeConfig.issue", {
    count: currentReport.issues.length,
  });
  const tone = isError
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  async function copyPrompt() {
    const copied = await writeClipboardText(currentReport.prompt);
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <aside
      aria-label={
        isError
          ? t("runtimeConfig.errorTitle")
          : t("runtimeConfig.warningTitle")
      }
      className={
        "fixed bottom-4 right-4 z-[1000] w-[min(calc(100vw-2rem),26rem)] rounded-lg border shadow-lg backdrop-blur " +
        tone
      }
      data-testid="runtime-config-notice"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs font-medium"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {isError
            ? t("runtimeConfig.errorTitle")
            : t("runtimeConfig.warningTitle")}
          <span className="ms-1 font-normal opacity-80">({issueCount})</span>
        </button>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={
            expanded
              ? t("runtimeConfig.hideDetails")
              : t("runtimeConfig.showDetails")
          }
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <IconChevronUp aria-hidden="true" className="size-4" />
          ) : (
            <IconChevronDown aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-current/15 px-3 py-3 text-xs">
          <ul className="space-y-2">
            {currentReport.issues.map((issue) => (
              <li key={issue.code + ":" + issue.envKeys.join(",")}>
                <p className="font-medium">{issue.title}</p>
                <p className="mt-0.5 opacity-85">{issue.message}</p>
                {issue.envKeys.length > 0 ? (
                  <p className="mt-1 font-mono text-[10px] opacity-75">
                    {issue.envKeys.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-current/25 bg-background/70 px-2.5 font-medium text-foreground transition hover:bg-background"
            onClick={() => void copyPrompt()}
          >
            {copyState === "copied" ? (
              <IconCheck aria-hidden="true" className="size-3.5" />
            ) : (
              <IconCopy aria-hidden="true" className="size-3.5" />
            )}
            {copyState === "copied"
              ? t("runtimeConfig.copied")
              : copyState === "failed"
                ? t("runtimeConfig.copyFailed")
                : t("runtimeConfig.copyPrompt")}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
