import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { IconExternalLink, IconGitBranch } from "@tabler/icons-react";
import { useMemo } from "react";

import type {
  AgentNativeDeploymentEnvironment,
  AgentNativeConfig,
} from "../config.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { useSession } from "./use-session.js";

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
  const isFirstPartyHost =
    productionHost.endsWith(".agent-native.com") ||
    productionHost === "agent-workspace.builder.io";
  if (!isFirstPartyHost) return null;

  return {
    betaHost: `beta.${productionHost}`,
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
    return null;
  }
}

function EnvironmentLink({ label, href }: { label: string; href: string }) {
  return (
    <Button
      asChild
      className="w-full justify-start px-2"
      size="sm"
      variant="ghost"
    >
      <a href={href}>
        <IconExternalLink aria-hidden="true" />
        {label}
      </a>
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
  const environment = resolveEnvironmentChannel(
    config,
    typeof window === "undefined" ? undefined : window.location.hostname,
  );
  const targets = resolveEnvironmentTargets(
    typeof window === "undefined" ? undefined : window.location.hostname,
  );

  if (
    typeof window === "undefined" ||
    window.parent !== window ||
    status !== "authenticated" ||
    !isBuilderIoEmployee(session?.email) ||
    !environment ||
    !targets
  ) {
    return null;
  }

  const currentHref = window.location.href;
  const betaHref = buildEnvironmentUrl(currentHref, targets.betaHost);
  const productionHref = buildEnvironmentUrl(
    currentHref,
    targets.productionHost,
  );
  if (!betaHref || !productionHref) return null;

  const label = environment === "beta" ? "beta" : "prod";
  const title =
    environment === "beta" ? "Beta environment" : "Production environment";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Open ${title.toLowerCase()} switcher`}
          className="fixed bottom-3 right-3 z-[100] h-7 rounded-full border-border/80 bg-background/95 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] shadow-sm backdrop-blur-sm"
          size="sm"
          variant={environment === "beta" ? "secondary" : "outline"}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${environment === "beta" ? "bg-primary" : "bg-muted-foreground"}`}
          />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" side="top">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <IconGitBranch
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          {title}
        </div>
        <div className="grid gap-1">
          {environment === "beta" ? (
            <EnvironmentLink href={productionHref} label="Go to production" />
          ) : (
            <EnvironmentLink href={betaHref} label="Go to beta" />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
