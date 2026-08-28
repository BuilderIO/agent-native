import { IconExternalLink, IconHelpCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { docsUrl } from "../../shared/docs-url.js";
import {
  MCP_CONNECT_MCP_URL_TEMPLATE,
  getMcpConnectGuides,
  getMcpStaticTokenFallback,
  interpolateMcpConnectTemplate,
  type McpConnectTemplateValues,
} from "../../shared/mcp-connect-content.js";
import { AgentTabFrame } from "../agent-page/AgentTabFrame.js";
import { appPath } from "../api-path.js";
import { useLocale, useT } from "../i18n.js";
import { cn } from "../utils.js";

interface AccessUrls {
  appName: string;
  appUrl: string;
  mcpUrl: string;
  connectUrl: string;
  agentCardUrl: string;
}

export const MCP_ACCESS_DOCS_HREF = {
  mcp: docsUrl("external-agents"),
  a2a: docsUrl("a2a-protocol"),
} as const;

interface CopyFieldProps {
  label: string;
  value: string;
  docsHref?: string;
  docsLabel?: string;
}

function CopyField({ label, value, docsHref, docsLabel }: CopyFieldProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {label}
          {docsHref && (
            <a
              href={docsHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={docsLabel}
              title={docsLabel}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconHelpCircle className="size-2.5" />
            </a>
          )}
        </div>
        <code className="mt-1 block truncate text-xs text-foreground">
          {value}
        </code>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 cursor-pointer rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        {copied ? t("settings.mcpCopied") : t("settings.mcpCopy")}
      </button>
    </div>
  );
}

export interface McpAccessSettingsProps {
  appName?: string;
}

export function McpAccessSettings({
  appName: appNameProp,
}: McpAccessSettingsProps) {
  const t = useT();
  const { locale } = useLocale();
  const guides = useMemo(() => getMcpConnectGuides(locale), [locale]);
  const staticTokenFallback = useMemo(
    () => getMcpStaticTokenFallback(locale),
    [locale],
  );
  const [urls, setUrls] = useState<AccessUrls | null>(null);
  const [agentCardAvailable, setAgentCardAvailable] = useState(false);
  const [activeGuide, setActiveGuide] = useState(guides[0]?.id);

  useEffect(() => {
    const origin = window.location.origin;
    const baseUrl = new URL(appPath("/"), origin).toString().replace(/\/$/, "");
    const hostname = window.location.hostname || "app";
    const metaSiteName = [
      'meta[name="application-name"]',
      'meta[name="apple-mobile-web-app-title"]',
      'meta[property="og:site_name"]',
    ]
      .map((selector) =>
        document.querySelector(selector)?.getAttribute("content")?.trim(),
      )
      .find(Boolean);
    const hostnameGuess =
      hostname !== "localhost" && hostname !== "127.0.0.1"
        ? hostname.split(".")[0]
        : "";
    const appName =
      appNameProp?.trim() || metaSiteName || hostnameGuess || "this app";
    const templateValues = {
      appName,
      appUrl: baseUrl,
      mcpUrl: "",
      serverId: `agent-native-${hostname}`,
    } satisfies McpConnectTemplateValues;
    const connectUrl = new URL(appPath("/mcp/connect"), origin);
    connectUrl.searchParams.set("locale", locale);
    setUrls({
      appName,
      appUrl: baseUrl,
      mcpUrl: interpolateMcpConnectTemplate(
        MCP_CONNECT_MCP_URL_TEMPLATE,
        templateValues,
      ),
      connectUrl: connectUrl.toString(),
      agentCardUrl: new URL(
        appPath("/.well-known/agent-card.json"),
        origin,
      ).toString(),
    });
  }, [appNameProp, locale]);

  useEffect(() => {
    if (!urls) return;
    let cancelled = false;
    fetch(urls.agentCardUrl)
      .then((response) => {
        if (!cancelled) setAgentCardAvailable(response.ok);
      })
      .catch(() => {
        if (!cancelled) setAgentCardAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urls]);

  const templateValues: McpConnectTemplateValues | null = urls
    ? {
        appName: urls.appName,
        appUrl: urls.appUrl,
        mcpUrl: urls.mcpUrl,
        serverId: `agent-native-${window.location.hostname || "app"}`,
      }
    : null;
  const guide = guides.find((item) => item.id === activeGuide) ?? guides[0];

  return (
    <AgentTabFrame
      title={t("settings.mcpTitle")}
      description={t("settings.mcpDescription")}
      helpHref={MCP_ACCESS_DOCS_HREF.mcp}
      helpLabel={t("settings.mcpOpenDocs")}
    >
      <div className="space-y-6">
        {urls ? (
          <>
            <section className="space-y-2">
              <CopyField
                label={t("settings.mcpUrlLabel")}
                value={urls.mcpUrl}
                docsHref={MCP_ACCESS_DOCS_HREF.mcp}
                docsLabel={t("settings.mcpOpenDocs")}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("settings.mcpUrlHint")}
              </p>
            </section>
            {agentCardAvailable && (
              <CopyField
                label={t("settings.a2aAgentCard")}
                value={urls.agentCardUrl}
                docsHref={MCP_ACCESS_DOCS_HREF.a2a}
                docsLabel={t("settings.a2aOpenDocs")}
              />
            )}
            <section className="space-y-3 border-t border-border/70 pt-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("settings.mcpClientSetup")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.mcpClientSetupDescription")}
                </p>
              </div>
              <div
                className="flex gap-1 overflow-x-auto border-b border-border pb-2"
                role="tablist"
                aria-label={t("settings.mcpChooseAssistant")}
              >
                {guides.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`mcp-guide-tab-${item.id}`}
                    aria-selected={item.id === guide?.id}
                    aria-controls={`mcp-guide-panel-${item.id}`}
                    onClick={() => setActiveGuide(item.id)}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium",
                      item.id === guide?.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {guide && templateValues && (
                <div
                  id={`mcp-guide-panel-${guide.id}`}
                  className="space-y-3 pt-1"
                  role="tabpanel"
                  aria-labelledby={`mcp-guide-tab-${guide.id}`}
                >
                  {guide.steps?.length ? (
                    <ol className="list-decimal space-y-2 ps-5 text-xs leading-relaxed text-muted-foreground">
                      {guide.steps.map((step) => (
                        <li key={step}>
                          {interpolateMcpConnectTemplate(step, templateValues)}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {guide.intro && (
                    <p className="text-xs text-muted-foreground">
                      {interpolateMcpConnectTemplate(
                        guide.intro,
                        templateValues,
                      )}
                    </p>
                  )}
                  {guide.commandTemplate && (
                    <CopyField
                      label={t("settings.mcpCommand")}
                      value={interpolateMcpConnectTemplate(
                        guide.commandTemplate,
                        templateValues,
                      )}
                    />
                  )}
                  {guide.configTemplate && (
                    <CopyField
                      label={t("settings.mcpConfig")}
                      value={interpolateMcpConnectTemplate(
                        guide.configTemplate,
                        templateValues,
                      )}
                    />
                  )}
                  {guide.action?.kind === "link" && guide.action.href && (
                    <a
                      href={guide.action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      {guide.action.label}
                      <IconExternalLink className="size-3.5" />
                    </a>
                  )}
                  {guide.note && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {interpolateMcpConnectTemplate(
                        guide.note,
                        templateValues,
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
            <section className="border-t border-border/70 pt-6">
              <h3 className="text-sm font-semibold text-foreground">
                {staticTokenFallback.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {staticTokenFallback.state}.{" "}
                {t("settings.mcpStaticTokenDescription")}
              </p>
              <a
                href={urls.connectUrl}
                className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                {t("settings.mcpOpenConnectPage")}
                <IconExternalLink className="size-3.5" />
              </a>
            </section>
          </>
        ) : (
          <div className="space-y-3" aria-busy="true">
            <div className="h-5 w-36 animate-pulse rounded bg-muted" />
            <div className="h-20 rounded-lg border border-border bg-muted/30" />
            <div className="h-20 rounded-lg border border-border bg-muted/30" />
          </div>
        )}
      </div>
    </AgentTabFrame>
  );
}
