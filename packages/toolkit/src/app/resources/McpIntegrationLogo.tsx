import { mcpIntegrationLogoNeedsDarkModeFilter } from "@agent-native/core/client/resources/mcp-integration-logos";
import { cn } from "@agent-native/toolkit/utils";
import { useEffect, useState, type CSSProperties } from "react";

export interface McpIntegrationLogoProps {
  name: string;
  logoUrl: string;
  integrationId?: string;
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  title?: string;
}

export function McpIntegrationLogo({
  name,
  logoUrl,
  integrationId,
  className,
  imageClassName,
  style,
  title,
}: McpIntegrationLogoProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showFallback = !logoUrl || failedLogoUrl === logoUrl;
  const invertOnDark =
    integrationId !== undefined &&
    mcpIntegrationLogoNeedsDarkModeFilter(integrationId);

  useEffect(() => {
    setFailedLogoUrl(null);
  }, [logoUrl]);

  return (
    <span
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-background text-xs font-semibold text-muted-foreground",
        className,
      )}
      style={style}
      title={title}
    >
      {showFallback ? (
        <span aria-hidden="true">{name.slice(0, 1)}</span>
      ) : (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "size-7 object-contain",
            invertOnDark && "dark:invert dark:hue-rotate-180",
            imageClassName,
          )}
          title={title}
          onError={() => setFailedLogoUrl(logoUrl)}
        />
      )}
    </span>
  );
}
