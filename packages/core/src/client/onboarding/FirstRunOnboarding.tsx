import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowRight,
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconInfoCircle,
  IconKey,
  IconLoader2,
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
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import { useOnboarding } from "./use-onboarding.js";

type FirstRunScreen = "intro" | "choice" | "manual" | "connecting" | "ready";

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

export function FirstRunOnboarding() {
  const { firstRun, loading, error, profile, completeFirstRun } =
    useOnboarding();
  const [screen, setScreen] = useState<FirstRunScreen>("intro");

  const showReady = () => setScreen("ready");
  const connectFlow = useBuilderConnectFlow({
    enabled: firstRun,
    trackingSource: "first_run_onboarding",
    trackingFlow: "connect_llm",
    onConnected: showReady,
  });

  if (!firstRun) return null;

  if (loading || !profile) {
    return <OnboardingSkeleton />;
  }

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

  const builderCapabilities = profile.capabilities.filter(
    (capability) => capability.builderIncluded,
  );

  const handleBuilder = () => {
    if (connectFlow.hasFetchedStatus && connectFlow.configured) {
      showReady();
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
        detail: { section: "connections" },
      }),
    );
    await completeFirstRun();
  };

  const handleFinish = async () => {
    await completeFirstRun();
  };

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
                  <h2 className="text-sm font-semibold">Connect Builder.io</h2>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    One click connects{" "}
                    <a
                      href="https://www.builder.io/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Builder.io&apos;s free tier
                    </a>{" "}
                    with the services this app needs.
                  </p>
                </div>
                <IconArrowRight className="mt-0.5 text-primary" size={17} />
              </div>
              <div className="mt-5 border-t border-primary/15 pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Includes on the free tier
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
                        aria-label={`See ${BUILDER_MORE_SERVICES.length} more Builder.io services`}
                      >
                        +{BUILDER_MORE_SERVICES.length} more
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm text-xs">
                      <p className="font-medium">
                        Also included with Builder.io
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
                Connect Builder.io
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
            </div>
          </div>
        </div>
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
            Connecting Builder.io
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
    <OnboardingShell profile={profile} screen="choice">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <IconCheck size={20} />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">
          Ready to go.
        </h1>
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
  children,
}: {
  profile: OnboardingAppProfile;
  screen: "intro" | "choice";
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-screen flex-col bg-background text-foreground"
      data-onboarding-screen={screen}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile.appName} setup`}
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-4 text-xs text-muted-foreground sm:px-8">
        <div className="flex items-center gap-2">
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="h-4 w-auto shrink-0"
          />
          <span className="font-medium text-foreground">{profile.appName}</span>
        </div>
        <span>{screen === "intro" ? "1 / 2" : "2 / 2"}</span>
      </header>
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: screen === "intro" ? "50%" : "100%" }}
        />
      </div>
      <main className="flex min-h-0 flex-1 items-center overflow-y-auto px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}

function OnboardingSkeleton() {
  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-screen flex-col bg-background px-5 py-5 sm:px-8"
      data-onboarding-loading="true"
      aria-busy="true"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-8" />
      </div>
      <Skeleton className="mt-5 h-0.5 w-full" />
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center">
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
          Keys and connections
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
