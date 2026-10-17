import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconChevronDown,
  IconNotes,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import { CLIPS_MEETINGS, isLabEnabled } from "../../../shared/labs";
import { loadDesktopAuthToken } from "../app";
import { dismissMeetingNotification } from "../lib/meeting-notification-dismissal";
import {
  detectMeetingJoinProvider,
  joinProviderLabel,
  meetingNotificationAutoHideMs,
  type MeetingJoinProvider,
} from "../lib/meeting-notification-timing";
import { openMeetingJoinUrl } from "../lib/open-meeting-join-url";
import { loadStoredServerUrl } from "../lib/url";

interface NotificationData {
  type: "calendar" | "adhoc";
  title: string;
  subtitle: string;
  meetingId: string;
  joinUrl?: string | null;
  platform?: string | null;
  browserBundleId?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  autoStart?: boolean;
}

interface TranscriptionStatusPayload {
  meetingId: string;
  error?: string;
}

interface ReplacementRecoveryPayload {
  meetingId: string;
  failedMeetingId: string;
}

const SNOOZE_MS = 5 * 60_000;
const FALLBACK_AUTO_HIDE_MS = 6 * 60_000;
const DISMISSAL_TOMBSTONE_MS = 30 * 60_000;
const NOTIFICATION_WINDOW_WIDTH = 504;
const NOTIFICATION_COLLAPSED_HEIGHT = 120;
const NOTIFICATION_RECOVERY_HEIGHT = 156;
const NOTIFICATION_MENU_HEIGHT = 224;

async function openJoinUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await openMeetingJoinUrl(url);
  } catch (err) {
    console.error("[clips-tray] openJoinUrl failed:", err);
  }
}

function resizeNotificationWindow(expanded: boolean, recovery = false) {
  const height = expanded
    ? NOTIFICATION_MENU_HEIGHT
    : recovery
      ? NOTIFICATION_RECOVERY_HEIGHT
      : NOTIFICATION_COLLAPSED_HEIGHT;
  getCurrentWindow()
    .setSize(new LogicalSize(NOTIFICATION_WINDOW_WIDTH, height))
    .catch((err) => {
      console.warn("[clips-meeting-notif] resize failed", err);
    });
}

function ProviderGlyph({ provider }: { provider: MeetingJoinProvider }) {
  if (provider === "zoom") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-zoom"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  if (provider === "meet") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-meet"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  if (provider === "teams") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-teams"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  return (
    <span
      className="meeting-notification-provider meeting-notification-provider-other"
      aria-hidden
    >
      <IconNotes size={14} stroke={2.2} />
    </span>
  );
}

export function MeetingNotification() {
  const t = useT();
  const [data, setData] = useState<NotificationData | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacementRecovery, setReplacementRecovery] =
    useState<ReplacementRecoveryPayload | null>(null);
  const [recoveryActionFailed, setRecoveryActionFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<NotificationData | null>(null);
  const startingRef = useRef<NotificationData | null>(null);
  const dismissedKeysRef = useRef(new Map<string, number>());
  const meetingsLabEnabledRef = useRef<boolean | null>(null);
  const pendingNotificationRef = useRef<{
    payload: NotificationData;
    options?: { hydrated?: boolean };
  } | null>(null);
  const [domHovered, setDomHovered] = useState(false);
  const [polledHovered, setPolledHovered] = useState(false);
  const hovered = domHovered || polledHovered;
  const prevHoveredRef = useRef(false);

  function notificationKey(payload: NotificationData): string {
    return [payload.type, payload.meetingId, payload.scheduledStart ?? ""].join(
      "|",
    );
  }

  function isDismissed(payload: NotificationData): boolean {
    const now = Date.now();
    const dismissed = dismissedKeysRef.current;
    for (const [key, expiresAt] of dismissed) {
      if (expiresAt <= now) dismissed.delete(key);
    }
    return dismissed.has(notificationKey(payload));
  }

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    let preferenceVersion = 0;
    let unlisten: (() => void) | null = null;

    const applyValues = (values: unknown): boolean => {
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        return false;
      }
      const enabled = isLabEnabled(
        values as Record<string, unknown>,
        CLIPS_MEETINGS,
      );
      meetingsLabEnabledRef.current = enabled;
      if (!enabled) {
        pendingNotificationRef.current = null;
        startingRef.current = null;
        hideNotification();
        return true;
      }
      const pending = pendingNotificationRef.current;
      pendingNotificationRef.current = null;
      if (pending) showNotification(pending.payload, pending.options);
      return true;
    };
    const serverUrl = loadStoredServerUrl();
    const authToken = loadDesktopAuthToken(serverUrl);

    const startFetch = () => {
      const requestVersion = preferenceVersion;
      void fetch(`${serverUrl}/_agent-native/actions/get-lab-states`, {
        credentials: "include",
        ...(authToken
          ? { headers: { Authorization: `Bearer ${authToken}` } }
          : {}),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`lab read failed (${response.status})`);
          }
          return response.json();
        })
        .then((payload) => {
          if (!cancelled && requestVersion === preferenceVersion) {
            applyValues(payload?.result ?? payload);
          }
        })
        .catch(() => {});
    };

    const updateListener = listen<{ values?: Record<string, unknown> }>(
      "clips:labs-updated",
      (event) => {
        if (cancelled || !applyValues(event.payload?.values)) return;
        preferenceVersion += 1;
      },
    );
    updateListener
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
        } else {
          unlisten = cleanup;
          startFetch();
        }
      })
      .catch(() => {
        if (!cancelled) startFetch();
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    resizeNotificationWindow(
      Boolean(data && menuOpen),
      Boolean(data && replacementRecovery),
    );
  }, [data, menuOpen, replacementRecovery]);

  useEffect(() => {
    return () => resizeNotificationWindow(false);
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    if (data) {
      win.show().catch(() => {});
    } else {
      win.hide().catch(() => {});
    }
  }, [data]);

  useEffect(() => {
    if (!data) {
      prevHoveredRef.current = false;
      setDomHovered(false);
      setPolledHovered(false);
      setShowClose(false);
      return;
    }
    setShowClose(hovered && !replacementRecovery);
    if (hovered === prevHoveredRef.current) return;
    prevHoveredRef.current = hovered;
    if (hovered) {
      clearAutoHide();
    } else {
      setMenuOpen(false);
      resumeAutoHide();
    }
  }, [data, hovered, replacementRecovery]);

  function showNotification(
    payload: NotificationData,
    options?: { hydrated?: boolean },
  ) {
    const labState = meetingsLabEnabledRef.current;
    if (labState === false) return;
    if (labState === null) {
      pendingNotificationRef.current = {
        payload,
        ...(options ? { options } : {}),
      };
      return;
    }
    if (isDismissed(payload)) return;
    startingRef.current = null;
    invoke("recording_pill_prewarm").catch(() => {});
    setData(payload);
    setError(null);
    setReplacementRecovery(null);
    setRecoveryActionFailed(false);
    setMenuOpen(false);
    setPending(!!payload.autoStart && !options?.hydrated);
    const startMs = payload.scheduledStart
      ? Date.parse(payload.scheduledStart)
      : NaN;
    const hideMs = Number.isFinite(startMs)
      ? meetingNotificationAutoHideMs(startMs)
      : FALLBACK_AUTO_HIDE_MS;
    scheduleAutoHide(hideMs);
  }

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;

    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };

    const showListener = listen<NotificationData>(
      "meetings:show-notification",
      (ev) => {
        showNotification(ev.payload);
      },
    );
    trackListen(showListener);

    trackListen(
      listen<{ hovered: boolean }>("meetings:notification-hover", (ev) => {
        setPolledHovered(ev.payload.hovered);
      }),
    );

    const hideListener = listen<TranscriptionStatusPayload>(
      "meetings:hide-notification",
      (ev) => {
        if (ev.payload.meetingId !== dataRef.current?.meetingId) return;
        startingRef.current = dataRef.current;
        hideNotification();
      },
    );
    trackListen(hideListener);
    const errorListener = listen<TranscriptionStatusPayload>(
      "meetings:transcription-error",
      (ev) => {
        const starting = startingRef.current;
        const restoring =
          !dataRef.current &&
          starting !== null &&
          starting.meetingId === ev.payload.meetingId;
        if (!restoring && ev.payload.meetingId !== dataRef.current?.meetingId)
          return;
        if (restoring) {
          setData(starting);
          setMenuOpen(false);
        }
        startingRef.current = null;
        setPending(false);
        setReplacementRecovery(null);
        setRecoveryActionFailed(false);
        setError(ev.payload.error || "Could not start notes.");
        scheduleAutoHide(15_000);
      },
    );
    trackListen(errorListener);
    trackListen(
      listen<ReplacementRecoveryPayload>(
        "meetings:replacement-recovery-required",
        (event) => {
          if (event.payload.meetingId !== dataRef.current?.meetingId) {
            const recoveryNotification: NotificationData = {
              type: "adhoc",
              title: "",
              subtitle: "",
              meetingId: event.payload.meetingId,
            };
            dataRef.current = recoveryNotification;
            setData(recoveryNotification);
          }
          startingRef.current = null;
          setReplacementRecovery(event.payload);
          setRecoveryActionFailed(false);
          setPending(false);
          setError(null);
          setMenuOpen(false);
          clearAutoHide();
          setShowClose(false);
        },
      ),
    );
    trackListen(
      listen<{ meetingId: string }>(
        "meetings:replacement-recovery-action-failed",
        (event) => {
          if (event.payload.meetingId !== dataRef.current?.meetingId) return;
          setPending(false);
          setRecoveryActionFailed(true);
        },
      ),
    );
    const startedListener = listen<TranscriptionStatusPayload>(
      "meetings:transcription-started",
      (ev) => {
        if (startingRef.current?.meetingId === ev.payload.meetingId) {
          startingRef.current = null;
        }
      },
    );
    trackListen(startedListener);

    Promise.all([showListener, hideListener, errorListener, startedListener])
      .then(() =>
        invoke<NotificationData | null>("take_pending_meeting_notification"),
      )
      .then((pending) => {
        if (stopped || !pending) return;
        if (dataRef.current) return;
        showNotification(pending, { hydrated: true });
      })
      .catch(() => {});

    return () => {
      stopped = true;
      clearAutoHide();
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearAutoHide() {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }

  function scheduleAutoHide(ms: number) {
    clearAutoHide();
    if (ms <= 0) {
      hideNotification();
      return;
    }
    autoHideTimerRef.current = setTimeout(() => hideNotification(), ms);
  }

  function resumeAutoHide() {
    if (replacementRecovery) return;
    const current = dataRef.current;
    const startMs = current?.scheduledStart
      ? Date.parse(current.scheduledStart)
      : NaN;
    const hideMs = Number.isFinite(startMs)
      ? meetingNotificationAutoHideMs(startMs)
      : FALLBACK_AUTO_HIDE_MS;
    scheduleAutoHide(hideMs);
  }

  function hideNotification() {
    clearAutoHide();
    setData(null);
    setError(null);
    setReplacementRecovery(null);
    setRecoveryActionFailed(false);
    setPending(false);
    setMenuOpen(false);
    dataRef.current = null;
  }

  function dismissNotification() {
    if (replacementRecovery) return;
    const current = dataRef.current;
    startingRef.current = null;
    if (current) {
      dismissedKeysRef.current.set(
        notificationKey(current),
        Date.now() + DISMISSAL_TOMBSTONE_MS,
      );
    }
    hideNotification();
    if (current) {
      void dismissMeetingNotification(current);
    }
  }

  async function takeNotes() {
    if (!data || pending || replacementRecovery) return;
    setPending(true);
    setError(null);
    setMenuOpen(false);
    emit("meetings:start-transcription", {
      meetingId: data.meetingId,
      joinUrl: data.joinUrl,
      platform: data.platform,
      browserBundleId: data.browserBundleId,
      reason: "user",
      scheduledStart: data.scheduledStart,
    }).catch((err) => {
      setPending(false);
      setError((err as Error)?.message ?? "Could not start notes.");
    });
  }

  async function joinMeeting() {
    if (!data?.joinUrl) return;
    setMenuOpen(false);
    await openJoinUrl(data.joinUrl);
  }

  async function joinAndOpenClips() {
    if (!data || pending || replacementRecovery) return;
    setMenuOpen(false);
    if (data.joinUrl) {
      await openJoinUrl(data.joinUrl);
    }
    await takeNotes();
  }

  function snooze() {
    if (!data || replacementRecovery) return;
    setMenuOpen(false);
    invoke("meetings_snooze", {
      meetingId: data.meetingId,
      minutes: Math.round(SNOOZE_MS / 60_000),
    }).catch(() => {});
    hideNotification();
  }

  async function copyUnsavedNotesAndStart() {
    if (!data || !replacementRecovery || pending) return;
    setPending(true);
    setError(null);
    setRecoveryActionFailed(false);
    try {
      await emit("meetings:replacement-copy-and-start-request", {
        meetingId: data.meetingId,
        failedMeetingId: replacementRecovery.failedMeetingId,
      });
    } catch (actionError) {
      console.warn(
        "[clips-meeting-notif] could not request transcript recovery:",
        actionError,
      );
      setPending(false);
      setRecoveryActionFailed(true);
    }
  }

  if (!data) {
    return <div className="meeting-notification-root" />;
  }

  const hasJoin = Boolean(data.joinUrl);
  const provider = detectMeetingJoinProvider(data.joinUrl, data.platform);
  const providerName = joinProviderLabel(provider);
  const primaryLabel = hasJoin
    ? provider === "other"
      ? "Join meeting"
      : `Join ${providerName}`
    : "Start notes";
  const secondaryLabel = hasJoin ? "& open Clips" : null;
  const recoveryDescription = replacementRecovery
    ? t("meetingReplacement.description")
    : null;

  return (
    <div className="meeting-notification-root">
      <div
        className="meeting-notification"
        onMouseEnter={() => setDomHovered(true)}
        onMouseLeave={() => setDomHovered(false)}
      >
        <div className="meeting-notification-content">
          <div className="meeting-notification-title">
            {data.title ||
              (replacementRecovery ? t("meetingReplacement.title") : "")}
          </div>
          <div className="meeting-notification-subtitle">
            {!replacementRecovery &&
            data.type === "adhoc" &&
            data.browserBundleId
              ? t("meetingBrowserConfirmation")
              : !replacementRecovery
                ? data.subtitle
                : null}
          </div>
          {error ? (
            <div className="meeting-notification-error" role="alert">
              <IconAlertCircle size={12} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          {recoveryDescription ? (
            <div className="meeting-notification-error" role="alert">
              <IconAlertCircle size={12} aria-hidden="true" />
              <span>
                {recoveryActionFailed
                  ? t("meetingReplacement.actionFailed")
                  : recoveryDescription}
              </span>
            </div>
          ) : null}
        </div>
        <div className="meeting-notification-split">
          <button
            className="meeting-notification-split-main"
            onClick={
              replacementRecovery
                ? copyUnsavedNotesAndStart
                : hasJoin
                  ? joinAndOpenClips
                  : takeNotes
            }
            disabled={pending}
            data-no-drag
          >
            <ProviderGlyph provider={provider} />
            <span className="meeting-notification-split-copy">
              <span className="meeting-notification-split-primary">
                {pending
                  ? "Starting…"
                  : replacementRecovery
                    ? t("meetingReplacement.copyAndStart")
                    : primaryLabel}
              </span>
              {secondaryLabel && !pending && !replacementRecovery ? (
                <span className="meeting-notification-split-secondary">
                  {secondaryLabel}
                </span>
              ) : null}
            </span>
          </button>
          {!replacementRecovery ? (
            <button
              className="meeting-notification-split-chevron"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="More actions"
              aria-expanded={menuOpen}
              data-no-drag
            >
              <IconChevronDown size={14} aria-hidden="true" />
            </button>
          ) : null}
          {menuOpen ? (
            <div className="meeting-notification-menu" role="menu">
              {hasJoin ? (
                <button
                  role="menuitem"
                  className="meeting-notification-menu-item"
                  onClick={joinMeeting}
                  data-no-drag
                >
                  Join only
                </button>
              ) : null}
              <button
                role="menuitem"
                className="meeting-notification-menu-item"
                onClick={takeNotes}
                disabled={pending}
                data-no-drag
              >
                Start notes only
              </button>
              <button
                role="menuitem"
                className="meeting-notification-menu-item"
                onClick={snooze}
                data-no-drag
              >
                Snooze 5 min
              </button>
            </div>
          ) : null}
        </div>
        {showClose ? (
          <button
            className="meeting-notification-close"
            onClick={dismissNotification}
            aria-label="Dismiss"
            data-no-drag
          >
            <IconX size={10} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
