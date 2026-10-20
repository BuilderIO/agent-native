import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconDeviceDesktop } from "@tabler/icons-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

const TOUCH_QUERY = "(pointer: coarse)";

/** The iPad mini's portrait width: the smallest screen the apps are built for. */
const TABLET_SCREEN_MIN_SIDE = 744;

function subscribe(onChange: () => void) {
  const query = window.matchMedia(TOUCH_QUERY);
  // Safari before 14 only has the deprecated listener API, and a throw here
  // would take down the whole app, not just the notice.
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

// The device's screen, not the window: an iPad in Split View or Slide Over has
// a phone-width window, and a phone turned sideways has a tablet-width one.
function isSmallTouchScreen(): boolean {
  return (
    window.matchMedia(TOUCH_QUERY).matches &&
    Math.min(window.screen.width, window.screen.height) < TABLET_SCREEN_MIN_SIDE
  );
}

function useSmallerThanTablet(): boolean {
  // The server snapshot is false: SSR HTML is one shared shell for every
  // visitor, so a phone swaps to the notice right after hydration.
  return useSyncExternalStore(subscribe, isSmallTouchScreen, () => false);
}

export interface UnsupportedDeviceGateProps {
  appName: string;
  /** What the visitor was opening, when the route says; names it in the title. */
  subject?: "deck" | "design";
  children: ReactNode;
}

/**
 * Replaces an editor-class app with a friendly hand-off on screens smaller
 * than an iPad: email the link to yourself and continue on a larger device.
 */
export function UnsupportedDeviceGate({
  appName,
  subject,
  children,
}: UnsupportedDeviceGateProps) {
  const smaller = useSmallerThanTablet();
  if (!smaller) return <>{children}</>;
  return <UnsupportedDeviceNotice appName={appName} subject={subject} />;
}

const TITLE_KEYS = {
  deck: "agentChat.unsupportedDevice.titleDeck",
  design: "agentChat.unsupportedDevice.titleDesign",
} as const;

function UnsupportedDeviceNotice({
  appName,
  subject,
}: Pick<UnsupportedDeviceGateProps, "appName" | "subject">) {
  const t = useT();
  const { session } = useSession();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyLink = async () =>
    setCopyState(
      (await writeClipboardText(window.location.href)) ? "copied" : "failed",
    );
  const url = window.location.href;
  const email = session?.email;
  const canShare = typeof navigator.share === "function";

  const shareLink = async () => {
    try {
      await navigator.share({ url, title: appName });
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError; anything else
      // means sharing is unavailable here, so fall back to copying.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  };

  const copyLabel =
    copyState === "copied"
      ? t("agentChat.unsupportedDevice.copied")
      : copyState === "failed"
        ? t("agentChat.unsupportedDevice.copyFailed")
        : null;

  // The gate runs before sign-in, so an unknown address gets no email action
  // rather than a blank To field.
  const actions = [
    canShare
      ? {
          id: "share",
          label: copyLabel ?? t("agentChat.unsupportedDevice.share"),
          run: shareLink,
        }
      : null,
    email
      ? {
          id: "email",
          label: t("agentChat.unsupportedDevice.email"),
          run: () => {
            window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
              t("agentChat.unsupportedDevice.emailSubject", { app: appName }),
            )}&body=${encodeURIComponent(url)}`;
          },
        }
      : null,
    !canShare
      ? {
          id: "copy",
          label: copyLabel ?? t("agentChat.unsupportedDevice.copy"),
          run: copyLink,
        }
      : null,
  ].filter((action) => action !== null);

  return (
    <main className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background px-8 text-center text-foreground">
      <IconDeviceDesktop
        size={32}
        stroke={1.5}
        className="text-muted-foreground"
        aria-hidden
      />
      <div className="flex max-w-xs flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {t(
            subject ? TITLE_KEYS[subject] : "agentChat.unsupportedDevice.title",
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("agentChat.unsupportedDevice.body", { app: appName })}
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {actions.map((action, index) => (
          <Button
            key={action.id}
            variant={index === 0 ? "default" : "ghost"}
            size="lg"
            onClick={action.run}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </main>
  );
}
