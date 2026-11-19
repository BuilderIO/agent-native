import { appLocalMarkdownLinkPath } from "@agent-native/core/action-ui";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { Linking } from "react-native";

import { resolveMobileAppPanelTarget } from "@/lib/agent-chat/open-app";
import { useMobileNavigation } from "@/lib/navigation";
import { useApps } from "@/lib/use-apps";
import { useWorkspaceApps } from "@/lib/workspace-apps";

export const AppPanelLinkContext = createContext<
  ((url: string) => void) | null
>(null);
export function AppPanelLinkProvider({
  baseUrl,
  onUnavailable,
  children,
}: {
  baseUrl: string;
  onUnavailable?: () => void;
  children?: ReactNode;
}) {
  const navigation = useMobileNavigation();
  const { apps, loading, error } = useApps();
  const workspace = useWorkspaceApps();
  const openLink = useCallback(
    (href: string) => {
      try {
        let target = href;
        if (href.startsWith("/")) {
          const base = new URL(baseUrl);
          if (base.protocol !== "https:" && base.protocol !== "http:") {
            throw new Error("Invalid chat app URL");
          }
          const localPath = appLocalMarkdownLinkPath(href);
          if (localPath) {
            if (
              loading ||
              error ||
              workspace.loading ||
              base.username ||
              base.password ||
              base.search ||
              base.hash
            ) {
              throw new Error("Chat app unavailable");
            }
            const workspaceApps = workspace.enabled ? workspace.apps : [];
            const workspaceIds = new Set(workspaceApps.map((app) => app.id));
            const available = [
              ...workspaceApps,
              ...apps.filter((app) => !workspaceIds.has(app.id)),
            ];
            const matches = available.filter((app) => {
              try {
                const registered = new URL(app.url);
                return (
                  app.enabled &&
                  !registered.username &&
                  !registered.password &&
                  !registered.search &&
                  !registered.hash &&
                  registered.origin === base.origin &&
                  registered.pathname.replace(/\/+$/, "") ===
                    base.pathname.replace(/\/+$/, "")
                );
              } catch {
                return false;
              }
            });
            if (matches.length !== 1) throw new Error("Chat app unavailable");
            const resolved = resolveMobileAppPanelTarget(
              { app: matches[0].id, path: localPath },
              apps,
              workspaceApps,
            );
            if (resolved.status !== "ready" || !resolved.target.path) {
              throw new Error("Invalid app link");
            }
            navigation.push(
              `/app/${encodeURIComponent(resolved.target.app.id)}?path=${encodeURIComponent(resolved.target.path)}`,
            );
            return;
          }
          target = new URL(href, base).toString();
        }
        void Linking.openURL(target).catch(() =>
          console.warn("[chat] link could not be opened"),
        );
      } catch {
        if (appLocalMarkdownLinkPath(href)) onUnavailable?.();
        console.warn("[chat] link could not be opened");
      }
    },
    [apps, baseUrl, error, loading, navigation, onUnavailable, workspace],
  );
  return createElement(
    AppPanelLinkContext.Provider,
    { value: openLink },
    children,
  );
}

export function useAppPanelLink() {
  return useContext(AppPanelLinkContext);
}
