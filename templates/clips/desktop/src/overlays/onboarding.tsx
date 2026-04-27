import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Feature selection screen shown on first launch. Full-screen overlay with
 * a solid dark background — NOT transparent like countdown/finalizing.
 *
 * Three feature cards with checkboxes (all checked by default). "Get Started"
 * calls `set_feature_config` with the chosen features + `onboardingComplete:
 * true`, then opens the popover via `show_popover`.
 */
export function Onboarding() {
  const [clips, setClips] = useState(true);
  const [meetings, setMeetings] = useState(true);
  const [voice, setVoice] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function handleGetStarted() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await invoke("set_feature_config", {
        config: {
          clipsEnabled: clips,
          meetingsEnabled: meetings,
          voiceEnabled: voice,
          onboardingComplete: true,
        },
      });
      await invoke("show_popover");
    } catch (err) {
      console.error(
        "[onboarding] set_feature_config / show_popover failed",
        err,
      );
      setSubmitting(false);
    }
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
          onClick={handleGetStarted}
          disabled={submitting}
        >
          {submitting ? "Setting up..." : "Get Started"}
        </button>
      </div>
    </div>
  );
}
