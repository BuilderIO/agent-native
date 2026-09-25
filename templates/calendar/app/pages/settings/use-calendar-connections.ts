import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import { toast } from "sonner";

import {
  useDisconnectGoogle,
  useGoogleAuthStatus,
  useGoogleDesktopAuth,
} from "@/hooks/use-google-auth";
import {
  useConnectZoom,
  useDisconnectZoom,
  useZoomStatus,
} from "@/hooks/use-zoom-auth";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";

/** Google Calendar and Zoom status plus their connect and disconnect handlers. */
export function useCalendarConnections() {
  const t = useT();
  const googleStatus = useGoogleAuthStatus();
  const disconnectGoogle = useDisconnectGoogle();
  const {
    isDesktopGoogleAuth,
    isGoogleDesktopAuthPending,
    startDesktopGoogleAuth,
  } = useGoogleDesktopAuth({
    onError: (issue) =>
      toast.error(issue.message || issue.error || t("settings.googleFailed")),
    onSuccess: () => window.location.reload(),
  });
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const disconnectZoom = useDisconnectZoom();
  const canOfferGoogleOAuthSetup = shouldOfferGoogleOAuthSetup();

  function connectGoogle() {
    if (isDesktopGoogleAuth) {
      startDesktopGoogleAuth({
        previousAccountCount: googleStatus.data?.accounts?.length ?? 0,
      });
      return;
    }
    const returnPath = `${window.location.pathname}${window.location.search}`;
    startWorkspaceProviderOAuth("google_calendar", {
      appId: "calendar",
      returnPath,
      scope: "user",
    });
  }

  async function disconnectGoogleAccounts() {
    const accounts = (googleStatus.data?.accounts ?? []).filter(
      (account) => !account.shared,
    );
    if (accounts.length === 0) return;
    try {
      for (const account of accounts) {
        await disconnectGoogle.mutateAsync(account.email);
      }
      toast.success(t("settings.googleDisconnected"));
    } catch {
      toast.error(t("settings.disconnectFailed"));
    }
  }

  function connectZoomAccount() {
    connectZoom.mutate(undefined, {
      onSuccess: () => toast(t("settings.zoomOpened")),
      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings.zoomConnectFailed"),
        ),
    });
  }

  function disconnectZoomAccount() {
    disconnectZoom.mutate(undefined, {
      onSuccess: () => toast.success(t("settings.zoomDisconnected")),
      onError: () => toast.error(t("settings.zoomDisconnectFailed")),
    });
  }

  return {
    googleStatus,
    canOfferGoogleOAuthSetup,
    isGoogleDesktopAuthPending,
    isGoogleDisconnectPending: disconnectGoogle.isPending,
    showGoogle:
      googleStatus.isError ||
      googleStatus.data?.connected === true ||
      googleStatus.data?.configured === true ||
      canOfferGoogleOAuthSetup,
    canDisconnectGoogle:
      googleStatus.data?.connected === true &&
      googleStatus.data.accounts.some((account) => !account.shared),
    canConnectGoogle:
      googleStatus.data?.configured === true || canOfferGoogleOAuthSetup,
    connectGoogle,
    disconnectGoogleAccounts,
    zoomStatus,
    isZoomConnectPending: connectZoom.isPending,
    isZoomDisconnectPending: disconnectZoom.isPending,
    connectZoomAccount,
    disconnectZoomAccount,
  };
}
