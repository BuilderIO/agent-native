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
 *
 * The Library backdrop behind the popover is a hand-built recreation of the
 * real library grid (templates/clips/app/components/library/recording-card.tsx)
 * for visual fidelity only — it does not import that component, which pulls in
 * Clips-only theme tokens and dependencies not present in the docs package.
 */
import {
  IconLock,
  IconPlayerPlay,
  IconSearch,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";

import "../../../../templates/clips/desktop/src/styles.css";

const LIBRARY_RECORDINGS: Array<{
  title: string;
  thumbnail: string;
  duration: string;
  relative: string;
  visibility: "public" | "org" | "private";
  ownerName: string;
  ownerInitials: string;
  viewCount: number;
}> = [
  {
    title: "Introducing Agent-Native Clips",
    thumbnail: "/clips/B0AgxdvzuZ7H.jpg",
    duration: "1:58",
    relative: "2 days ago",
    visibility: "public",
    ownerName: "Logan Affleck",
    ownerInitials: "LA",
    viewCount: 214,
  },
  {
    title: "Show Claude how to perform a task",
    thumbnail: "/clips/U1f0uKYYKGF2.jpg",
    duration: "3:12",
    relative: "5 days ago",
    visibility: "org",
    ownerName: "Logan Affleck",
    ownerInitials: "LA",
    viewCount: 58,
  },
  {
    title: "Record browser workflows with Clips",
    thumbnail: "/clips/1J2KR4ryo2Wg.jpg",
    duration: "2:41",
    relative: "1 week ago",
    visibility: "private",
    ownerName: "Logan Affleck",
    ownerInitials: "LA",
    viewCount: 12,
  },
  {
    title: "Weekly sync walkthrough",
    thumbnail: "/clips/B0AgxdvzuZ7H.jpg",
    duration: "8:05",
    relative: "1 week ago",
    visibility: "org",
    ownerName: "Priya Shah",
    ownerInitials: "PS",
    viewCount: 34,
  },
  {
    title: "Onboarding checklist review",
    thumbnail: "/clips/U1f0uKYYKGF2.jpg",
    duration: "4:37",
    relative: "2 weeks ago",
    visibility: "private",
    ownerName: "Logan Affleck",
    ownerInitials: "LA",
    viewCount: 4,
  },
  {
    title: "Demo for the design team",
    thumbnail: "/clips/1J2KR4ryo2Wg.jpg",
    duration: "6:20",
    relative: "3 weeks ago",
    visibility: "public",
    ownerName: "Priya Shah",
    ownerInitials: "PS",
    viewCount: 91,
  },
];

function LibraryPrivacyIcon({
  visibility,
}: {
  visibility: (typeof LIBRARY_RECORDINGS)[number]["visibility"];
}) {
  if (visibility === "public") return <IconWorld size={14} />;
  if (visibility === "org") return <IconUsersGroup size={14} />;
  return <IconLock size={14} />;
}

function LibraryBackdrop() {
  return (
    <div className="library-window">
      <div className="library-topbar">
        <div className="library-brand">
          <span className="library-brand-mark" aria-hidden />
          <span className="library-brand-name">Clips</span>
        </div>
        <h1 className="library-heading">Library</h1>
        <div className="library-search" aria-hidden>
          <IconSearch size={15} />
          <span>Search recordings</span>
        </div>
      </div>
      <div className="library-grid">
        {LIBRARY_RECORDINGS.map((recording) => (
          <div className="library-card" key={recording.title}>
            <div className="library-card-thumb">
              <img src={recording.thumbnail} alt="" />
              <div className="library-card-thumb-overlay">
                <IconPlayerPlay size={28} />
              </div>
              <span className="library-card-duration">
                {recording.duration}
              </span>
            </div>
            <div className="library-card-title">{recording.title}</div>
            <div className="library-card-owner-row">
              <span className="library-card-avatar">{recording.ownerInitials}</span>
              <span className="library-card-owner-name">{recording.ownerName}</span>
              <span aria-hidden>•</span>
              <span>{recording.relative}</span>
            </div>
            <div className="library-card-meta">
              <LibraryPrivacyIcon visibility={recording.visibility} />
              <span className="library-card-visibility">{recording.visibility}</span>
              <span aria-hidden>•</span>
              <span>{recording.viewCount} views</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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

const LIBRARY_BACKDROP_CSS = [
  ".library-desktop { position: fixed; inset: 0; background: radial-gradient(circle at 30% 20%, #3f3f46, #18181b 70%); padding: 3.5vh 4vw; box-sizing: border-box; }",
  ".library-window { height: 100%; width: 100%; border-radius: 14px; overflow: hidden; background: #f7f7f8; color: #18181b; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.06) inset; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; }",
  ".library-topbar { display: flex; align-items: center; gap: 24px; padding: 18px 32px; border-bottom: 1px solid #e4e4e7; background: #ffffff; flex-shrink: 0; }",
  ".library-brand { display: flex; align-items: center; gap: 8px; }",
  ".library-brand-mark { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, #6366f1, #a855f7); }",
  ".library-brand-name { font-weight: 600; font-size: 14px; color: #52525b; }",
  ".library-heading { margin: 0; font-size: 18px; font-weight: 600; color: #18181b; }",
  ".library-search { margin-left: auto; display: flex; align-items: center; gap: 8px; width: 260px; padding: 8px 12px; border-radius: 8px; border: 1px solid #e4e4e7; background: #f4f4f5; color: #a1a1aa; font-size: 13px; }",
  ".library-grid { flex: 1; overflow: hidden; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; padding: 28px 32px; align-content: start; }",
  ".library-card-thumb { position: relative; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; border: 1px solid #e4e4e7; background: #e4e4e7; }",
  ".library-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }",
  ".library-card-thumb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.15); color: #ffffff; }",
  ".library-card-duration { position: absolute; bottom: 6px; right: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.65); color: #ffffff; font-size: 11px; font-variant-numeric: tabular-nums; }",
  ".library-card-title { margin-top: 10px; font-size: 13px; font-weight: 500; color: #18181b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  ".library-card-owner-row { margin-top: 5px; display: flex; align-items: center; gap: 6px; color: #71717a; font-size: 11px; }",
  ".library-card-avatar { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 999px; background: #eef2ff; color: #6366f1; font-size: 8px; font-weight: 700; flex-shrink: 0; }",
  ".library-card-owner-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".library-card-meta { margin-top: 3px; display: flex; align-items: center; gap: 6px; color: #a1a1aa; font-size: 11px; }",
  ".library-card-visibility { text-transform: capitalize; }",
].join("\n");

export default function ClipsReadyToRecordPreview() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
      }}
    >
      <style>{LIBRARY_BACKDROP_CSS}</style>
      <div className="library-desktop">
        <LibraryBackdrop />
      </div>
      <div
        className="app app-recorder"
        style={{
          width: 340,
          position: "fixed",
          top: "7vh",
          right: "10%",
          boxShadow: "var(--shadow-md)",
        }}
      >
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
