/**
 * Temporary, non-interactive recreation of the Clips desktop tray popover in
 * its default "ready to record" state, for screenshotting only.
 *
 * The real popover is a Tauri window excluded from screen capture (see
 * `set_capture_excluded` in templates/clips/desktop/src-tauri/src/lib.rs), so
 * it can't be screenshotted from the OS directly. This route reuses the
 * actual popover stylesheet and reproduces the idle markup from
 * templates/clips/desktop/src/app.tsx (the `popoverView === "recorder"`
 * return) so a screenshot of it looks like the real thing. Delete this route
 * once the capture is done — it is not a product page.
 */
import "../../../../templates/clips/desktop/src/styles.css";

function ScreenCamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle
        cx="17.5"
        cy="15.5"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg)"
      />
      <circle cx="17.5" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 20h8M12 16v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="7"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M17 10l4-2v8l-4-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="7"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M17 10l4-2v8l-4-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="13.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="3.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="13.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M3 9h18M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DictateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h10M18 7h2M4 17h2M10 17h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle
        cx="16"
        cy="7"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg, #000)"
      />
      <circle
        cx="8"
        cy="17"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg, #000)"
      />
    </svg>
  );
}

export default function ClipsReadyToRecordPreview() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#dcdcdc",
        padding: 40,
      }}
    >
      <div className="app app-recorder" style={{ width: 340 }}>
        <div className="recorder-home-content">
          <div className="header header-centered">
            <button
              className="icon-button header-close"
              aria-label="Feedback"
              style={{ visibility: "hidden" }}
            >
              <CloseIcon />
            </button>
            <div className="mode-toggle" role="radiogroup" aria-label="Recording mode">
              <button aria-label="Screen only">
                <ScreenIcon />
              </button>
              <button className="active" aria-label="Screen + Camera">
                <ScreenCamIcon />
              </button>
              <button aria-label="Camera only">
                <CamIcon />
              </button>
            </div>
            <button className="icon-button header-close" aria-label="Close" title="Close">
              <CloseIcon />
            </button>
          </div>

          <div className="panel">
            <div className="row row-on">
              <span className="row-icon">
                <MonitorIcon />
              </span>
              <button type="button" className="row-button" title="Full screen">
                <span className="row-label">Full screen</span>
                <span className="row-flex" aria-hidden />
                <span className="row-chev" aria-hidden>
                  <ChevronDown />
                </span>
              </button>
            </div>

            <div className="media-device-row">
              <div className="media-device-picker">
                <div className="row row-off">
                  <span className="row-icon">
                    <CameraIcon />
                  </span>
                  <button
                    type="button"
                    className="row-button"
                    disabled
                    title="Default camera"
                  >
                    <span className="row-label">Default camera</span>
                    <span className="row-flex" aria-hidden />
                  </button>
                  <span className="row-chev" aria-hidden>
                    <ChevronDown />
                  </span>
                  <button className="toggle toggle-off" role="switch" aria-checked={false}>
                    Off
                  </button>
                </div>
              </div>
            </div>

            <div className="media-device-row">
              <div className="media-device-picker">
                <div className="row row-on">
                  <span className="row-icon">
                    <MicIcon />
                  </span>
                  <button type="button" className="row-button" title="Default mic">
                    <span className="row-label">Default mic</span>
                    <span className="row-flex" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="row-menu-trigger"
                    aria-label="Choose mic"
                  >
                    <ChevronDown />
                  </button>
                  <button className="toggle toggle-on" role="switch" aria-checked>
                    On
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="recorder-disclosures">
            <div className="readiness">
              <button type="button" className="readiness-summary" aria-expanded={false}>
                <span className="readiness-title">Permissions</span>
                <span className="readiness-action">Review</span>
              </button>
            </div>
          </div>

          <button className="primary start">Start recording</button>
        </div>

        <div className="bottom-row">
          <button className="bottom-btn">
            <span className="bottom-icon">
              <LibraryIcon />
            </span>
            <span className="bottom-label">Library</span>
          </button>
          <button className="bottom-btn">
            <span className="bottom-icon">
              <CalendarIcon />
            </span>
            <span className="bottom-label">Meetings</span>
          </button>
          <button className="bottom-btn">
            <span className="bottom-icon">
              <DictateIcon />
            </span>
            <span className="bottom-label">Dictate</span>
          </button>
          <button className="bottom-btn">
            <span className="bottom-icon">
              <SettingsIcon />
            </span>
            <span className="bottom-label">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
