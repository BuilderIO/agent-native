import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { useEffect, useMemo, useRef } from "react";

import type {
  AgentNativeDeploymentEnvironment,
  AgentNativeConfig,
} from "../config.js";
import { trackEvent } from "./analytics.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { useSession } from "./use-session.js";

export const BETA_OPT_OUT_QUERY_PARAM = "agentNativeBetaOptOut";
export const BETA_OPT_OUT_STORAGE_KEY = "agent-native:beta-opt-out-until";
export const BETA_OPT_OUT_DURATION_MS = 24 * 60 * 60 * 1000;

const ENVIRONMENT_BETA_HOSTS = {
  "agent-workspace.builder.io": "beta.agent-workspace.builder.io",
  "analytics.agent-native.com": "beta.analytics.agent-native.com",
  "assets.agent-native.com": "beta.assets.agent-native.com",
  "brain.agent-native.com": "beta.brain.agent-native.com",
  "calendar.agent-native.com": "beta.calendar.agent-native.com",
  "chat.agent-native.com": "beta.chat.agent-native.com",
  "clips.agent-native.com": "beta.clips.agent-native.com",
  "content.agent-native.com": "beta.content.agent-native.com",
  "crm.agent-native.com": "beta.crm.agent-native.com",
  "design.agent-native.com": "beta.design.agent-native.com",
  "dispatch.agent-native.com": "beta.dispatch.agent-native.com",
  "factory.agent-native.com": "beta.factory.agent-native.com",
  "forms.agent-native.com": "beta.forms.agent-native.com",
  "macros.agent-native.com": "beta.macros.agent-native.com",
  "mail.agent-native.com": "beta.mail.agent-native.com",
  "plan.agent-native.com": "beta.plan.agent-native.com",
  "slides.agent-native.com": "beta.slides.agent-native.com",
} as const;

export interface EnvironmentBadgeTargets {
  betaHost: string;
  productionHost: string;
}

export function isBuilderIoEmployee(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith("@builder.io") ?? false;
}

export function resolveEnvironmentTargets(
  hostname: string | undefined,
): EnvironmentBadgeTargets | null {
  const normalized = hostname?.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) return null;

  const productionHost = normalized.replace(/^beta\./, "");
  const betaHost =
    ENVIRONMENT_BETA_HOSTS[
      productionHost as keyof typeof ENVIRONMENT_BETA_HOSTS
    ];
  if (!betaHost) return null;

  return {
    betaHost,
    productionHost,
  };
}

export function resolveEnvironmentChannel(
  config: AgentNativeConfig,
  hostname: string | undefined,
): Extract<AgentNativeDeploymentEnvironment, "beta" | "production"> | null {
  const configured = config.deployment?.environment;
  if (configured === "beta" || configured === "production") {
    return configured;
  }

  const targets = resolveEnvironmentTargets(hostname);
  if (!targets || !hostname) return null;
  return hostname.trim().toLowerCase().startsWith("beta.")
    ? "beta"
    : "production";
}

export function buildEnvironmentUrl(
  sourceHref: string,
  targetHost: string,
): string | null {
  try {
    const target = new URL(sourceHref);
    target.protocol = "https:";
    target.hostname = targetHost;
    target.port = "";
    return target.toString();
  } catch {
    // coercion-ok: Invalid navigation input is an explicit absent target.
    return null;
  }
}

export function isBetaOptOutActive(
  value: string | number | null | undefined,
  now = Date.now(),
): boolean {
  const expiry = typeof value === "number" ? value : Number(value);
  return Number.isFinite(expiry) && expiry > now;
}

export function buildEnvironmentOptOutUrl(
  sourceHref: string,
  targetHost: string,
  now = Date.now(),
): string | null {
  const targetHref = buildEnvironmentUrl(sourceHref, targetHost);
  if (!targetHref) return null;

  try {
    const target = new URL(targetHref);
    target.searchParams.set(
      BETA_OPT_OUT_QUERY_PARAM,
      String(now + BETA_OPT_OUT_DURATION_MS),
    );
    return target.toString();
  } catch {
    // coercion-ok: buildEnvironmentUrl already validated the URL.
    return null;
  }
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
    }
    window.history.replaceState(null, "", target.toString());
  } catch {
    // coercion-ok: browser history/storage access is optional; the page must still load.
    // A browser that denies storage/history access must not block the page.
  }
  return active;
}

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

/**
 * Small internal-only lane switcher for first-party hosted Agent-Native apps.
 * It is mounted inside the authenticated AppProviders shell so public pages,
 * embeds, and signed-out visitors never receive environment navigation.
 */
export function EnvironmentBadge() {
  const { session, status } = useSession();
  const config = useMemo(injectedAgentNativeConfig, []);
  const didAutoRedirect = useRef(false);
  const hostname =
    typeof window === "undefined" ? undefined : window.location.hostname;
  const environment = resolveEnvironmentChannel(config, hostname);
  const targets = resolveEnvironmentTargets(hostname);
  const isEligible =
    typeof window !== "undefined" &&
    window.parent === window &&
    status === "authenticated" &&
    isBuilderIoEmployee(session?.email) &&
    !!environment &&
    !!targets;

  useEffect(() => {
    if (
      !isEligible ||
      environment !== "production" ||
      !targets ||
      didAutoRedirect.current
    ) {
      return;
    }

    if (readBetaOptOutUntil() !== null) return;
    if (consumeBetaOptOutQueryParam(window.location.href)) return;

    const betaHref = buildEnvironmentUrl(
      window.location.href,
      targets.betaHost,
    );
    if (!betaHref || typeof window.location.replace !== "function") return;

    didAutoRedirect.current = true;
    trackEvent("environment switched", {
      from_environment: "production",
      to_environment: "beta",
      trigger: "automatic_redirect",
    });
    window.location.replace(betaHref);
  }, [environment, isEligible, session?.email, status, targets?.betaHost]);

  if (
    !isEligible ||
    !environment ||
    !targets ||
    typeof window === "undefined"
  ) {
    return null;
  }

  const currentHref = window.location.href;
  const betaHref = buildEnvironmentUrl(currentHref, targets.betaHost);
  const productionHref = buildEnvironmentOptOutUrl(
    currentHref,
    targets.productionHost,
  );
  if (!betaHref || !productionHref) return null;

  const label = environment === "beta" ? "beta" : "prod";
  const title =
    environment === "beta"
      ? "You're on Agent Native Beta"
      : "You're on Agent Native Production";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Open ${title.toLowerCase()} switcher`}
          className="fixed bottom-3 right-3 z-[100] h-6 min-w-0 rounded-xl border-border/80 bg-background/95 px-2 text-[11px] font-semibold uppercase tracking-[0.5px] shadow-sm backdrop-blur-sm"
          size="sm"
          variant={environment === "beta" ? "default" : "outline"}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-[280px] p-5"
        side="top"
        sideOffset={8}
      >
        <div className="mb-1 text-sm font-semibold leading-5">{title}</div>
        <div className="mb-4 text-sm text-muted-foreground">
          Choose where you want to continue.
        </div>
        <div className="grid gap-2">
          {environment === "beta" ? (
            <EnvironmentLink
              href={productionHref}
              label="Switch to production"
            />
          ) : (
            <EnvironmentLink href={betaHref} label="Go to beta" />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
