import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import { cn } from "@agent-native/toolkit/utils";
import { IconCube } from "@tabler/icons-react";
import type { ComponentType } from "react";

import {
  SERVICE_PROVIDER_LOGOS,
  type ServiceProviderId,
} from "./infra-page-state.js";

type TablerIcon = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean;
}>;

/** The integration logo set's image for a brand, or "" when it has none. */
export function brandLogoUrl(logoId: string | null | undefined): string {
  return logoId ? mcpIntegrationLogo(logoId) : "";
}

/**
 * A brand logo from the integration logo set, or the given icon when the set
 * has none. Sized for a `SettingsRow` icon well (`md`) or a select item (`sm`).
 */
export function BrandLogo({
  logoId,
  fallback: Fallback,
  size = "md",
}: {
  logoId: string | null | undefined;
  fallback?: TablerIcon;
  size?: "sm" | "md";
}) {
  const url = brandLogoUrl(logoId);
  const box = size === "sm" ? "size-4" : "size-[18px]";
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className={cn(box, "shrink-0 object-contain")}
      />
    );
  }
  return Fallback ? (
    <Fallback className={cn(box, "shrink-0")} aria-hidden />
  ) : (
    <span aria-hidden className={cn(box, "shrink-0")} />
  );
}

export function ServiceProviderLogo({
  provider,
  size,
}: {
  provider: ServiceProviderId;
  size?: "sm" | "md";
}) {
  return (
    <BrandLogo
      logoId={SERVICE_PROVIDER_LOGOS[provider]}
      fallback={IconCube}
      size={size}
    />
  );
}
