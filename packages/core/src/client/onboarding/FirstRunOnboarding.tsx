import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowRight,
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconInfoCircle,
  IconKey,
  IconLoader2,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";

import type {
  OnboardingAppProfile,
  OnboardingCapability,
} from "../../onboarding/types.js";
import { appPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import {
  buildMcpOAuthStartUrl,
  filterMcpIntegrations,
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import {
  formatMcpServerError,
  useCreateMcpServer,
  useMcpServers,
} from "../resources/use-mcp-servers.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import { shouldSkipFirstRunIntegrations } from "./first-run-enabled.js";
import { listFirstRunOnboardingExtensions } from "./first-run-registry.js";
import { useOnboarding } from "./use-onboarding.js";
import { useOnboardingPreviewMode } from "./use-preview-mode.js";

type FirstRunScreen =
  | "intro"
  | "choice"
  | "manual"
  | "tools"
  | "connecting"
  | "ready"
  | "extension";

const BUILDER_MORE_SERVICES = [
  "Voice input",
  "Background agents",
  "Image generation",
  "Video generation",
  "Connected agents",
  "Hosting and deployment",
  "Browser automation",
  "Embeddings",
] as const;

export interface FirstRunOnboardingProps {
  /** Test hook; generated apps use the public Vite flag instead. */
  skipIntegrations?: boolean;
}

export function FirstRunOnboarding({
  skipIntegrations = shouldSkipFirstRunIntegrations(),
}: FirstRunOnboardingProps = {}) {
  const previewMode = useOnboardingPreviewMode();
  const { firstRun, loading, error, profile, completeFirstRun } = useOnboarding(
    { preview: previewMode },
  );
  const [screen, setScreen] = useState<FirstRunScreen>("intro");
  const [extensionIndex, setExtensionIndex] = useState(0);
  const [integrationQuery, setIntegrationQuery] = useState("");
  const [integrationDialogId, setIntegrationDialogId] = useState<string | null>(
    null,
  );
  const [connectingIntegrationId, setConnectingIntegrationId] = useState<
    string | null
  >(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const extensions = useMemo(() => listFirstRunOnboardingExtensions(), []);
  const mcpCatalog = useMemo(() => getDefaultMcpIntegrations(), []);
  const mcpServersQuery = useMcpServers();
  const createMcpServer = useCreateMcpServer();
  const mcpIntegrations = useMemo(
    () => filterMcpIntegrations(integrationQuery, mcpCatalog),
    [integrationQuery, mcpCatalog],
  );
  const connectedUrls = useMemo(() => {
    if (previewMode) return new Set<string>();
    const servers = [
      ...(mcpServersQuery.data?.user ?? []),
      ...(mcpServersQuery.data?.org ?? []),
    ];
    return new Set(
      servers
        .filter((server) => server.status.state === "connected")
        .map((server) => compareUrl(server.url)),
    );
  }, [mcpServersQuery.data, previewMode]);
  const hasOrg = Boolean(mcpServersQuery.data?.orgId);
  const canCreateOrgMcp = Boolean(
    hasOrg &&
    (mcpServersQuery.data?.role === "owner" ||
      mcpServersQuery.data?.role === "admin"),
  );

  const showTools = () => setScreen(skipIntegrations ? "ready" : "tools");
  const connectFlow = useBuilderConnectFlow({
    enabled: firstRun && !previewMode,
    trackingSource: "first_run_onboarding",
    trackingFlow: "connect_llm",
    onConnected: showTools,
  });

  if (!firstRun) return null;

  if (error) {
    return (
      <OnboardingShell profile={profile} screen="choice">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-[-0.03em]">
            Setup is almost ready.
          </h1>
          <p className="text-sm text-muted-foreground">
            We could not load the connection options yet.
          </p>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if (loading || !profile) {
    return <OnboardingSkeleton />;
  }

  const builderCapabilities = profile.capabilities.filter(
    (capability) => capability.builderIncluded,
  );

  const handleBuilder = () => {
    if (previewMode) {
      showTools();
      return;
    }
    if (connectFlow.hasFetchedStatus && connectFlow.configured) {
      showTools();
      return;
    }
    setScreen("connecting");
    connectFlow.start({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
    });
  };

  const handleOpenSettings = async () => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "integrations" },
      }),
    );
    await completeFirstRun();
  };

  const handleFinish = () => {
    if (extensions.length === 0) {
      void completeFirstRun();
      return;
    }
    setExtensionIndex(0);
    setScreen("extension");
  };

  const returnUrl =
    typeof window === "undefined"
      ? "/"
      : window.location.pathname +
        window.location.search +
        window.location.hash;

  const connectIntegration = async (integration: DefaultMcpIntegration) => {
    if (previewMode) {
      setScreen("ready");
      return;
    }
    setConnectError(null);

    if (
      connectedUrls.has(compareUrl(integration.url)) ||
      connectingIntegrationId === integration.id
    ) {
      return;
    }

    if (
      integration.authMode === "none" &&
      integration.connectionMode === "direct"
    ) {
      setConnectingIntegrationId(integration.id);
      try {
        await createMcpServer.mutateAsync({
          scope: "user",
          name: integration.name,
          url: integration.url,
          description: integration.description,
        });
      } catch (error) {
        setConnectError(
          formatMcpServerError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      } finally {
        setConnectingIntegrationId(null);
      }
      return;
    }

    if (
      integration.authMode === "oauth" &&
      integration.connectionMode === "oauth" &&
      integration.availability === "ready"
    ) {
      navigateToMcpOAuthStart(
        appPath(
          buildMcpOAuthStartUrl({
            name: integration.name,
            url: integration.url,
            description: integration.description,
            scope: "user",
            returnUrl,
          }),
        ),
      );
      return;
    }

    setIntegrationDialogId(integration.id);
  };

  if (screen === "extension") {
    const extension = extensions[extensionIndex];
    if (!extension) {
      void completeFirstRun();
      return null;
    }
    const Extension = extension.component;
    const advanceExtension = () => {
      if (extensionIndex < extensions.length - 1) {
        setExtensionIndex((current) => current + 1);
        return;
      }
      void completeFirstRun();
    };
    return (
      <Extension
        onComplete={advanceExtension}
        onSkip={() => void completeFirstRun()}
      />
    );
  }

  if (screen === "intro") {
    return (
      <OnboardingShell profile={profile} screen="intro">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
            Free forever.
            <br />
            <span className="text-primary">Open source for life.</span>
          </h1>
          <div className="mt-7 grid w-full gap-2 text-left sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card px-3 py-3">
              <p className="text-xs font-medium">Fully customizable</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Change the UI, code, and behavior.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-3">
              <p className="text-xs font-medium">Bring your own keys</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Use your own providers and accounts.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-3">
              <p className="text-xs font-medium">Build your own</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Mix and match toolkit pieces in your own apps.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={cn(primaryButtonClass, "mt-6")}
            onClick={() => setScreen("choice")}
          >
            Continue
            <IconArrowRight size={15} />
          </button>
          <a
            href="https://github.com/builderio/agent-native"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconBrandGithub size={14} />
            <span>View source</span>
            <IconExternalLink size={13} />
          </a>
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "choice") {
    return (
      <OnboardingShell profile={profile} screen="choice">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <h1 className="text-center text-xl font-semibold tracking-[-0.04em] sm:text-2xl">
            Choose your setup.
          </h1>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-primary/50 bg-primary/[0.06] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    Connect Builder.io free credits
                  </h2>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    One click connects{" "}
                    <a
                      href="https://www.builder.io/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Builder.io free credits
                    </a>{" "}
                    with the services this app needs.
                  </p>
                </div>
                <IconArrowRight className="mt-0.5 text-primary" size={17} />
              </div>
              <div className="mt-5 border-t border-primary/15 pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Included with Builder.io free credits
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                  {builderCapabilities.map((capability, index) => (
                    <React.Fragment key={capability.id}>
                      {index > 0 && (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground"
                        >
                          ·
                        </span>
                      )}
                      <span>{capability.label}</span>
                    </React.Fragment>
                  ))}
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`See ${BUILDER_MORE_SERVICES.length} more services included with Builder.io free credits`}
                      >
                        +{BUILDER_MORE_SERVICES.length} more
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm text-xs">
                      <p className="font-medium">
                        Also included with Builder.io free credits
                      </p>
                      <p className="mt-1 leading-5">
                        {BUILDER_MORE_SERVICES.join(" · ")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <button
                type="button"
                data-testid="first-run-connect-builder"
                className={cn(primaryButtonClass, "mt-5 w-full")}
                onClick={handleBuilder}
              >
                Connect Builder.io free credits
                <IconArrowRight size={15} />
              </button>
            </section>

            <div
              role="button"
              tabIndex={0}
              aria-label="Use my own keys"
              data-testid="first-run-use-own-keys"
              className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setScreen("manual")}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setScreen("manual");
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Use my own keys</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    See what this app needs
                  </p>
                </div>
                <IconKey className="text-muted-foreground" size={17} />
              </div>
              <CapabilityList
                capabilities={profile.capabilities}
                compact
                className="mt-5 border-t border-border pt-3"
              />
            </div>
          </div>
          {import.meta.env.DEV ? (
            <p
              data-testid="first-run-local-provider-note"
              className="mx-auto max-w-2xl text-center text-[11px] leading-5 text-muted-foreground"
            >
              Or set{" "}
              <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code>{" "}
              or <code className="rounded bg-muted px-1">OPENAI_API_KEY</code>{" "}
              in <code className="rounded bg-muted px-1">.env</code> to make
              that provider available to everyone using this app.{" "}
              <a
                href="https://agent-native.com/docs/environment-variables"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Read the setup guide
                <IconExternalLink size={12} />
              </a>
            </p>
          ) : null}
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "manual") {
    return (
      <OnboardingShell profile={profile} screen="choice">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          <div>
            <button
              type="button"
              className="mb-4 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setScreen("choice")}
            >
              Back
            </button>
            <h1 className="text-xl font-semibold tracking-[-0.04em] sm:text-2xl">
              Your keys
            </h1>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <CapabilityList capabilities={profile.capabilities} />
            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setScreen("choice")}
              >
                Back
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                onClick={handleOpenSettings}
              >
                Open key settings
                <IconArrowRight size={15} />
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setScreen(skipIntegrations ? "ready" : "tools")}
              >
                {skipIntegrations ? "Continue" : "Continue to tools"}
              </button>
            </div>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "tools") {
    return (
      <OnboardingShell
        profile={profile}
        screen="tools"
        footer={
          <div
            data-testid="onboarding-tools-footer"
            className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-end gap-2"
          >
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={handleFinish}
            >
              Skip for now
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={handleFinish}
            >
              Continue
              <IconArrowRight size={15} />
            </button>
          </div>
        }
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          <div className="text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <IconPlugConnected size={22} />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.05em] sm:text-3xl">
              This app is an agent.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Search the catalog and connect what you need. The onboarding stays
              open while you add integrations.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  Agent integrations
                </p>
                <span className="text-xs text-muted-foreground">
                  {mcpIntegrations.length} of {mcpCatalog.length}
                </span>
              </div>
              <label className="relative">
                <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={integrationQuery}
                  onChange={(event) => setIntegrationQuery(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background pe-3 ps-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                  placeholder="Search integrations"
                  aria-label="Search integrations"
                />
              </label>
              {connectError && (
                <p className="text-xs leading-5 text-destructive">
                  {connectError}
                </p>
              )}
            </div>

            <div>
              {mcpIntegrations.length > 0 ? (
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {mcpIntegrations.map((integration) => (
                    <McpIntegrationCard
                      key={integration.id}
                      integration={integration}
                      connected={connectedUrls.has(compareUrl(integration.url))}
                      busy={connectingIntegrationId === integration.id}
                      onConnect={connectIntegration}
                    />
                  ))}
                </div>
              ) : (
                <div className="border-y border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                  No integrations match.
                </div>
              )}
            </div>
          </div>
        </div>
        {integrationDialogId && (
          <McpIntegrationDialog
            open
            onOpenChange={(open) => {
              if (!open) setIntegrationDialogId(null);
            }}
            initialIntegrationId={integrationDialogId}
            defaultScope={canCreateOrgMcp ? "org" : "user"}
            canCreateOrgMcp={canCreateOrgMcp}
            hasOrg={hasOrg}
            onCreateMcpServer={createMcpServer.mutateAsync}
          />
        )}
      </OnboardingShell>
    );
  }

  if (screen === "connecting") {
    return (
      <OnboardingShell profile={profile} screen="choice">
        <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <IconLoader2 className="animate-spin" size={19} />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">
            Connecting Builder.io free credits
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Finish the one-click connection in the new window.
          </p>
          <div className="mt-7 w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-8 w-full" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          </div>
          {connectFlow.error && (
            <div className="mt-4 flex flex-col items-center gap-2">
              <p className="text-xs text-destructive">{connectFlow.error}</p>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setScreen("choice")}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell profile={profile} screen="ready">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconCheck size={20} />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">
          Your agent is ready.
        </h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Start with a chat, then connect more tools whenever you need them.
        </p>
        <div className="mt-7 grid w-full gap-2 text-left sm:grid-cols-3">
          {(skipIntegrations
            ? [
                [
                  "Workflow actions",
                  "Use the app's buttons and sidebar to run the workflow.",
                ],
                [
                  "AI sidebar",
                  "Ask the agent to review or refine a step in context.",
                ],
                [
                  "Flexible providers",
                  "Use Builder.io free credits or your own keys.",
                ],
              ]
            : [
                ["Chat + actions", "Ask your agent to work across the app."],
                ["Agent integrations", "Connect tools from Settings anytime."],
                [
                  "Flexible providers",
                  "Use Builder.io free credits or your own keys.",
                ],
              ]
          ).map(([title, description]) => (
            <div
              key={title}
              className="rounded-xl bg-card px-4 py-4 ring-1 ring-border/70"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <IconCheck size={14} />
              </span>
              <p className="mt-3 text-sm font-medium">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
        <button
          type="button"
          data-testid="first-run-open-app"
          className={cn(primaryButtonClass, "mt-7")}
          onClick={handleFinish}
        >
          Open app
          <IconArrowRight size={15} />
        </button>
      </div>
    </OnboardingShell>
  );
}

function OnboardingShell({
  profile,
  screen,
  footer,
  children,
}: {
  profile: OnboardingAppProfile | null;
  screen: "intro" | "choice" | "tools" | "ready";
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background text-foreground"
      data-onboarding-screen={screen}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile?.appName ?? "Your app"} setup`}
    >
      <div
        className="h-0.5 shrink-0 bg-muted"
        data-testid="onboarding-progress"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{
            width:
              screen === "intro"
                ? "33.33%"
                : screen === "tools" || screen === "ready"
                  ? "100%"
                  : "66.66%",
          }}
        />
      </div>
      <main
        className={cn(
          "flex min-h-0 flex-1 overflow-y-auto px-5 sm:px-8",
          screen === "tools" ? "items-start py-8" : "items-center py-10",
        )}
      >
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      {footer && (
        <footer className="shrink-0 border-t border-border bg-background/95 px-5 py-3 backdrop-blur-sm sm:px-8">
          {footer}
        </footer>
      )}
    </div>
  );
}

function OnboardingSkeleton() {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background"
      data-onboarding-loading="true"
      aria-busy="true"
    >
      <Skeleton className="h-0.5 w-full shrink-0" />
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-3 h-10 w-52" />
        <Skeleton className="mt-7 h-3 w-44" />
        <Skeleton className="mt-7 h-10 w-24 rounded-lg" />
      </div>
    </div>
  );
}

function CapabilityList({
  capabilities,
  compact = false,
  className,
}: {
  capabilities: OnboardingCapability[];
  compact?: boolean;
  className?: string;
}) {
  const visibleCapabilities = useMemo(
    () => (compact ? capabilities.slice(0, 4) : capabilities),
    [capabilities, compact],
  );

  return (
    <div className={cn("grid", className)}>
      {!compact && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Keys and integrations
        </p>
      )}
      <div className="divide-y divide-border">
        {visibleCapabilities.map((capability) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function McpIntegrationCard({
  integration,
  connected,
  busy,
  onConnect,
}: {
  integration: DefaultMcpIntegration;
  connected: boolean;
  busy: boolean;
  onConnect: (integration: DefaultMcpIntegration) => void;
}) {
  const actionLabel = "Connect";

  return (
    <article className="flex min-w-0 items-center gap-3 border-b border-border/70 py-3.5 sm:pe-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card text-xs font-semibold text-muted-foreground">
          {integration.name.slice(0, 1)}
          <img
            src={integration.logoUrl}
            alt=""
            className="absolute inset-0 size-full object-contain p-1"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">
              {integration.name}
            </h3>
            {connected ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Connected
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {integration.description}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onConnect(integration)}
        disabled={connected || busy}
        aria-label={`${actionLabel} ${integration.name}`}
        className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <IconLoader2 className="animate-spin" size={13} /> : null}
        {connected ? "Connected" : actionLabel}
      </button>
    </article>
  );
}

function CapabilityRow({
  capability,
  compact,
}: {
  capability: OnboardingCapability;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3",
        compact ? "py-2" : "py-3",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("font-medium", compact ? "text-[11px]" : "text-sm")}
          >
            {capability.label}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Why ${capability.label} is needed`}
                className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <IconInfoCircle size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {capability.why}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {capability.keySummary}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-[10px] uppercase tracking-[0.08em]",
          capability.required ? "text-primary" : "text-muted-foreground",
        )}
      >
        {capability.required ? "Required" : "Optional"}
      </span>
    </div>
  );
}

const primaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const secondaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function compareUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}
