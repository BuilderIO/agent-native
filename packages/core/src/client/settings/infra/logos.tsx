import { IconCube } from "@tabler/icons-react";
import type { ComponentType } from "react";

import { mcpIntegrationLogo } from "../../resources/mcp-integration-logos.js";
import { cn } from "../../utils.js";
import {
  SERVICE_PROVIDER_LOGOS,
  type ServiceProviderId,
} from "./infra-page-state.js";

type TablerIcon = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean;
}>;

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
  const url = logoId ? mcpIntegrationLogo(logoId) : "";
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
