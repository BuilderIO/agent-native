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
  IconArchive,
  IconArrowsSort,
  IconCalendar,
  IconChevronDown,
  IconFolderPlus,
  IconInbox,
  IconLock,
  IconMessage2,
  IconMicrophone2,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShare,
  IconTrash,
  IconAppWindow,
  IconUpload,
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
  if (visibility === "public") return <IconWorld size={13} />;
  if (visibility === "org") return <IconUsersGroup size={13} />;
  return <IconLock size={13} />;
}

const SIDEBAR_NAV_ITEMS = [
  { label: "Library", icon: IconInbox, count: 11, active: true },
  { label: "Shared with me", icon: IconShare, count: 68 },
  { label: "Spaces", icon: IconUsersGroup },
  { label: "Meetings", icon: IconCalendar },
  { label: "Dictate", icon: IconMicrophone2 },
  { label: "Archive", icon: IconArchive },
  { label: "Trash", icon: IconTrash },
];

function LibrarySidebar() {
  return (
    <aside className="library-sidebar">
      <div className="library-brand">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 114 66"
          fill="none"
          className="library-brand-mark"
          aria-hidden
        >
          <path
            d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z"
            fill="currentColor"
          />
          <path
            d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z"
            fill="currentColor"
          />
        </svg>
        <span className="library-brand-name">Clips</span>
      </div>

      <button type="button" className="library-new-recording">
        New recording
      </button>
      <button type="button" className="library-import">
        <IconUpload size={14} />
        <span>Import</span>
        <IconChevronDown size={13} className="library-import-chev" />
      </button>

      <nav className="library-nav">
        {SIDEBAR_NAV_ITEMS.map(({ label, icon: Icon, count, active }) => (
          <div
            key={label}
            className={active ? "library-nav-item is-active" : "library-nav-item"}
          >
            <Icon size={15} />
            <span className="library-nav-label">{label}</span>
            {count != null && <span className="library-nav-count">{count}</span>}
          </div>
        ))}
      </nav>

      <div className="library-sidebar-section">
        <div className="library-sidebar-section-header">
          <span>Folders</span>
          <IconFolderPlus size={13} />
        </div>
        <div className="library-sidebar-empty">No folders yet</div>
      </div>

      <div className="library-sidebar-section">
        <div className="library-sidebar-section-header">
          <span>Spaces</span>
          <IconPlus size={13} />
        </div>
        <div className="library-sidebar-empty">No spaces yet</div>
      </div>

      <div className="library-sidebar-spacer" />

      <div className="library-sidebar-bottom">
        <div className="library-nav-item">
          <IconSettings size={15} />
          <span className="library-nav-label">Settings</span>
        </div>
        <div className="library-nav-item">
          <IconAppWindow size={15} />
          <span className="library-nav-label">Open desktop app</span>
        </div>
      </div>
    </aside>
  );
}

function LibraryBackdrop() {
  return (
    <div className="library-window">
      <div className="library-window-topbar" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="library-window-body">
      <LibrarySidebar />
      <div className="library-main">
        <div className="library-topbar">
          <h1 className="library-heading">Library</h1>
          <div className="library-topbar-actions">
            <div className="library-search" aria-hidden>
              <IconSearch size={14} />
              <span>Search recordings…</span>
            </div>
            <button type="button" className="library-icon-btn" aria-label="Sort">
              <IconArrowsSort size={16} />
            </button>
            <button type="button" className="library-icon-btn" aria-label="Agent">
              <IconMessage2 size={16} />
            </button>
          </div>
        </div>
        <div className="library-grid">
          {LIBRARY_RECORDINGS.map((recording) => (
            <div className="library-card" key={recording.title}>
              <div className="library-card-thumb">
                <img src={recording.thumbnail} alt="" />
                <div className="library-card-thumb-overlay">
                  <IconPlayerPlay size={26} />
                </div>
                <span className="library-card-duration">
                  {recording.duration}
                </span>
              </div>
              <div className="library-card-title">{recording.title}</div>
              <div className="library-card-owner-row">
                <span className="library-card-avatar">
                  {recording.ownerInitials}
                </span>
                <span className="library-card-owner-name">
                  {recording.ownerName}
                </span>
                <span aria-hidden>•</span>
                <span>{recording.relative}</span>
              </div>
              <div className="library-card-meta">
                <LibraryPrivacyIcon visibility={recording.visibility} />
                <span className="library-card-visibility">
                  {recording.visibility}
                </span>
                <span aria-hidden>•</span>
                <span>{recording.viewCount} views</span>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  ".library-window { position: fixed; inset: 0; margin: auto; max-width: 1200px; max-height: 700px; display: flex; flex-direction: column; overflow: hidden; border-radius: 10px; background: #212121; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-shadow: 0 0 0 1px #2c2c2c; }",
  ".library-window-topbar { flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: #181818; border-bottom: 1px solid #2c2c2c; }",
  ".library-window-topbar span { width: 11px; height: 11px; border-radius: 999px; background: #4d4d4d; }",
  ".library-window-body { flex: 1; min-height: 0; display: flex; }",

  ".library-sidebar { width: 216px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 14px 12px; background: #181818; border-right: 1px solid #2c2c2c; box-sizing: border-box; }",
  ".library-brand { display: flex; align-items: center; gap: 8px; padding: 4px 4px 12px; }",
  ".library-brand-mark { height: 14px; width: 24px; flex-shrink: 0; color: #e6e6e6; }",
  ".library-brand-name { font-weight: 600; font-size: 13px; color: #e6e6e6; }",
  ".library-new-recording { margin: 0 0 6px; padding: 7px 0; border-radius: 6px; border: none; background: #f2f2f2; color: #171717; font-size: 12.5px; font-weight: 600; cursor: default; }",
  ".library-import { margin: 0 0 12px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; border-radius: 6px; border: 1px solid #333333; background: transparent; color: #cccccc; font-size: 12.5px; cursor: default; }",
  ".library-import-chev { margin-left: 2px; opacity: 0.7; }",
  ".library-nav { display: flex; flex-direction: column; gap: 1px; }",
  ".library-nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; font-size: 12.5px; color: #b3b3b3; }",
  ".library-nav-item.is-active { background: rgba(191, 191, 191, 0.12); color: #f2f2f2; font-weight: 500; }",
  ".library-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".library-nav-count { color: #808080; font-size: 11px; }",
  ".library-sidebar-section { margin-top: 14px; }",
  ".library-sidebar-section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; color: #7a7a7a; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }",
  ".library-sidebar-empty { padding: 6px 8px 0; color: #6b6b6b; font-size: 12px; }",
  ".library-sidebar-spacer { flex: 1; }",
  ".library-sidebar-bottom { display: flex; flex-direction: column; gap: 1px; border-top: 1px solid #2c2c2c; padding-top: 8px; }",

  ".library-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }",
  ".library-topbar { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #333333; }",
  ".library-heading { margin: 0; font-size: 15px; font-weight: 600; color: #e6e6e6; }",
  ".library-topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }",
  ".library-search { display: flex; align-items: center; gap: 6px; width: 220px; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid #3d3d3d; background: #212121; color: #808080; font-size: 12px; box-sizing: border-box; }",
  ".library-icon-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 6px; border: none; background: transparent; color: #999999; }",

  ".library-grid { flex: 1; overflow: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 20px; align-content: start; }",
  ".library-card { border-radius: 8px; overflow: hidden; background: #262626; border: 1px solid #383838; }",
  ".library-card-thumb { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: #292929; }",
  ".library-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }",
  ".library-card-thumb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.15); color: #ffffff; }",
  ".library-card-duration { position: absolute; bottom: 6px; right: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.8); color: #ffffff; font-size: 11px; font-variant-numeric: tabular-nums; }",
  ".library-card-title { margin: 10px 12px 0; font-size: 13.5px; font-weight: 500; color: #e6e6e6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  ".library-card-owner-row { margin: 5px 12px 0; display: flex; align-items: center; gap: 6px; color: #999999; font-size: 11px; }",
  ".library-card-avatar { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 999px; background: #3a3a3a; color: #bfbfbf; font-size: 8px; font-weight: 700; flex-shrink: 0; }",
  ".library-card-owner-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".library-card-meta { margin: 3px 12px 12px; display: flex; align-items: center; gap: 6px; color: #999999; font-size: 11px; }",
  ".library-card-visibility { text-transform: capitalize; }",
].join("\n");

export default function ClipsReadyToRecordPreview() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "#0c0c0c",
      }}
    >
      <style>{LIBRARY_BACKDROP_CSS}</style>
      <LibraryBackdrop />
      <div
        className="app app-recorder"
        style={{
          width: 340,
          position: "fixed",
          top: 53,
          left: 1000,
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
