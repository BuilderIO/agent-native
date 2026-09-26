import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconHelpCircle,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { docsUrl } from "../../shared/docs-url.js";
import {
  MCP_CONNECT_MCP_URL_TEMPLATE,
  getMcpConnectGuides,
  getMcpStaticTokenFallback,
  interpolateMcpConnectTemplate,
  resolveMcpConnectGuideId,
  type McpConnectTemplateValues,
} from "../../shared/mcp-connect-content.js";
import { AgentTabFrame } from "../agent-page/AgentTabFrame.js";
import { appPath } from "../api-path.js";
import { useLocale, useT } from "../i18n.js";

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
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {docsHref && (
            <Button asChild variant="ghost" size="icon-xs">
              <a
                href={docsHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={docsLabel}
                title={docsLabel}
              >
                <IconHelpCircle aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
        <code className="mt-1 block truncate font-mono text-xs text-foreground">
          {value}
        </code>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="xs"
        onClick={() => void copy()}
      >
        {copied ? (
          <IconCheck aria-hidden="true" />
        ) : (
          <IconCopy aria-hidden="true" />
        )}
        {copied ? t("settings.mcpCopied") : t("settings.mcpCopy")}
      </Button>
    </div>
  );
}

type McpConnectGuide = ReturnType<typeof getMcpConnectGuides>[number];

function McpGuidePanel({
  guide,
  templateValues,
}: {
  guide: McpConnectGuide;
  templateValues: McpConnectTemplateValues;
}) {
  const t = useT();
  return (
    <>
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
          {interpolateMcpConnectTemplate(guide.intro, templateValues)}
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
        <Button asChild variant="secondary" size="sm">
          <a href={guide.action.href} target="_blank" rel="noopener noreferrer">
            {guide.action.label}
            <IconExternalLink aria-hidden="true" />
          </a>
        </Button>
      )}
      {guide.note && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {interpolateMcpConnectTemplate(guide.note, templateValues)}
        </p>
      )}
    </>
  );
}

export interface McpAccessSettingsProps {
  appName?: string;
  /** Drop the title and description, for a page whose header already names it. */
  hideHeader?: boolean;
}

export function McpAccessSettings({
  appName: appNameProp,
  hideHeader = false,
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
  const [activeGuide, setActiveGuide] = useState<string>("claude");

  useEffect(() => {
    const syncGuide = () => {
      setActiveGuide(
        resolveMcpConnectGuideId(
          new URLSearchParams(window.location.search).get("guide"),
        ),
      );
    };
    syncGuide();
    window.addEventListener("popstate", syncGuide);
    return () => window.removeEventListener("popstate", syncGuide);
  }, []);

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
    connectUrl.searchParams.set("guide", activeGuide);
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
  }, [activeGuide, appNameProp, locale]);

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
  const selectGuide = (guideId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("guide", guideId);
    window.history.pushState(window.history.state, "", url);
    setActiveGuide(guideId);
  };

  return (
    <AgentTabFrame
      compact={hideHeader}
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
              <Tabs value={activeGuide} onValueChange={selectGuide}>
                <TabsList
                  aria-label={t("settings.mcpChooseAssistant")}
                  className="max-w-full justify-start overflow-x-auto"
                >
                  {guides.map((item) => (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      id={`mcp-guide-tab-${item.id}`}
                      aria-controls={`mcp-guide-panel-${item.id}`}
                    >
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {templateValues
                  ? guides.map((item) => (
                      <TabsContent
                        key={item.id}
                        value={item.id}
                        id={`mcp-guide-panel-${item.id}`}
                        aria-labelledby={`mcp-guide-tab-${item.id}`}
                        className="mt-4 space-y-3"
                      >
                        <McpGuidePanel
                          guide={item}
                          templateValues={templateValues}
                        />
                      </TabsContent>
                    ))
                  : null}
              </Tabs>
            </section>
            <section className="border-t border-border/70 pt-6">
              <h3 className="text-sm font-semibold text-foreground">
                {staticTokenFallback.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {staticTokenFallback.state}.{" "}
                {t("settings.mcpStaticTokenDescription")}
              </p>
              <Button asChild variant="secondary" size="sm" className="mt-3">
                <a href={urls.connectUrl} target="_blank" rel="noopener">
                  {t("settings.mcpOpenConnectPage")}
                  <IconExternalLink aria-hidden="true" />
                </a>
              </Button>
            </section>
          </>
        ) : (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        )}
      </div>
    </AgentTabFrame>
  );
}
