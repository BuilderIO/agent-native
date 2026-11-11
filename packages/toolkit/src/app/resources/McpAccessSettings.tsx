import { appServerPath } from "@agent-native/core/client/api-path";
import { useLocale, useT, useFormatters } from "@agent-native/core/client/i18n";
import { useMcpConnectIdentity } from "@agent-native/core/client/mcp-connect-identity";
import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import { useActionQuery } from "@agent-native/core/client/use-action";
import { docsUrl } from "@agent-native/core/shared/docs-url";
import type {
  McpClientConnection,
  McpClientConnections,
} from "@agent-native/core/shared/mcp-client-connections";
import {
  buildMcpInstallLink,
  getMcpConnectGuides,
  getMcpStaticTokenFallback,
  interpolateMcpConnectTemplate,
  resolveMcpConnectGuideId,
  type McpConnectGuideId,
  type McpConnectTemplateValues,
} from "@agent-native/core/shared/mcp-connect-content";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Card, CardContent } from "@agent-native/toolkit/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@agent-native/toolkit/ui/item";
import {
  NumberedSteps,
  NumberedStep,
  NumberedStepTitle,
  NumberedStepBody,
} from "@agent-native/toolkit/ui/numbered-steps";
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDeviceDesktop,
  IconExternalLink,
  IconPlug,
} from "@tabler/icons-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useId,
  useState,
  type MouseEvent,
  type ComponentProps,
  type ReactNode,
} from "react";

import { AgentTabFrame } from "../agent-page/AgentTabFrame.js";
import {
  BrandLogo,
  BrandMark,
} from "../integrations/IntegrationDetailParts.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { McpIntegrationLogo } from "./McpIntegrationLogo.js";

type McpGuide = ReturnType<typeof getMcpConnectGuides>[number];

export const MCP_ACCESS_DOCS_HREF = {
  mcp: docsUrl("external-agents"),
  a2a: docsUrl("a2a-protocol"),
} as const;

const HOST_LOGOS: Record<string, string> = {
  claude: "claude",
  "claude-code": "claude",
  chatgpt: "openai",
  codex: "openai",
  cursor: "cursor",
  vscode: "vscode",
  grok: "grok",
};

export function McpHostMark({
  id,
  className = "size-5",
}: {
  id: string;
  className?: string;
}) {
  const logoId = HOST_LOGOS[id];
  return (
    <BrandMark
      logoUrl={logoId ? mcpIntegrationLogo(logoId) : ""}
      {...(logoId ? { logoId } : {})}
      icon={<IconPlug aria-hidden="true" />}
      className={
        logoId === "openai"
          ? `${className} mix-blend-multiply dark:invert dark:mix-blend-screen`
          : className
      }
    />
  );
}

function HostLogo({ guide }: { guide: McpGuide }) {
  const logoId = HOST_LOGOS[guide.id];
  return logoId ? (
    <McpIntegrationLogo
      name={guide.label}
      logoUrl={mcpIntegrationLogo(logoId)}
      integrationId={logoId}
      className="size-8 rounded-md"
      imageClassName={
        logoId === "openai"
          ? "size-6 mix-blend-multiply dark:invert dark:mix-blend-screen"
          : "size-[18px]"
      }
    />
  ) : (
    <BrandLogo
      name={guide.label}
      logoUrl=""
      icon={<IconPlug aria-hidden="true" />}
    />
  );
}

function modifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function useCopy(value: string) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timeout = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timeout);
  }, [state]);
  return {
    state,
    copy: async () => {
      try {
        const copied = await writeClipboardText(value);
        setState(copied ? "copied" : "error");
      } catch {
        setState("error");
      }
    },
  };
}

function CopyField({
  value,
  label,
  fieldLabel,
}: {
  value: string;
  label: string;
  fieldLabel: string;
}) {
  const t = useT();
  const { state, copy } = useCopy(value);
  return (
    <div className="min-w-0 space-y-1">
      <InputGroup aria-label={fieldLabel}>
        <InputGroupInput
          dir="ltr"
          readOnly
          value={value}
          aria-label={fieldLabel}
          className="min-w-0 font-mono text-xs"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            aria-label={state === "copied" ? t("settings.mcpCopied") : label}
            onClick={() => void copy()}
          >
            {state === "copied" ? (
              <IconCheck aria-hidden="true" />
            ) : (
              <IconCopy aria-hidden="true" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <span
        role="status"
        className={state === "error" ? "text-xs text-destructive" : "sr-only"}
      >
        {state === "error"
          ? t("runtimeConfig.copyFailed")
          : state === "copied"
            ? t("settings.mcpCopied")
            : ""}
      </span>
    </div>
  );
}

function DestinationLink({
  destination,
  children,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<"a"> & { destination: "new-tab" | "desktop" }) {
  const t = useT();
  const descriptionId = useId();
  const newTab = destination === "new-tab";
  const Icon = newTab ? IconExternalLink : IconDeviceDesktop;
  return (
    <a
      {...props}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      aria-describedby={[describedBy, descriptionId].filter(Boolean).join(" ")}
    >
      {children}
      <Icon aria-hidden="true" />
      <span id={descriptionId} hidden>
        {t(newTab ? "settings.mcpOpensNewTab" : "settings.mcpOpensDesktopApp")}
      </span>
    </a>
  );
}

function WebHostButton({ guide }: { guide: McpGuide }) {
  const t = useT();
  if (guide.action?.kind !== "link" || !guide.action.href) return null;
  return (
    <Button asChild size="sm">
      <DestinationLink href={guide.action.href} destination="new-tab">
        {t("settings.mcpStageOpen", { host: guide.label })}
      </DestinationLink>
    </Button>
  );
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const { state, copy } = useCopy(value);
  return (
    <div className="flex shrink-0 flex-col items-start gap-1 text-foreground">
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {state === "copied" ? t("settings.mcpCopied") : label}
        {state === "copied" ? (
          <IconCheck aria-hidden="true" />
        ) : (
          <IconCopy aria-hidden="true" />
        )}
      </Button>
      <span
        role="status"
        className={state === "error" ? "text-xs text-destructive" : "sr-only"}
      >
        {state === "error"
          ? t("runtimeConfig.copyFailed")
          : state === "copied"
            ? t("settings.mcpCopied")
            : ""}
      </span>
    </div>
  );
}

function ConnectionDetails({
  guide,
  values,
}: {
  guide: McpGuide;
  values: McpConnectTemplateValues;
}) {
  const t = useT();
  return (
    <Card className="border bg-muted shadow-none">
      <CardContent className="px-4 py-0">
        <ItemGroup role="group" aria-label={t("settings.mcpStageDetails")}>
          {guide.nameStep !== undefined ? (
            <>
              <Item
                role="group"
                aria-label={t("settings.mcpNameLabel")}
                className="rounded-none border-0 px-0 py-3.5"
              >
                <ItemContent className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <span className="text-xs text-muted-foreground">
                    {t("settings.mcpNameLabel")}
                  </span>
                  <span className="text-sm font-medium">{values.appName}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />
            </>
          ) : null}
          <Item
            role="group"
            aria-label={t("settings.mcpUrlLabel")}
            className="rounded-none border-0 px-0 py-3"
          >
            <ItemContent className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <span className="text-xs text-muted-foreground">
                {t("settings.mcpServerUrl")}
              </span>
              <code dir="ltr" className="min-w-0 break-all font-mono text-sm">
                {values.mcpUrl}
              </code>
              <div className="justify-self-start sm:justify-self-end">
                <CopyValueButton
                  value={values.mcpUrl}
                  label={t("settings.mcpCopyUrl")}
                />
              </div>
            </ItemContent>
          </Item>
          {guide.id === "claude" || guide.id === "chatgpt" ? (
            <>
              <ItemSeparator />
              <Item className="rounded-none border-0 px-0 py-3.5">
                <ItemContent className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <span className="text-xs text-muted-foreground">
                    {t("settings.mcpAuthentication")}
                  </span>
                  <span className="text-sm font-medium">
                    {t("mcpIntegrations.auth.oauth")}
                  </span>
                </ItemContent>
              </Item>
            </>
          ) : null}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

function SetupStep({
  number,
  title,
  last,
  children,
}: {
  number: number;
  title: string;
  last: boolean;
  children: ReactNode;
}) {
  return (
    <NumberedStep
      number={number}
      last={last}
      showConnector={false}
      variant="secondary"
      {...(!last ? { contentClassName: "pb-6" } : {})}
    >
      <NumberedStepTitle asChild className="mt-0 leading-[26px]">
        <h2>{title}</h2>
      </NumberedStepTitle>
      <NumberedStepBody className="space-y-2 leading-5">
        {children}
      </NumberedStepBody>
    </NumberedStep>
  );
}

function GuideSteps({
  guide,
  values,
}: {
  guide: McpGuide;
  values: McpConnectTemplateValues;
}) {
  const t = useT();
  const titles = {
    open: t(
      guide.install
        ? "settings.mcpStageAddServer"
        : "settings.mcpStageOpenSettings",
    ),
    add: t("settings.mcpStageDetails"),
    configure: t("settings.mcpStageDetails"),
    authorize: t("settings.mcpStageAuthorize", { host: guide.label }),
    enable: t("settings.mcpStageEnable", { host: guide.label }),
  };
  const visibleSteps = guide.steps
    ?.map((text, index) => ({ text, index }))
    .filter(({ index }) => !guide.install || index !== guide.urlStep);
  return (
    <NumberedSteps className="mt-0" aria-label={t("settings.mcpSetupSteps")}>
      {visibleSteps?.map(({ text, index }, position) => {
        const kind = guide.stepKinds?.[index];
        return (
          <SetupStep
            key={text}
            number={position + 1}
            last={position === visibleSteps.length - 1}
            title={kind ? titles[kind] : t("settings.mcpSetupSteps")}
          >
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              <p className="min-w-0 flex-1 text-sm leading-5 text-muted-foreground">
                {interpolateMcpConnectTemplate(text, values)}
              </p>
              {index === 0 ? (
                <div className="shrink-0">
                  <HostConnectAction guide={guide} values={values} />
                </div>
              ) : null}
            </div>
            {guide.urlStep === index ? (
              <>
                <ConnectionDetails guide={guide} values={values} />
                {guide.action?.kind === "link" &&
                /^https?:\/\/(?:localhost|127(?:\.\d+){3}|\[::1\])(?=[:/])/i.test(
                  values.mcpUrl,
                ) ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("settings.mcpLocalAddressHint", { host: guide.label })}
                  </p>
                ) : null}
              </>
            ) : null}
            {index === 0 && guide.install && guide.urlStep !== undefined ? (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group -ms-2 text-muted-foreground"
                  >
                    {t("settings.mcpManualSetup")}
                    <IconChevronDown
                      className="transition-transform group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  <p className="text-sm leading-5 text-muted-foreground">
                    {interpolateMcpConnectTemplate(
                      guide.steps?.[guide.urlStep] ?? "",
                      values,
                    )}
                  </p>
                  <ConnectionDetails guide={guide} values={values} />
                  {guide.install.slice(1).map((option) => {
                    const link = buildMcpInstallLink(option.client, {
                      serverName: values.serverId,
                      mcpUrl: values.mcpUrl,
                    });
                    return (
                      <Button
                        key={option.client}
                        asChild
                        variant="outline"
                        size="sm"
                      >
                        <DestinationLink
                          href={link.href}
                          destination={
                            link.opensWebPage ? "new-tab" : "desktop"
                          }
                        >
                          {option.label}
                        </DestinationLink>
                      </Button>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            {position === visibleSteps.length - 1 ? (
              <TestPrompt values={values} />
            ) : null}
          </SetupStep>
        );
      })}
    </NumberedSteps>
  );
}

function HostConnectAction({
  guide,
  values,
}: {
  guide: McpGuide;
  values: McpConnectTemplateValues;
}) {
  const install = guide.install?.[0];
  if (install) {
    const link = buildMcpInstallLink(install.client, {
      serverName: values.serverId,
      mcpUrl: values.mcpUrl,
    });
    return (
      <Button asChild size="sm">
        <DestinationLink
          href={link.href}
          destination={link.opensWebPage ? "new-tab" : "desktop"}
        >
          {install.label}
        </DestinationLink>
      </Button>
    );
  }
  if (guide.action?.kind === "link") return <WebHostButton guide={guide} />;
  const template = guide.commandTemplate ?? guide.configTemplate;
  return template ? (
    <CopyPrompt
      primary
      {...(guide.action?.label ? { label: guide.action.label } : {})}
      value={interpolateMcpConnectTemplate(template, values)}
    />
  ) : null;
}

function ConnectionBadge({
  status,
}: {
  status: "connected" | "disconnected" | "unavailable";
}) {
  const t = useT();
  return (
    <Badge
      variant={status === "unavailable" ? "outline" : "secondary"}
      size="sm"
      className="gap-1"
    >
      {status === "connected" ? (
        <IconCheck className="size-3" aria-hidden="true" />
      ) : null}
      {t(
        status === "connected"
          ? "settings.mcpConnected"
          : status === "disconnected"
            ? "settings.mcpNotConnected"
            : "settings.mcpConnectionUnavailable",
      )}
    </Badge>
  );
}

function TestPrompt({ values }: { values: McpConnectTemplateValues }) {
  const t = useT();
  return (
    <Item
      variant="muted"
      size="sm"
      className="flex-col items-start border-0 bg-muted text-foreground sm:flex-row sm:items-center"
    >
      <ItemContent>
        <p className="text-sm leading-5 text-foreground">
          {t("settings.mcpTestPrompt", { app: values.appName })}
        </p>
      </ItemContent>
      <CopyValueButton
        value={t("settings.mcpTestPrompt", { app: values.appName })}
        label={t("settings.mcpCopyTestPrompt")}
      />
    </Item>
  );
}

function HostDetail({
  guide,
  values,
  connection,
  statusUnavailable,
  checking,
}: {
  guide: McpGuide;
  values: McpConnectTemplateValues;
  connection?: McpClientConnection;
  statusUnavailable: boolean;
  checking: boolean;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const connected =
    !checking && !statusUnavailable && connection?.status === "connected";
  const template = guide.commandTemplate ?? guide.configTemplate;
  return (
    <article className="min-w-0 space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="min-w-0 flex-1 text-sm leading-5 text-muted-foreground">
            {t(
              guide.id === "other"
                ? "settings.mcpManualBenefit"
                : "settings.mcpHostBenefit",
              { host: guide.label, app: values.appName },
            )}
          </p>
          <div className="shrink-0 space-y-1 text-end">
            {checking ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <ConnectionBadge
                status={
                  statusUnavailable || connection?.status === "unknown"
                    ? "unavailable"
                    : connected
                      ? "connected"
                      : "disconnected"
                }
              />
            )}
            {connection?.lastUsedAt != null ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.mcpLastUsed", {
                  time: formatDate(connection.lastUsedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
            ) : null}
          </div>
        </div>
        <Separator />
      </header>
      {guide.steps?.length ? (
        <GuideSteps guide={guide} values={values} />
      ) : null}
      {template ? (
        <NumberedSteps
          className="mt-0"
          aria-label={t("settings.mcpSetupSteps")}
        >
          <SetupStep
            number={1}
            title={t("settings.mcpStageAddServer")}
            last={false}
          >
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              {guide.intro ? (
                <p className="min-w-0 flex-1 text-sm leading-5 text-muted-foreground">
                  {interpolateMcpConnectTemplate(guide.intro, values)}
                </p>
              ) : null}
              <div className="shrink-0">
                <HostConnectAction guide={guide} values={values} />
              </div>
            </div>
            <Card className="border bg-muted shadow-none">
              <CardContent className="p-4">
                <pre
                  dir="ltr"
                  className="overflow-x-auto whitespace-pre font-mono text-xs leading-5"
                >
                  <code>{interpolateMcpConnectTemplate(template, values)}</code>
                </pre>
              </CardContent>
            </Card>
          </SetupStep>
          {guide.commandTemplate && guide.note ? (
            <SetupStep
              number={2}
              title={t("settings.mcpStageAuthorize", { host: guide.label })}
              last
            >
              <p className="text-sm leading-5 text-muted-foreground">
                {interpolateMcpConnectTemplate(guide.note, values)}
              </p>
              <TestPrompt values={values} />
            </SetupStep>
          ) : (
            <SetupStep number={2} title={t("settings.mcpReadyToTry")} last>
              <TestPrompt values={values} />
            </SetupStep>
          )}
        </NumberedSteps>
      ) : null}
      <footer className="space-y-3">
        <Separator />
        <div className="flex flex-wrap items-center gap-2 text-xs leading-4 text-muted-foreground">
          <span>{t("settings.mcpHelpConnecting")}</span>
          <Button asChild variant="ghost" size="xs">
            <DestinationLink
              href={guide.docsHref ?? MCP_ACCESS_DOCS_HREF.mcp}
              destination="new-tab"
            >
              {t("settings.mcpConnectionDocs")}
            </DestinationLink>
          </Button>
        </div>
        {guide.id === "other" ? (
          <AdvancedConnection guideId={guide.id} />
        ) : null}
      </footer>
    </article>
  );
}

function CopyPrompt({
  value,
  label,
  primary = false,
}: {
  value: string;
  label?: string;
  primary?: boolean;
}) {
  const t = useT();
  const { state, copy } = useCopy(value);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={primary ? "default" : "outline"}
        size="sm"
        onClick={() => void copy()}
      >
        {!primary &&
          (state === "copied" ? (
            <IconCheck aria-hidden="true" />
          ) : (
            <IconCopy aria-hidden="true" />
          ))}
        {state === "copied"
          ? t("settings.mcpCopied")
          : (label ?? t("settings.mcpCopy"))}
      </Button>
      <span
        role="status"
        className={
          state === "error" ? "block text-xs text-destructive" : "sr-only"
        }
      >
        {state === "error" ? t("runtimeConfig.copyFailed") : ""}
      </span>
    </div>
  );
}

export interface McpAccessSettingsProps {
  appName?: string;
  hideHeader?: boolean;
  helpText?: string;
  guideId?: string | null;
  onSelectGuide?: (id: string) => void;
  guideHref?: (id: string) => string;
}

export function McpAccessSettings({
  appName: appNameProp,
  hideHeader = false,
  helpText,
  guideId,
  onSelectGuide,
  guideHref,
}: McpAccessSettingsProps) {
  const t = useT();
  const { locale } = useLocale();
  const guides = useMemo(() => getMcpConnectGuides(locale), [locale]);
  const identityState = useMcpConnectIdentity();
  const identity =
    identityState.status === "ready" ? identityState.identity : null;
  const connections = useActionQuery<McpClientConnections>(
    "list-mcp-client-connections",
    {},
    {
      enabled: identity?.connect === true,
      staleTime: 0,
      refetchOnWindowFocus: "always",
      retry: false,
    },
  );
  const { formatDate } = useFormatters();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const query = new URLSearchParams(window.location.search).get("guide");
      setSelected(query ? resolveMcpConnectGuideId(query) : null);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const activeId = guideId === undefined ? selected : guideId;
  const guide = guides.find((item) => item.id === activeId);
  const appName = appNameProp?.trim() || identity?.appName || "";
  const values = useMemo(
    () =>
      identity
        ? {
            appName,
            appUrl: identity.appUrl,
            mcpUrl: identity.mcpUrl,
            serverId: identity.serverName,
          }
        : null,
    [identity, appName],
  );
  const connection = connections.data?.connections.find(
    (item) => item.client === guide?.id,
  );
  const statusUnavailable =
    connections.isError ||
    (!connections.isPending && Boolean(guide) && !connection);
  const href = (id: string) => {
    if (guideHref) return guideHref(id);
    const query = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    query.set("guide", id);
    return `?${query}`;
  };
  const select = (id: string) => {
    if (onSelectGuide) onSelectGuide(id);
    else {
      window.history.pushState(window.history.state, "", href(id));
      setSelected(id);
    }
  };
  return (
    <AgentTabFrame
      compact={hideHeader}
      title={t("settings.mcpTitle")}
      description={t("settings.mcpDescription")}
      helpHref={MCP_ACCESS_DOCS_HREF.mcp}
      helpLabel={`${t("settings.mcpOpenDocs")} (${t("settings.mcpOpensNewTab")})`}
      helpIcon={<IconExternalLink className="size-4" aria-hidden="true" />}
    >
      {identity && values ? (
        <div className="flex min-w-0 flex-col gap-8">
          {connections.isError ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t("settings.mcpStatusCheckFailed")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void connections.refetch()}
                >
                  {t("settings.mcpRetry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {!connections.isError && connection?.status === "unknown" ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.mcpLegacyStatusUnknown")}
            </p>
          ) : null}

          {guide && identity.connect ? (
            <>
              {!onSelectGuide ? (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="self-start"
                >
                  <a
                    href="?"
                    onClick={(event) => {
                      if (modifiedClick(event)) return;
                      event.preventDefault();
                      window.history.pushState(
                        window.history.state,
                        "",
                        window.location.pathname,
                      );
                      setSelected(null);
                    }}
                  >
                    <IconArrowLeft aria-hidden="true" />
                    {t("settings.mcpChooseAssistant")}
                  </a>
                </Button>
              ) : null}
              <HostDetail
                key={guide.id}
                guide={guide}
                values={values}
                {...(!connections.isError && connection ? { connection } : {})}
                statusUnavailable={statusUnavailable}
                checking={connections.isPending}
              />
            </>
          ) : identity.connect ? (
            <>
              <p className="text-sm leading-6 text-muted-foreground">
                {helpText ?? t("settings.mcpSetupIntro", { app: appName })}
              </p>
              <SettingsGroup>
                <ItemGroup>
                  {guides.map((item, index) => {
                    const clientConnection = connections.data?.connections.find(
                      (row) => row.client === item.id,
                    );
                    const lastUsedAt = clientConnection?.lastUsedAt;
                    return (
                      <Fragment key={item.id}>
                        <div role="listitem">
                          <Item
                            asChild
                            className="rounded-none px-5 py-4 sm:px-6"
                          >
                            <a
                              href={href(item.id)}
                              onClick={(event) => {
                                if (modifiedClick(event)) return;
                                event.preventDefault();
                                select(item.id);
                              }}
                            >
                              <ItemMedia>
                                <HostLogo guide={item} />
                              </ItemMedia>
                              <ItemContent>
                                <ItemTitle>{item.label}</ItemTitle>
                                {!connections.isError && lastUsedAt != null ? (
                                  <ItemDescription>
                                    {t("settings.mcpLastUsed", {
                                      time: formatDate(lastUsedAt, {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      }),
                                    })}
                                  </ItemDescription>
                                ) : null}
                              </ItemContent>
                              <ItemActions>
                                {connections.isPending ? (
                                  <Skeleton className="h-4 w-16" />
                                ) : connections.isError ||
                                  !clientConnection ||
                                  clientConnection.status === "unknown" ? (
                                  <ConnectionBadge status="unavailable" />
                                ) : clientConnection.status === "connected" ? (
                                  <ConnectionBadge status="connected" />
                                ) : null}
                                <IconChevronRight
                                  className="size-4 text-muted-foreground rtl:-scale-x-100"
                                  aria-hidden="true"
                                />
                              </ItemActions>
                            </a>
                          </Item>
                        </div>
                        {index < guides.length - 1 ? <ItemSeparator /> : null}
                      </Fragment>
                    );
                  })}
                </ItemGroup>
              </SettingsGroup>
            </>
          ) : (
            <SettingsGroup>
              <SettingsRow
                label={t("settings.mcpUrlLabel")}
                control={
                  <CopyField
                    fieldLabel={t("settings.mcpUrlLabel")}
                    value={identity.mcpUrl}
                    label={t("settings.mcpCopy")}
                  />
                }
              />
            </SettingsGroup>
          )}
        </div>
      ) : identityState.status === "error" ? (
        <Alert>
          <AlertDescription className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("settings.mcpIdentityError")}
            </p>
            <Button variant="outline" size="sm" onClick={identityState.retry}>
              {t("settings.mcpRetry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <SettingsGroup>
          <div className="space-y-4 px-5 py-4" aria-busy="true">
            {guides.map((item) => (
              <Skeleton key={item.id} className="h-8 w-full" />
            ))}
          </div>
        </SettingsGroup>
      )}
    </AgentTabFrame>
  );
}

function AdvancedConnection({ guideId }: { guideId: McpConnectGuideId }) {
  const t = useT();
  const { locale } = useLocale();
  const fallback = getMcpStaticTokenFallback(locale);
  const connectUrl = `${appServerPath("/mcp/connect")}?${new URLSearchParams({ guide: guideId, locale })}`;
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cardState, setCardState] = useState<
    "idle" | "loading" | "available" | "absent" | "error"
  >("idle");
  const cardPath = appServerPath("/.well-known/agent-card.json");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCardState("loading");
    fetch(cardPath).then(
      (response) => {
        if (!cancelled)
          setCardState(
            response.ok
              ? "available"
              : response.status === 404
                ? "absent"
                : "error",
          );
      },
      () => {
        if (!cancelled) setCardState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, attempt, cardPath]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group -ms-2 text-muted-foreground"
        >
          {t("settings.mcpConnect.advancedOptions")}
          <IconChevronDown
            className="transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <SettingsGroup>
          {cardState === "available" ? (
            <SettingsRow
              label={t("settings.a2aAgentCard")}
              control={
                <CopyField
                  fieldLabel={t("settings.a2aAgentCard")}
                  value={new URL(cardPath, window.location.origin).toString()}
                  label={t("settings.mcpCopy")}
                />
              }
            />
          ) : cardState === "loading" ? (
            <div className="px-5 py-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : cardState === "error" ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t("settings.mcpIdentityError")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {t("settings.mcpRetry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <SettingsRow
            label={fallback.title}
            control={
              <Button asChild variant="outline" size="sm">
                <DestinationLink href={connectUrl} destination="new-tab">
                  {t("settings.mcpOpenConnectPage")}
                </DestinationLink>
              </Button>
            }
          />
        </SettingsGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
