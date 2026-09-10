import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentNativeDeploymentEnvironment,
  AgentNativeConfig,
} from "../config.js";
import {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_DURATION_MS,
  BETA_REDIRECT_STORAGE_KEY,
  buildEnvironmentOptOutUrl,
  buildEnvironmentUrl,
  resolveEnvironmentTargets,
  type EnvironmentBadgeTargets,
} from "../shared/environment-lanes.js";
import { trackEvent } from "./analytics.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { useSession } from "./use-session.js";
import { cn } from "./utils.js";

export {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_DURATION_MS,
  BETA_REDIRECT_STORAGE_KEY,
  buildEnvironmentOptOutUrl,
  buildEnvironmentUrl,
  resolveEnvironmentTargets,
  type EnvironmentBadgeTargets,
} from "../shared/environment-lanes.js";

export function isBuilderIoEmployee(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith("@builder.io") ?? false;
}

export function isAgentNativeDesktopUserAgent(
  userAgent: string | undefined,
): boolean {
  return /AgentNativeDesktop/i.test(userAgent ?? "");
}

export function resolveEnvironmentChannel(
  config: AgentNativeConfig,
  hostname: string | undefined,
): Extract<
  AgentNativeDeploymentEnvironment,
  "local" | "beta" | "production"
> | null {
  const configured = config.deployment?.environment;
  if (
    configured === "local" ||
    configured === "beta" ||
    configured === "production"
  ) {
    return configured;
  }

  const targets = resolveEnvironmentTargets(hostname);
  if (!targets || !hostname) return null;
  return hostname.trim().toLowerCase().startsWith("beta.")
    ? "beta"
    : "production";
}

export function isBetaOptOutActive(
  value: string | number | null | undefined,
  now = Date.now(),
): boolean {
  const expiry = typeof value === "number" ? value : Number(value);
  return Number.isFinite(expiry) && expiry > now;
}

function readBetaOptOutUntil(now = Date.now()): number | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(BETA_OPT_OUT_STORAGE_KEY);
    if (isBetaOptOutActive(value, now)) return Number(value);
    if (value !== null) {
      window.localStorage.removeItem(BETA_OPT_OUT_STORAGE_KEY);
    }
  } catch {
    // coercion-ok: browser storage access is optional; the current URL remains authoritative.
    // Private browsing can deny storage access. The switcher still works;
    // the current navigation remains the explicit source of truth.
  }
  return null;
}

function rememberBetaRedirectPreference(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      BETA_REDIRECT_STORAGE_KEY,
      String(Date.now() + BETA_REDIRECT_DURATION_MS),
    );
  } catch {
    // coercion-ok: the marker is only a performance hint; session auth remains authoritative.
  }
}

function rememberForcedProductionSession(sourceHref: string): boolean {
  let forcedByQuery = false;
  try {
    forcedByQuery =
      new URL(sourceHref).searchParams.get(BETA_FORCE_QUERY_PARAM) === "true";
  } catch {
    // coercion-ok: the browser supplied an invalid location.
  }

  if (typeof window === "undefined") return forcedByQuery;

  try {
    if (forcedByQuery) {
      window.sessionStorage.setItem(BETA_FORCE_SESSION_STORAGE_KEY, "1");
    }
    return (
      forcedByQuery ||
      window.sessionStorage.getItem(BETA_FORCE_SESSION_STORAGE_KEY) === "1"
    );
  } catch {
    // coercion-ok: session storage is optional; the current URL remains authoritative.
    return forcedByQuery;
  }
}

function consumeBetaOptOutQueryParam(
  sourceHref: string,
  now = Date.now(),
): boolean {
  let target: URL;
  try {
    target = new URL(sourceHref);
  } catch {
    // coercion-ok: the browser supplied an invalid location.
    return false;
  }

  const rawExpiry = target.searchParams.get(BETA_OPT_OUT_QUERY_PARAM);
  if (rawExpiry === null) return false;

  const active = isBetaOptOutActive(rawExpiry, now);
  target.searchParams.delete(BETA_OPT_OUT_QUERY_PARAM);
  try {
    if (active) {
      window.localStorage.setItem(
        BETA_OPT_OUT_STORAGE_KEY,
        String(Number(rawExpiry)),
      );
      window.localStorage.removeItem(BETA_REDIRECT_STORAGE_KEY);
    }
    window.history.replaceState(null, "", target.toString());
  } catch {
    // coercion-ok: browser history/storage access is optional; the page must still load.
    // A browser that denies storage/history access must not block the page.
  }
  return active;
}

export type EnvironmentBadgePlacement = "fixed" | "inline";

const environmentBadgePlacementClasses = {
  fixed:
    "fixed bottom-3 left-3 z-[100] h-6 min-w-0 rounded-xl px-2 text-[11px] font-semibold uppercase tracking-[0.5px] shadow-sm backdrop-blur-sm",
  inline:
    "relative z-0 inline-flex h-5 min-w-0 shrink-0 rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-[0.5px] shadow-sm backdrop-blur-sm",
} satisfies Record<EnvironmentBadgePlacement, string>;

function EnvironmentLink({ label, href }: { label: string; href: string }) {
  return (
    <Button
      asChild
      className="w-full justify-center"
      size="sm"
      variant="outline"
    >
      <a href={href}>{label}</a>
    </Button>
  );
}

function EnvironmentBadgeContent({
  environment,
  placement,
  targets,
  badgeText,
  className,
}: {
  environment: "beta" | "production";
  placement: EnvironmentBadgePlacement;
  targets: EnvironmentBadgeTargets;
  badgeText?: string;
  className?: string;
}) {
  const [isHidden, setIsHidden] = useState(false);
  const { session } = useSession();
  const isBuilder = isBuilderIoEmployee(session?.email);

  if (typeof window === "undefined") return null;
  if (isHidden) return null;

  const currentHref = window.location.href;
  const betaHref = buildEnvironmentUrl(currentHref, targets.betaHost);
  const productionHref = buildEnvironmentOptOutUrl(
    currentHref,
    targets.productionHost,
  );
  if (environment === "beta" ? !productionHref : !betaHref) return null;

  const label = badgeText ?? "alpha";
  const title =
    environment === "beta"
      ? `You're on Agent-Native ${label.charAt(0).toUpperCase() + label.slice(1)}`
      : "You're on Agent-Native Production";

  const badgeClasses = cn(
    environmentBadgePlacementClasses[placement],
    environment === "beta"
      ? "border-primary/80"
      : "border-border/80 bg-background/95 text-foreground",
    className,
  );

  if (!isBuilder) {
    // Signed-out / non-Builder visitors keep a one-click lane switch (no
    // popover/hide controls). Beta always offers production; production
    // offers beta when a beta host is configured.
    const switchHref = environment === "beta" ? productionHref : betaHref;
    const switchLabel =
      environment === "beta" ? "Switch to production" : "Go to beta";
    if (switchHref) {
      return (
        <Button
          aria-label={switchLabel}
          asChild
          className={badgeClasses}
          size="sm"
          title={title}
          variant={environment === "beta" ? "default" : "outline"}
        >
          <a href={switchHref}>{label}</a>
        </Button>
      );
    }
    return (
      <div
        aria-label={title}
        className={cn(
          badgeClasses,
          "inline-flex items-center justify-center select-none",
          environment === "beta"
            ? "border-primary/80 bg-primary text-primary-foreground"
            : "border-border/80 bg-background/95 text-foreground",
        )}
        role="status"
      >
        {label}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Open ${title.toLowerCase()} switcher`}
          className={badgeClasses}
          size="sm"
          variant={environment === "beta" ? "default" : "outline"}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] p-5"
        side={placement === "inline" ? "bottom" : "top"}
        sideOffset={8}
      >
        <div className="mb-1 text-sm font-semibold leading-5">{title}</div>
        <div className="mb-4 text-sm text-muted-foreground">
          Choose where you want to continue.
        </div>
        <div className="grid gap-2">
          {environment === "beta" ? (
            <EnvironmentLink
              href={productionHref!}
              label="Switch to production"
            />
          ) : (
            <EnvironmentLink href={betaHref!} label="Go to beta" />
          )}
          <Button
            className="mt-2 -mb-2 w-full justify-center text-muted-foreground"
            onClick={() => setIsHidden(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Hide badge
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LocalEnvironmentBadge({
  placement,
  badgeText = "alpha",
  className,
}: {
  placement: EnvironmentBadgePlacement;
  badgeText?: string;
  className?: string;
}) {
  return (
    <div
      aria-label="Local development environment"
      className={cn(
        environmentBadgePlacementClasses[placement],
        "inline-flex items-center justify-center border border-border/80 bg-background/95 text-foreground select-none",
        className,
      )}
      role="status"
    >
      {badgeText}
    </div>
  );
}

function ProductionEnvironmentBadge({
  placement,
  targets,
  badgeText,
  className,
}: {
  placement: EnvironmentBadgePlacement;
  targets: EnvironmentBadgeTargets;
  badgeText?: string;
  className?: string;
}) {
  const { session, status } = useSession();
  const isEligible =
    typeof window !== "undefined" &&
    window.parent === window &&
    status === "authenticated" &&
    isBuilderIoEmployee(session?.email);
  const didAutoRedirect = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rememberForcedProductionSession(window.location.href)) return;
    if (!isEligible || didAutoRedirect.current) {
      return;
    }

    // Desktop child sessions are minted against their configured production
    // origin. Do not move that WebView to beta after the session is created.
    if (isAgentNativeDesktopUserAgent(window.navigator.userAgent)) return;

    if (readBetaOptOutUntil() !== null) return;
    if (consumeBetaOptOutQueryParam(window.location.href)) return;

    const betaHref = buildEnvironmentUrl(
      window.location.href,
      targets.betaHost,
    );
    if (!betaHref || typeof window.location.replace !== "function") return;

    rememberBetaRedirectPreference();
    didAutoRedirect.current = true;
    trackEvent("environment switched", {
      from_environment: "production",
      to_environment: "beta",
      trigger: "automatic_redirect",
    });
    window.location.replace(betaHref);
  }, [isEligible, session?.email, status, targets.betaHost]);

  return (
    <EnvironmentBadgeContent
      environment="production"
      placement={placement}
      targets={targets}
      badgeText={badgeText}
      className={className}
    />
  );
}

export interface EnvironmentBadgeProps {
  placement?: EnvironmentBadgePlacement;
  showProduction?: boolean;
  badgeText?: string;
  className?: string;
}

/**
 * Environment indicator and first-party hosted lane switcher. Beta is
 * intentionally visible before authentication so a visitor can always leave
 * beta from the sign-in page. Production remains an internal auto-redirect
 * lane for authenticated staff.
 */
export function EnvironmentBadge({
  placement = "fixed",
  showProduction = true,
  badgeText,
  className,
}: EnvironmentBadgeProps = {}) {
  const [hydrated, setHydrated] = useState(false);
  const config = useMemo(injectedAgentNativeConfig, []);
  const hostname =
    typeof window === "undefined" ? undefined : window.location.hostname;
  const environment = resolveEnvironmentChannel(config, hostname);
  const targets = resolveEnvironmentTargets(hostname);
  const resolvedBadgeText =
    badgeText ?? config.deployment?.badgeText ?? config.badgeText ?? "alpha";

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (
    !hydrated ||
    typeof window === "undefined" ||
    window.parent !== window ||
    !environment
  ) {
    return null;
  }

  if (environment === "local") {
    return (
      <LocalEnvironmentBadge
        placement={placement}
        badgeText={resolvedBadgeText}
        className={className}
      />
    );
  }

  if (!targets) {
    return (
      <div
        aria-label="Development environment"
        className={cn(
          environmentBadgePlacementClasses[placement],
          "inline-flex items-center justify-center border border-border/80 bg-background/95 text-foreground select-none",
          className,
        )}
        role="status"
      >
        {resolvedBadgeText}
      </div>
    );
  }

  if (environment === "beta") {
    return (
      <EnvironmentBadgeContent
        environment="beta"
        placement={placement}
        targets={targets}
        badgeText={resolvedBadgeText}
        className={className}
      />
    );
  }

  if (!showProduction) return null;
  return (
    <ProductionEnvironmentBadge
      placement={placement}
      targets={targets}
      badgeText={resolvedBadgeText}
      className={className}
    />
  );
}
