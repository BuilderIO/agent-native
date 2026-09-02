import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowRight,
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconInfoCircle,
  IconKey,
  IconLoader2,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  OnboardingAppProfile,
  OnboardingCapability,
} from "../../onboarding/types.js";
import { docsUrl } from "../../shared/docs-url.js";
import { appPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { IntegrationGrid } from "../integrations/IntegrationGrid.js";
import {
  buildMcpOAuthStartUrl,
  filterMcpIntegrations,
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import {
  formatMcpServerError,
  formatMcpServersLoadError,
  useCreateMcpServer,
  useMcpServers,
} from "../resources/use-mcp-servers.js";
import { BuilderConnectPopover } from "../settings/BuilderConnectPopover.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import { shouldSkipFirstRunIntegrations } from "./first-run-enabled.js";
import { listFirstRunOnboardingExtensions } from "./first-run-registry.js";
import { saveFirstRunOnboardingRole } from "./first-run-status.js";
import { trackOnboardingEvent, useOnboarding } from "./use-onboarding.js";
import { useOnboardingPreviewMode } from "./use-preview-mode.js";

type FirstRunScreen =
  | "intro"
  | "choice"
  | "manual"
  | "tools"
  | "role"
  | "connecting"
  | "ready"
  | "extension";

const FIRST_RUN_SCREEN_ORDER: readonly Exclude<FirstRunScreen, "extension">[] =
  ["intro", "choice", "manual", "tools", "role", "connecting", "ready"];

function firstRunStepProperties(
  screen: FirstRunScreen,
  extensions: readonly { id: string }[],
  extensionIndex: number,
): Record<string, unknown> {
  if (screen === "extension") {
    return {
      flow: "first_run",
      step_id: `extension:${extensions[extensionIndex]?.id ?? "unknown"}`,
      step_index: FIRST_RUN_SCREEN_ORDER.length + extensionIndex,
      ...(extensions[extensionIndex]
        ? { extension_id: extensions[extensionIndex].id }
        : {}),
    };
  }
  return {
    flow: "first_run",
    step_id: screen,
    step_index: FIRST_RUN_SCREEN_ORDER.indexOf(screen),
  };
}

const FIRST_RUN_ROLE_OPTIONS = [
  { value: "product", labelKey: "agentChat.onboarding.roleProduct" },
  { value: "design", labelKey: "agentChat.onboarding.roleDesign" },
  { value: "developer", labelKey: "agentChat.onboarding.roleDeveloper" },
  { value: "marketing", labelKey: "agentChat.onboarding.roleMarketing" },
  { value: "sales", labelKey: "agentChat.onboarding.roleSales" },
  { value: "ops", labelKey: "agentChat.onboarding.roleOps" },
  {
    value: "individual",
    labelKey: "agentChat.onboarding.roleIndividual",
  },
  { value: "other", labelKey: "agentChat.onboarding.roleOther" },
] as const;

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
  /** The shared startup gate has already resolved this account as eligible. */
  initialFirstRun?: boolean;
}

export function FirstRunOnboarding({
  skipIntegrations = shouldSkipFirstRunIntegrations(),
  initialFirstRun = false,
}: FirstRunOnboardingProps = {}) {
  const t = useT();
  const previewMode = useOnboardingPreviewMode();
  const {
    firstRun,
    loading,
    error,
    profile,
    completeFirstRun,
    completeFirstRunError,
  } = useOnboarding({ preview: previewMode, initialFirstRun });
  const [screen, setScreen] = useState<FirstRunScreen>("intro");
  const [extensionIndex, setExtensionIndex] = useState(0);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaveError, setRoleSaveError] = useState<string | null>(null);
  const [integrationQuery, setIntegrationQuery] = useState("");
  const [integrationDialogId, setIntegrationDialogId] = useState<string | null>(
    null,
  );
  const [connectingIntegrationId, setConnectingIntegrationId] = useState<
    string | null
  >(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [builderConnectionMode, setBuilderConnectionMode] = useState<
    "existing" | "provision"
  >("existing");
  const extensions = useMemo(() => listFirstRunOnboardingExtensions(), []);
  const mcpCatalog = useMemo(() => getDefaultMcpIntegrations(), []);
  const mcpServersQuery = useMcpServers();
  const createMcpServer = useCreateMcpServer();
  const mcpIntegrations = useMemo(
    () => filterMcpIntegrations(integrationQuery, mcpCatalog),
    [integrationQuery, mcpCatalog],
  );
  // completeFirstRun() rejects on failure — swallow it here so a Skip/
  // Continue click never becomes an unhandled rejection; completeFirstRunError
  // (rendered below) is the real signal, and the user stays on this screen
  // to retry instead of being bounced to an unrelated error screen.
  const trackFirstRunStepCompleted = useCallback(
    (stepScreen: FirstRunScreen, stepExtensionIndex = extensionIndex) => {
      if (previewMode) return;
      trackOnboardingEvent(
        "onboarding_step_completed",
        firstRunStepProperties(stepScreen, extensions, stepExtensionIndex),
      );
    },
    [extensionIndex, extensions, previewMode],
  );
  const completionAttemptRef = useRef<{
    screen: FirstRunScreen | null;
    extensionIndex: number;
  } | null>(null);
  const finishOnboarding = useCallback(
    async (
      completedScreen: FirstRunScreen | null,
      completedExtensionIndex = extensionIndex,
    ) => {
      completionAttemptRef.current = completedScreen
        ? { screen: completedScreen, extensionIndex: completedExtensionIndex }
        : { screen: null, extensionIndex: completedExtensionIndex };
      try {
        await completeFirstRun();
        if (completedScreen) {
          trackFirstRunStepCompleted(completedScreen, completedExtensionIndex);
        }
        completionAttemptRef.current = null;
      } catch {
        // coercion-ok: completeFirstRun exposes this failure as the inline retry state.
      }
    },
    [completeFirstRun, extensionIndex, trackFirstRunStepCompleted],
  );
  useEffect(() => {
    if (!previewMode && firstRun && !loading && profile) {
      trackOnboardingEvent("onboarding_started", { flow: "first_run" });
    }
  }, [firstRun, loading, previewMode, profile]);
  useEffect(() => {
    if (previewMode || !firstRun || loading || !profile) return;
    const step = firstRunStepProperties(screen, extensions, extensionIndex);
    trackOnboardingEvent("onboarding_step_viewed", step);
  }, [
    extensionIndex,
    extensions,
    firstRun,
    loading,
    previewMode,
    profile,
    screen,
  ]);
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

  const showTools = useCallback(
    () => setScreen(skipIntegrations ? "role" : "tools"),
    [skipIntegrations],
  );
  const handleBuilderConnected = useCallback(() => {
    trackFirstRunStepCompleted("choice");
    trackFirstRunStepCompleted("connecting");
    showTools();
  }, [showTools, trackFirstRunStepCompleted]);
  const roleBackScreen = skipIntegrations ? "manual" : "tools";
  const connectFlow = useBuilderConnectFlow({
    enabled: firstRun && !previewMode,
    provisionAccount: true,
    trackingSource: "first_run_onboarding",
    trackingFlow: "connect_llm",
    onConnected: handleBuilderConnected,
  });
  const canActivateBuilderFreeCredits =
    connectFlow.agentNativeProvisioningEnabled;
  const dismissOnboarding = useCallback(() => {
    void finishOnboarding(null);
  }, [finishOnboarding]);
  const retryOnboardingCompletion = useCallback(() => {
    const attempt = completionAttemptRef.current;
    void finishOnboarding(
      attempt?.screen ?? null,
      attempt?.extensionIndex ?? extensionIndex,
    );
  }, [extensionIndex, finishOnboarding]);
  const completionErrorProps = {
    completionError: completeFirstRunError,
    onRetry: retryOnboardingCompletion,
  };

  if (!firstRun) return null;

  if (error) {
    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
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

  const handleBuilder = (provisionAccount = canActivateBuilderFreeCredits) => {
    if (previewMode) {
      showTools();
      return;
    }
    if (connectFlow.hasFetchedStatus && connectFlow.configured) {
      trackFirstRunStepCompleted("choice");
      showTools();
      return;
    }
    setBuilderConnectionMode(
      provisionAccount && canActivateBuilderFreeCredits
        ? "provision"
        : "existing",
    );
    setScreen("connecting");
    connectFlow.start({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
      provisionAccount,
    });
  };

  const handleOpenSettings = () => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "integrations" },
      }),
    );
    void finishOnboarding("manual");
  };

  const handleFinish = (completeStep = true) => {
    if (extensions.length === 0) {
      void finishOnboarding(completeStep ? "role" : null);
      return;
    }
    if (completeStep) trackFirstRunStepCompleted("role");
    setExtensionIndex(0);
    setScreen("extension");
  };

  const handleRoleContinue = async () => {
    if (!selectedRole || savingRole) return;
    setSavingRole(true);
    setRoleSaveError(null);
    try {
      if (!previewMode) await saveFirstRunOnboardingRole(selectedRole);
      handleFinish();
    } catch (error) {
      setRoleSaveError(
        error instanceof Error
          ? error.message
          : t("agentChat.onboarding.saveRoleError"),
      );
    } finally {
      setSavingRole(false);
    }
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

    if (!mcpServersQuery.isSuccess) return;

    if (hasOrg) {
      setIntegrationDialogId(integration.id);
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
      void finishOnboarding(null);
      return null;
    }
    const Extension = extension.component;
    const advanceExtension = () => {
      if (extensionIndex < extensions.length - 1) {
        trackFirstRunStepCompleted("extension", extensionIndex);
        setExtensionIndex((current) => current + 1);
        return;
      }
      void finishOnboarding("extension", extensionIndex);
    };
    return (
      <>
        <Extension
          onComplete={advanceExtension}
          onSkip={() => void finishOnboarding(null)}
        />
        {completeFirstRunError && (
          <FirstRunCompletionError
            message={completeFirstRunError}
            onRetry={() => {
              const attempt = completionAttemptRef.current;
              void finishOnboarding(
                attempt?.screen ?? null,
                attempt?.extensionIndex ?? extensionIndex,
              );
            }}
          />
        )}
      </>
    );
  }

  if (screen === "intro") {
    return (
      <OnboardingShell
        profile={profile}
        screen="intro"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
        <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
            Free forever.
            <br />
            <span className="text-primary">Open source for life.</span>
          </h1>
          <div className="mt-7 grid w-full gap-2 text-left sm:grid-cols-3">
            <div className="rounded-lg bg-muted/35 px-3 py-3">
              <p className="text-xs font-medium">Fully customizable</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Change the UI, code, and behavior.
              </p>
            </div>
            <div className="rounded-lg bg-muted/35 px-3 py-3">
              <p className="text-xs font-medium">Bring your own keys</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Use your own providers and accounts.
              </p>
            </div>
            <div className="rounded-lg bg-muted/35 px-3 py-3">
              <p className="text-xs font-medium">Build your own</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Mix and match toolkit pieces in your own apps.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={cn(primaryButtonClass, "mt-6")}
            onClick={() => {
              trackFirstRunStepCompleted("intro");
              setScreen("choice");
            }}
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
      <OnboardingShell
        profile={profile}
        screen="choice"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <h1 className="text-center text-xl font-semibold tracking-[-0.04em] sm:text-2xl">
            Choose your setup.
          </h1>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl bg-primary/[0.06] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {canActivateBuilderFreeCredits
                      ? t("agentChat.onboarding.builderActivateCredits")
                      : t("agentChat.onboarding.builderConnectCredits")}
                  </h2>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    {canActivateBuilderFreeCredits ? (
                      t("agentChat.onboarding.builderActivateDescription")
                    ) : (
                      <>
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
                      </>
                    )}
                  </p>
                </div>
                <IconArrowRight className="mt-0.5 text-primary" size={17} />
              </div>
              <div className="mt-5 pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {canActivateBuilderFreeCredits
                    ? t("agentChat.onboarding.builderActiveCredits")
                    : t("agentChat.onboarding.builderCredits")}
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
                      <span className="inline-flex items-center gap-0.5">
                        <span>{capability.label}</span>
                        {capability.id === "design-system-intelligence" && (
                          <CapabilityInfoButton
                            capability={capability}
                            ariaLabel={`About ${capability.label}`}
                          />
                        )}
                      </span>
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
              <BuilderConnectPopover
                flow={connectFlow}
                onConnect={(provisionAccount) =>
                  handleBuilder(provisionAccount)
                }
                contentTestId="first-run-builder-consent"
                primaryTestId="first-run-builder-create-and-activate"
                secondaryTestId="first-run-builder-existing-account"
              >
                <button
                  type="button"
                  data-testid="first-run-connect-builder"
                  className={cn(primaryButtonClass, "mt-5 w-full")}
                >
                  {t(
                    canActivateBuilderFreeCredits
                      ? "agentChat.onboarding.builderActivateCredits"
                      : "agentChat.onboarding.builderConnectCredits",
                  )}
                  <IconArrowRight size={15} />
                </button>
              </BuilderConnectPopover>
            </section>

            <div
              role="button"
              tabIndex={0}
              aria-label="Use my own keys"
              data-testid="first-run-use-own-keys"
              className="rounded-xl bg-muted/35 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                trackFirstRunStepCompleted("choice");
                setScreen("manual");
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                trackFirstRunStepCompleted("choice");
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
                className="mt-5 pt-3"
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
                href={docsUrl("environment-variables")}
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
      <OnboardingShell
        profile={profile}
        screen="choice"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
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
          <div className="rounded-xl bg-muted/35 p-4">
            <CapabilityList capabilities={profile.capabilities} />
            <div className="mt-5 flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-between">
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
                onClick={() => {
                  trackFirstRunStepCompleted("manual");
                  setScreen(skipIntegrations ? "role" : "tools");
                }}
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
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
        footer={
          <div
            data-testid="onboarding-tools-footer"
            className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-end gap-2"
          >
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setScreen("role")}
            >
              {t("agentChat.onboarding.skipForNow")}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                trackFirstRunStepCompleted("tools");
                setScreen("role");
              }}
            >
              {t("agentChat.common.continue")}
              <IconArrowRight size={15} />
            </button>
          </div>
        }
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.05em] sm:text-3xl">
              This app is an agent.
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Connect the tools your agent can use to gather context and take
              action. You can add more later in Settings.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Agent integrations
                  </p>
                </div>
                <label className="relative w-full max-w-xs">
                  <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={integrationQuery}
                    onChange={(event) =>
                      setIntegrationQuery(event.target.value)
                    }
                    className="h-9 w-full rounded-md border border-border bg-background pe-3 ps-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                    placeholder="Search integrations"
                    aria-label="Search integrations"
                  />
                </label>
              </div>
              {connectError && (
                <p className="text-xs leading-5 text-destructive">
                  {connectError}
                </p>
              )}
              {mcpServersQuery.isError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  <p>{formatMcpServersLoadError(mcpServersQuery.error)}</p>
                  <button
                    type="button"
                    onClick={() => void mcpServersQuery.refetch()}
                    disabled={mcpServersQuery.isFetching}
                    className="mt-2 font-medium underline underline-offset-2 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                  >
                    {mcpServersQuery.isFetching ? "Retrying…" : "Retry"}
                  </button>
                </div>
              ) : null}
            </div>

            <IntegrationGrid
              items={mcpIntegrations.map((integration) => {
                const connected = connectedUrls.has(
                  compareUrl(integration.url),
                );
                return {
                  id: integration.id,
                  name: integration.name,
                  description: integration.description,
                  logo: (
                    <McpIntegrationLogo
                      name={integration.name}
                      logoUrl={integration.logoUrl}
                      integrationId={integration.id}
                      className="size-7 rounded-md"
                      imageClassName="size-full p-1"
                    />
                  ),
                  status: connected ? "Connected" : undefined,
                  statusClassName: "text-emerald-600 dark:text-emerald-400",
                  actionLabel: connected ? "Connected" : "Connect",
                  disabled:
                    connected ||
                    connectingIntegrationId === integration.id ||
                    !mcpServersQuery.isSuccess,
                  onAction: () => void connectIntegration(integration),
                };
              })}
              emptyLabel="No integrations match."
            />
          </div>
        </div>
        {integrationDialogId && (
          <McpIntegrationDialog
            open
            onOpenChange={(open) => {
              if (!open) setIntegrationDialogId(null);
            }}
            connectIntegrationId={integrationDialogId}
            defaultScope="user"
            canCreateOrgMcp={canCreateOrgMcp}
            hasOrg={hasOrg}
            onCreateMcpServer={createMcpServer.mutateAsync}
          />
        )}
      </OnboardingShell>
    );
  }

  if (screen === "role") {
    return (
      <OnboardingShell
        profile={profile}
        screen="role"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
        <div
          className="mx-auto flex w-full max-w-md flex-col"
          data-testid="first-run-role"
        >
          <button
            type="button"
            className="mb-5 self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setScreen(roleBackScreen)}
          >
            {t("agentChat.onboarding.back")}
          </button>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] sm:text-3xl">
            {t("agentChat.onboarding.customizeRole")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("agentChat.onboarding.roleQuestion")}
          </p>
          <fieldset className="mt-7 grid gap-2">
            <legend className="sr-only">
              {t("agentChat.onboarding.chooseRole")}
            </legend>
            {FIRST_RUN_ROLE_OPTIONS.map(({ value, labelKey }) => (
              <label
                key={value}
                data-testid={`first-run-role-${value}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
                  selectedRole === value
                    ? "bg-primary/[0.06] ring-1 ring-primary/30"
                    : "bg-muted/35 hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="first-run-role"
                  value={value}
                  checked={selectedRole === value}
                  onChange={() => setSelectedRole(value)}
                  className="size-4 accent-primary"
                />
                <span>{t(labelKey)}</span>
              </label>
            ))}
          </fieldset>
          {roleSaveError && (
            <p className="mt-4 text-xs leading-5 text-destructive" role="alert">
              {roleSaveError}
            </p>
          )}
          <div className="mt-6 flex justify-between gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => handleFinish(false)}
              disabled={savingRole}
            >
              {t("agentChat.onboarding.skipForNow")}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void handleRoleContinue()}
              disabled={!selectedRole || savingRole}
            >
              {savingRole
                ? t("agentChat.common.saving")
                : t("agentChat.common.continue")}
              {!savingRole && <IconArrowRight size={15} />}
            </button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "connecting") {
    const accountExists = connectFlow.accountExists;
    const provisioning =
      builderConnectionMode === "provision" && !accountExists;
    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        onDismiss={dismissOnboarding}
        {...completionErrorProps}
      >
        <div
          className="mx-auto flex w-full max-w-md flex-col items-center text-center"
          role="status"
          aria-live="polite"
          aria-busy={connectFlow.connecting}
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            {accountExists ? (
              <IconKey size={19} />
            ) : (
              <IconLoader2 className="animate-spin" size={19} />
            )}
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">
            {accountExists
              ? t("agentChat.onboarding.builderAccountExistsTitle")
              : provisioning
                ? t("agentChat.onboarding.builderActivating")
                : t("agentChat.onboarding.builderConnecting")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {accountExists
              ? t("agentChat.onboarding.builderAccountExistsDescription")
              : provisioning
                ? t("agentChat.onboarding.builderProvisioningDescription")
                : t("agentChat.onboarding.builderConnectionDescription")}
          </p>
          {accountExists ? (
            <button
              type="button"
              className={cn(primaryButtonClass, "mt-7 w-full")}
              onClick={() => handleBuilder(false)}
              disabled={connectFlow.connecting}
            >
              {t("agentChat.auth.logIn")}
              <IconArrowRight size={15} />
            </button>
          ) : (
            <>
              <div className="mt-7 w-full rounded-xl bg-muted/35 p-4 text-left">
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
                  <p className="text-xs text-destructive">
                    {connectFlow.error}
                  </p>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => setScreen("choice")}
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      profile={profile}
      screen="ready"
      onDismiss={dismissOnboarding}
      {...completionErrorProps}
    >
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
            <div key={title} className="rounded-xl bg-muted/35 px-4 py-4">
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
          onClick={() => void finishOnboarding("ready")}
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
  onDismiss,
  completionError,
  onRetry,
  children,
}: {
  profile: OnboardingAppProfile | null;
  screen: "intro" | "choice" | "tools" | "role" | "ready";
  footer?: React.ReactNode;
  onDismiss?: () => void;
  completionError?: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background text-foreground"
      data-onboarding-screen={screen}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile?.appName ?? "Your app"} setup`}
    >
      {onDismiss ? (
        <button
          type="button"
          data-testid="first-run-dismiss"
          aria-label={t("agentChat.common.dismiss")}
          onClick={onDismiss}
          className="absolute end-4 top-4 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconX size={17} />
        </button>
      ) : null}
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
                : screen === "tools" || screen === "role" || screen === "ready"
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
      {completionError && onRetry ? (
        <FirstRunCompletionError message={completionError} onRetry={onRetry} />
      ) : null}
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
  const visibleCapabilities = useMemo(() => {
    if (!compact) return capabilities;
    const suggested = capabilities.filter((capability) => capability.suggested);
    const leading = capabilities.filter((capability) => !capability.suggested);
    return [
      ...leading.slice(0, Math.max(0, 4 - suggested.length)),
      ...suggested,
    ].slice(0, 4);
  }, [capabilities, compact]);

  return (
    <div className={cn("grid", className)}>
      {!compact && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Keys and integrations
        </p>
      )}
      <div className="grid gap-1">
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
          <CapabilityInfoButton
            capability={capability}
            ariaLabel={`Why ${capability.label} is needed`}
          />
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {capability.keySummary}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-[10px] uppercase tracking-[0.08em]",
          capability.required || capability.suggested
            ? "text-primary"
            : "text-muted-foreground",
        )}
      >
        {capability.required
          ? "Required"
          : capability.suggested
            ? "Suggested"
            : "Optional"}
      </span>
    </div>
  );
}

function CapabilityInfoButton({
  capability,
  ariaLabel,
}: {
  capability: OnboardingCapability;
  ariaLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
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
  );
}

const primaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/** Inline failure signal for a failed completeFirstRun() call — keeps the
 *  user on their current screen with a way forward, instead of swapping to
 *  an unrelated full-screen error or leaving Skip/Continue looking like it
 *  did nothing. */
function FirstRunCompletionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-2 text-xs shadow-lg">
      <span className="text-destructive">{message}</span>
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:no-underline"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

const secondaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

function compareUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}
