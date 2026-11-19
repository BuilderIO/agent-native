import { appLocalMarkdownLinkPath } from "@agent-native/core/action-ui";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { Linking } from "react-native";

export const AppPanelLinkContext = createContext<
  ((url: string) => void) | null
>(null);
export function AppPanelLinkProvider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children?: ReactNode;
}) {
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
          target = new URL(
            localPath
              ? `${base.pathname.replace(/\/+$/, "")}${localPath}`
              : href,
            base,
          ).toString();
        }
        void Linking.openURL(target).catch(() =>
          console.warn("[chat] link could not be opened"),
        );
      } catch {
        console.warn("[chat] link could not be opened");
      }
    },
    [baseUrl],
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
