import { IconCircleCheck, IconCircleOff } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";

import { isMacPlatform } from "../lib/platform";

type PermissionPane =
  | "microphone"
  | "speech"
  | "accessibility"
  | "input-monitoring";

type PermissionStatuses = {
  screen: boolean;
  camera: boolean;
  microphone: boolean;
  speech: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
};

const PERMISSION_CARDS: Array<{
  pane: PermissionPane;
  key: keyof PermissionStatuses;
  name: string;
  desc: string;
}> = [
  {
    pane: "microphone",
    key: "microphone",
    name: "Microphone",
    desc: "Needed to hear you for dictation and meeting transcripts.",
  },
  {
    pane: "speech",
    key: "speech",
    name: "Speech Recognition",
    desc: "Turns your voice into text on-device.",
  },
  {
    pane: "accessibility",
    key: "accessibility",
    name: "Accessibility",
    desc: "Lets Clips paste dictated text into other apps.",
  },
  {
    pane: "input-monitoring",
    key: "inputMonitoring",
    name: "Input Monitoring",
    desc: "Only needed for the hold-Fn dictation shortcut.",
  },
];

// Fallback deep-links when the native `open_macos_privacy_settings` command
// fails — same URLs the main app window uses.
const MACOS_PRIVACY_URLS: Record<PermissionPane, string> = {
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  speech:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "input-monitoring":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
};

function openPermissionSettings(pane: PermissionPane): void {
  invoke("open_macos_privacy_settings", { pane }).catch(() => {
    openExternal(MACOS_PRIVACY_URLS[pane]).catch((err) => {
      console.error("[onboarding] open privacy settings failed", err);
    });
  });
}

/**
 * First-launch overlay. Full-screen with a solid dark background — NOT
 * transparent like countdown/finalizing.
 *
 * Two steps:
 *   1. Feature selection — three cards with checkboxes (all checked by
 *      default).
 *   2. Permissions (macOS, when Voice Dictation or Meetings is enabled) —
 *      live permission-status cards polled every 2s so they flip to granted
 *      as the user works through System Settings. Never blocks: the primary
 *      button always continues.
 *
 * Finishing calls `set_feature_config` with the chosen features +
 * `onboardingComplete: true`, then opens the popover via `show_popover`.
 */
export function Onboarding() {
  const [clips, setClips] = useState(true);
  const [meetings, setMeetings] = useState(true);
  const [voice, setVoice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"features" | "permissions">("features");
  const [statuses, setStatuses] = useState<PermissionStatuses | null>(null);

  const needsPermissionsStep = (voice || meetings) && isMacPlatform();

  useEffect(() => {
    if (step !== "permissions") return;
    let cancelled = false;
    const check = () => {
      invoke<PermissionStatuses>("check_permission_statuses")
        .then((next) => {
          if (!cancelled) setStatuses(next);
        })
        .catch(() => {
          // Command unavailable — leave statuses null (cards show no status).
        });
    };
    check();
    const id = setInterval(check, 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step]);

  async function finish() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await invoke("set_feature_config", {
        config: {
          clipsEnabled: clips,
          meetingsEnabled: meetings,
          voiceEnabled: voice,
          launchAtLoginEnabled: true,
          autoHidePopoverEnabled: false,
          meetingTranscriptionMode: "ask",
          showMeetingWidgetEnabled: true,
          showInScreenCapture: false,
          onboardingComplete: true,
        },
      });
      await invoke("show_popover");
      // Close the onboarding window itself — show_popover only opens the
      // popover, it doesn't know an onboarding window exists to dismiss.
      await invoke("hide_onboarding_window");
    } catch (err) {
      console.error(
        "[onboarding] set_feature_config / show_popover failed",
        err,
      );
      setSubmitting(false);
    }
  }

  function handleFeaturesContinue() {
    if (needsPermissionsStep) {
      setStep("permissions");
      return;
    }
    void finish();
  }

  if (step === "permissions") {
    const allGranted =
      statuses !== null && PERMISSION_CARDS.every((card) => statuses[card.key]);
    return (
      <div className="onboarding-root">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Permissions</h1>
          <p className="onboarding-subtitle">
            Grant these in System Settings — Clips updates automatically
          </p>

          <div className="onboarding-features">
            {PERMISSION_CARDS.map((card) => {
              const granted = statuses ? statuses[card.key] : null;
              return (
                <div
                  className="onboarding-feature"
                  key={card.pane}
                  style={{ cursor: "default" }}
                >
                  <span
                    aria-label={
                      granted === null
                        ? undefined
                        : granted
                          ? "Granted"
                          : "Not granted"
                    }
                    style={{
                      display: "inline-flex",
                      flexShrink: 0,
                      marginTop: 1,
                      color: granted ? "#4ade80" : "#a3a3a3",
                    }}
                  >
                    {granted ? (
                      <IconCircleCheck size={18} stroke={2} />
                    ) : (
                      <IconCircleOff size={18} stroke={2} />
                    )}
                  </span>
                  <div className="onboarding-feature-text">
                    <span className="onboarding-feature-name">{card.name}</span>
                    <span className="onboarding-feature-desc">{card.desc}</span>
                  </div>
                  {!granted ? (
                    <button
                      type="button"
                      onClick={() => openPermissionSettings(card.pane)}
                      style={{
                        marginLeft: "auto",
                        alignSelf: "center",
                        flexShrink: 0,
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "#f5f5f5",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <button
            className="onboarding-cta"
            onClick={() => void finish()}
            disabled={submitting}
          >
            {submitting
              ? "Setting up..."
              : allGranted
                ? "Get Started"
                : "Continue anyway"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">
        <h1 className="onboarding-title">Welcome to Clips</h1>
        <p className="onboarding-subtitle">Choose your features</p>

        <div className="onboarding-features">
          <label className="onboarding-feature">
            <input
              type="checkbox"
              checked={clips}
              onChange={(e) => setClips(e.target.checked)}
              className="onboarding-checkbox"
            />
            <div className="onboarding-feature-text">
              <span className="onboarding-feature-name">Screen Recording</span>
              <span className="onboarding-feature-desc">
                Record your screen, camera, or both
              </span>
            </div>
          </label>

          <label className="onboarding-feature">
            <input
              type="checkbox"
              checked={meetings}
              onChange={(e) => setMeetings(e.target.checked)}
              className="onboarding-checkbox"
            />
            <div className="onboarding-feature-text">
              <span className="onboarding-feature-name">Meeting Notes</span>
              <span className="onboarding-feature-desc">
                AI-powered meeting transcription and note enhancement
              </span>
            </div>
          </label>

          <label className="onboarding-feature">
            <input
              type="checkbox"
              checked={voice}
              onChange={(e) => setVoice(e.target.checked)}
              className="onboarding-checkbox"
            />
            <div className="onboarding-feature-text">
              <span className="onboarding-feature-name">Voice Dictation</span>
              <span className="onboarding-feature-desc">
                Speak to type anywhere on your Mac
              </span>
            </div>
          </label>
        </div>

        <button
          className="onboarding-cta"
          onClick={handleFeaturesContinue}
          disabled={submitting}
        >
          {submitting
            ? "Setting up..."
            : needsPermissionsStep
              ? "Continue"
              : "Get Started"}
        </button>
      </div>
    </div>
  );
}
