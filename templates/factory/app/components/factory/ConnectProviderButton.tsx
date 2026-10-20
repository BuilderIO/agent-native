import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { workspaceProviderOAuthUrl } from "@agent-native/core/client/integrations";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import {
  dispatchApiKeysHref,
  isWorkspaceAppEnvironment,
  useOrgSwitcherAppLinks,
} from "@agent-native/toolkit/app/org/workspace-app-links";
import { useCallback, useEffect, useRef } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-config";

import {
  connectTarget,
  type ProviderConnection,
  type ReadinessKind,
} from "./connection-rows";

const POPUP_FEATURES = "width=640,height=760";
const POPUP_WATCH_MS = 500;
// What the popup's last page posts back to the window that opened it.
const SIGN_IN_COMPLETE = "agent-native:workspace-connection-complete";

/** A path inside this app, without the base path a workspace mounts it under. */
function appRelativePath(url: URL): string {
  const base = appBasePath();
  const path =
    base && url.pathname.startsWith(`${base}/`)
      ? url.pathname.slice(base.length)
      : url.pathname;
  return path + url.search;
}

function popupReturnPath(): string {
  const page = new URL(
    agentNativePath("/_agent-native/oauth/popup"),
    window.location.href,
  );
  page.searchParams.set("complete", "workspace-connection");
  return appRelativePath(page);
}

/**
 * Opens a provider's sign-in in a popup, so the page and its unsaved edits
 * stay where they are, and calls `onDone` when the popup posts that it is
 * finished or is closed. Where popups are blocked it signs in on this page
 * and comes back to it.
 */
function useSignIn(onDone: () => void) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const stopWatching = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatching.current?.(), []);

  return useCallback((provider: string) => {
    stopWatching.current?.();
    const url = (returnPath: string) =>
      workspaceProviderOAuthUrl(provider, {
        appId: APP_NAME,
        scope: "user",
        returnPath,
      });
    const popup = openOAuthPopup({ features: POPUP_FEATURES });
    if (!popup) {
      window.location.assign(
        url(appRelativePath(new URL(window.location.href))),
      );
      return;
    }
    popup.location.assign(url(popupReturnPath()));

    const finish = () => {
      stopWatching.current?.();
      onDoneRef.current();
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === SIGN_IN_COMPLETE
      ) {
        finish();
      }
    };
    const timer = window.setInterval(() => {
      if (popup.closed) finish();
    }, POPUP_WATCH_MS);
    window.addEventListener("message", onMessage);
    stopWatching.current = () => {
      window.clearInterval(timer);
      window.removeEventListener("message", onMessage);
      stopWatching.current = null;
    };
  }, []);
}

/**
 * The one way a provider gets connected from this app: Settings and the
 * workflow editor both use it, so they send a person to the same place.
 */
export function ConnectProviderButton({
  provider,
  connectWith,
  readiness,
  onConnected,
}: {
  provider: string;
  connectWith: ProviderConnection["connectWith"];
  readiness: ReadinessKind;
  /** The sign-in finished or was closed; the connection is worth checking again. */
  onConnected?: () => void;
}) {
  const t = useT();
  const missing = readiness === "needs_credentials";
  const target = connectTarget(provider, connectWith, {
    workspace: isWorkspaceAppEnvironment(),
    signIn: missing,
  });
  const { apps } = useOrgSwitcherAppLinks(target.kind === "dispatch");
  const signIn = useSignIn(() => onConnected?.());
  const label = missing
    ? t("settings.factory.connect")
    : t("settings.factory.manage");

  if (target.kind === "oauth") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => signIn(target.provider)}
      >
        {label}
      </Button>
    );
  }
  return (
    <Button asChild type="button" variant="outline" size="sm">
      {target.kind === "dispatch" ? (
        <a
          href={dispatchApiKeysHref(apps)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>
      ) : (
        <Link to={buildSettingsRoute(target.page, target.sub)}>{label}</Link>
      )}
    </Button>
  );
}
