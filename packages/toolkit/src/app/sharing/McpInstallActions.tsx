import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useMcpConnectIdentity } from "@agent-native/core/client/mcp-connect-identity";
import {
  buildMcpInstallLink,
  getMcpConnectGuides,
  type McpInstallClient,
} from "@agent-native/core/shared/mcp-connect-content";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { cn } from "@agent-native/toolkit/utils";
import { IconExternalLink, IconPlug, IconSettings } from "@tabler/icons-react";
import { useMemo, type MouseEvent, type ReactNode } from "react";

const ROW_CLASS = "h-9 w-full justify-start gap-2 px-1.5 text-sm font-normal";

export interface McpInstallActionsProps {
  heading: ReactNode;
  clients?: readonly McpInstallClient[];
  otherClients: {
    label: ReactNode;
    href: string;
    /** Route the link in-app; plain and modified clicks still follow `href`. */
    onNavigate?: (href: string) => void;
  };
  onInstall?: (client: McpInstallClient) => void;
  className?: string;
}

/**
 * Install rows for this app's MCP server. The name, URL, and labels come from
 * core's connect identity and guides, so a share dialog writes the same entry
 * as Settings → MCP server. A link never carries the shared resource: the
 * prompt does that.
 */
export function McpInstallActions({
  heading,
  clients = ["cursor", "vscode"],
  otherClients,
  onInstall,
  className,
}: McpInstallActionsProps) {
  const t = useT();
  const { locale } = useLocale();
  const identityState = useMcpConnectIdentity();
  const labels = useMemo(() => {
    const byClient = new Map<McpInstallClient, string>();
    for (const guide of getMcpConnectGuides(locale)) {
      for (const option of guide.install ?? []) {
        byClient.set(option.client, option.label);
      }
    }
    return byClient;
  }, [locale]);

  const openOtherClients = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !otherClients.onNavigate ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    otherClients.onNavigate(otherClients.href);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-xs font-medium text-muted-foreground">{heading}</div>
      <div className="-mx-1.5 flex flex-col gap-0.5">
        {identityState.status === "ready" ? (
          // Without OAuth discovery an installed client cannot sign in, so
          // only the Other agents row, with its token steps, is offered.
          identityState.identity.oauth ? (
            clients.map((client) => {
              const link = buildMcpInstallLink(client, {
                serverName: identityState.identity.serverName,
                mcpUrl: identityState.identity.mcpUrl,
              });
              const label = labels.get(client);
              if (!label) throw new Error(`No MCP install guide for ${client}`);
              return (
                <Button
                  key={client}
                  asChild
                  variant="ghost"
                  className={ROW_CLASS}
                >
                  <a
                    href={link.href}
                    onClick={() => onInstall?.(client)}
                    {...(link.opensWebPage
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    <IconPlug
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                    {label}
                    {link.opensWebPage ? (
                      <IconExternalLink
                        aria-hidden="true"
                        className="ms-auto size-3.5 text-muted-foreground"
                      />
                    ) : null}
                  </a>
                </Button>
              );
            })
          ) : null
        ) : identityState.status === "error" ? (
          <div
            role="alert"
            className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground"
          >
            <span className="min-w-0 flex-1">
              {t("settings.mcpIdentityError")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={identityState.retry}
            >
              {t("settings.mcpRetry")}
            </Button>
          </div>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-0.5">
            {clients.map((client) => (
              <Skeleton key={client} className="mx-1.5 my-2.5 h-4 w-32" />
            ))}
          </div>
        )}
        <Button asChild variant="ghost" className={ROW_CLASS}>
          <a href={otherClients.href} onClick={openOtherClients}>
            <IconSettings
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {otherClients.label}
          </a>
        </Button>
      </div>
    </div>
  );
}
