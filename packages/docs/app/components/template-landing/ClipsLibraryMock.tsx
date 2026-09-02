/**
 * Static, decorative recreation of the Clips web Library with the desktop tray
 * popover floating over it, used as landing-page hero art.
 *
 * The real popover is a Tauri window excluded from screen capture (see
 * `set_capture_excluded` in templates/clips/desktop/src-tauri/src/lib.rs), so
 * it cannot be screenshotted from the OS at all — hence a recreation rather
 * than an image.
 *
 * All CSS lives here, scoped under `.clips-mock`, and the popover's custom
 * properties are pinned to the dark palette. The real stylesheet
 * (templates/clips/desktop/src/styles.css) is deliberately NOT imported: it
 * declares `:root { font-size: 13px }` plus `html`/`body` background and color
 * rules that would reskin the whole docs site.
 */
import {
  IconAppWindow,
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
  IconSearch,
  IconSettings,
  IconShare,
  IconTrash,
  IconUpload,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";

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
    thumbnail: "/clips/build-your-own.jpg",
    duration: "1:58",
    relative: "2 days ago",
    visibility: "public",
    ownerName: "Nadia Okonkwo",
    ownerInitials: "NO",
    viewCount: 214,
  },
  {
    title: "Show Claude how to perform a task",
    thumbnail: "/clips/webcam-bubble.jpg",
    duration: "3:12",
    relative: "5 days ago",
    visibility: "org",
    ownerName: "Theo Lindqvist",
    ownerInitials: "TL",
    viewCount: 58,
  },
  {
    title: "Record browser workflows with Clips",
    thumbnail: "/clips/growth-plan.jpg",
    duration: "2:41",
    relative: "1 week ago",
    visibility: "private",
    ownerName: "Ines Duarte",
    ownerInitials: "ID",
    viewCount: 12,
  },
  {
    title: "Weekly sync walkthrough",
    thumbnail: "/clips/data-sources.jpg",
    duration: "8:05",
    relative: "1 week ago",
    visibility: "org",
    ownerName: "Priya Shah",
    ownerInitials: "PS",
    viewCount: 34,
  },
  {
    title: "Onboarding checklist review",
    thumbnail: "/clips/meeting-report.jpg",
    duration: "4:37",
    relative: "2 weeks ago",
    visibility: "private",
    ownerName: "June Park",
    ownerInitials: "JP",
    viewCount: 4,
  },
  {
    title: "Demo for the design team",
    thumbnail: "/clips/slide-four.jpg",
    duration: "6:20",
    relative: "3 weeks ago",
    visibility: "public",
    ownerName: "Priya Shah",
    ownerInitials: "PS",
    viewCount: 91,
  },
  {
    title: "Bug repro: upload retry stalls",
    thumbnail: "/clips/U1f0uKYYKGF2.jpg",
    duration: "1:24",
    relative: "3 weeks ago",
    visibility: "org",
    ownerName: "Marcus Webb",
    ownerInitials: "MW",
    viewCount: 27,
  },
  {
    title: "Walkthrough of the new share dialog",
    thumbnail: "/clips/1J2KR4ryo2Wg.jpg",
    duration: "5:09",
    relative: "1 month ago",
    visibility: "public",
    ownerName: "Rafael Mendes",
    ownerInitials: "RM",
    viewCount: 143,
  },
  {
    title: "Kickoff notes for Q3 planning",
    thumbnail: "/clips/B0AgxdvzuZ7H.jpg",
    duration: "12:48",
    relative: "1 month ago",
    visibility: "private",
    ownerName: "Priya Shah",
    ownerInitials: "PS",
    viewCount: 8,
  },
];

const SIDEBAR_NAV_ITEMS = [
  { label: "Library", icon: IconInbox, count: 11, active: true },
  { label: "Shared with me", icon: IconShare, count: 68 },
  { label: "Spaces", icon: IconUsersGroup },
  { label: "Meetings", icon: IconCalendar },
  { label: "Dictate", icon: IconMicrophone2 },
  { label: "Archive", icon: IconArchive },
  { label: "Trash", icon: IconTrash },
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

      <div className="library-new-recording">New recording</div>
      <div className="library-import">
        <IconUpload size={14} />
        <span>Import</span>
        <IconChevronDown size={13} className="library-import-chev" />
      </div>

      <div className="library-nav">
        {SIDEBAR_NAV_ITEMS.map(({ label, icon: Icon, count, active }) => (
          <div
            key={label}
            className={
              active ? "library-nav-item is-active" : "library-nav-item"
            }
          >
            <Icon size={15} />
            <span className="library-nav-label">{label}</span>
            {count != null && (
              <span className="library-nav-count">{count}</span>
            )}
          </div>
        ))}
      </div>

      <div className="library-sidebar-section">
        <div className="library-sidebar-section-header">
          <span>Folders</span>
          <IconFolderPlus size={13} />
        </div>
        <div className="library-sidebar-empty">No folders yet</div>
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

function LibraryWindow() {
  return (
    <div className="library-window">
      <div className="library-window-topbar">
        <span />
        <span />
        <span />
      </div>
      <div className="library-window-body">
        <LibrarySidebar />
        <div className="library-main">
          <div className="library-topbar">
            <div className="library-heading">Library</div>
            <div className="library-topbar-actions">
              <div className="library-search">
                <IconSearch size={14} />
                <span>Search recordings…</span>
              </div>
              <div className="library-icon-btn">
                <IconArrowsSort size={16} />
              </div>
              <div className="library-icon-btn">
                <IconMessage2 size={16} />
              </div>
            </div>
          </div>
          <div className="library-grid">
            {LIBRARY_RECORDINGS.map((recording) => (
              <div className="library-card" key={recording.title}>
                <div className="library-card-thumb">
                  <img src={recording.thumbnail} alt="" loading="lazy" />
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
                  <span>•</span>
                  <span>{recording.relative}</span>
                </div>
                <div className="library-card-meta">
                  <LibraryPrivacyIcon visibility={recording.visibility} />
                  <span className="library-card-visibility">
                    {recording.visibility}
                  </span>
                  <span>•</span>
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

function TrayLibraryIcon() {
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

function TraySettingsIcon() {
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
        fill="var(--bg)"
      />
      <circle
        cx="8"
        cy="17"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg)"
      />
    </svg>
  );
}

function TrayPopover() {
  return (
    <div className="clips-mock-popover app app-recorder">
      <div className="recorder-home-content">
        <div className="header header-centered">
          <div className="mode-toggle">
            <span>
              <ScreenIcon />
            </span>
            <span className="active">
              <ScreenCamIcon />
            </span>
            <span>
              <CamIcon />
            </span>
          </div>
          <div className="icon-button header-close">
            <CloseIcon />
          </div>
        </div>

        <div className="panel">
          <div className="row row-on">
            <span className="row-icon">
              <MonitorIcon />
            </span>
            <div className="row-button">
              <span className="row-label">Full screen</span>
              <span className="row-flex" />
              <span className="row-chev">
                <ChevronDown />
              </span>
            </div>
          </div>

          <div className="media-device-row">
            <div className="media-device-picker">
              <div className="row row-off">
                <span className="row-icon">
                  <CameraIcon />
                </span>
                <div className="row-button">
                  <span className="row-label">Default camera</span>
                  <span className="row-flex" />
                </div>
                <span className="row-chev">
                  <ChevronDown />
                </span>
                <span className="toggle toggle-off">Off</span>
              </div>
            </div>
          </div>

          <div className="media-device-row">
            <div className="media-device-picker">
              <div className="row row-on">
                <span className="row-icon">
                  <MicIcon />
                </span>
                <div className="row-button">
                  <span className="row-label">Default mic</span>
                  <span className="row-flex" />
                </div>
                <span className="row-menu-trigger">
                  <ChevronDown />
                </span>
                <span className="toggle toggle-on">On</span>
              </div>
            </div>
          </div>
        </div>

        <div className="recorder-disclosures">
          <div className="readiness">
            <div className="readiness-summary">
              <span className="readiness-title">Permissions</span>
              <span className="readiness-action">Review</span>
            </div>
          </div>
        </div>

        <div className="primary start">Start recording</div>
      </div>

      <div className="bottom-row">
        <div className="bottom-btn">
          <span className="bottom-icon">
            <TrayLibraryIcon />
          </span>
          <span className="bottom-label">Library</span>
        </div>
        <div className="bottom-btn">
          <span className="bottom-icon">
            <CalendarIcon />
          </span>
          <span className="bottom-label">Meetings</span>
        </div>
        <div className="bottom-btn">
          <span className="bottom-icon">
            <DictateIcon />
          </span>
          <span className="bottom-label">Dictate</span>
        </div>
        <div className="bottom-btn">
          <span className="bottom-icon">
            <TraySettingsIcon />
          </span>
          <span className="bottom-label">Settings</span>
        </div>
      </div>
    </div>
  );
}

const CLIPS_MOCK_CSS = [
  // Shell
  // Horizontal padding keeps the window off the container edges; overflow stays
  // visible so the tray popover can hang above the window's top edge.
  // The negative margin pulls the window up into the header block, and the top
  // padding reserves room for the popover to hang above the window's top edge
  // while the box itself stays clipped.
  ".clips-mock { position: relative; width: 100%; margin-top: -160px; padding: 182px 40px 28px; overflow: hidden; }",
  ".clips-mock, .clips-mock * { box-sizing: border-box; }",
  ".clips-mock-frame { position: relative; height: 100%; }",
  // Palette. Dark by default; the light block further down swaps the whole mock
  // over when the docs shell is in light mode.
  ".clips-mock { --lib-window-bg: #151515; --lib-chrome-bg: #101010; --lib-chrome-border: #232323; --lib-dot: #4d4d4d; --lib-border: #333333; --lib-fg: #e6e6e6; --lib-fg-dim: #b3b3b3; --lib-fg-muted: #999999; --lib-fg-subtle: #808080; --lib-fg-faint: #6b6b6b; --lib-btn-bg: #262626; --lib-btn-border: #383838; --lib-btn-fg: #cccccc; --lib-btn-hover-bg: #303030; --lib-btn-hover-border: #454545; --lib-hover-bg: rgba(255, 255, 255, 0.06); --lib-active-bg: rgba(191, 191, 191, 0.12); --lib-active-fg: #f2f2f2; --lib-input-bg: #191919; --lib-input-border: #2e2e2e; --lib-input-hover-border: #4d4d4d; --lib-card-bg: #1c1c1c; --lib-card-border: #2b2b2b; --lib-card-hover-border: #5a5a5a; --lib-thumb-bg: #202020; --lib-avatar-bg: #3a3a3a; --lib-avatar-fg: #bfbfbf; }",
  // The popover is a fixed 340x408 panel. Shrink it on narrow screens, where
  // the mock is shorter, rather than let the "Start recording" CTA clip out.
  // The desktop overlap values are far too aggressive for a narrow column.
  "@media (max-width: 860px) { .clips-mock { margin-top: -36px; padding: 54px 16px 18px; } .clips-mock .clips-mock-popover { top: -49px; right: -1px; transform: scale(0.72); transform-origin: top right; } }",

  // Faux app window
  ".clips-mock .library-window { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: var(--lib-window-bg); color: var(--lib-fg); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
  ".clips-mock .library-window-topbar { flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: var(--lib-chrome-bg); border-bottom: 1px solid var(--lib-chrome-border); }",
  ".clips-mock .library-window-topbar span { width: 11px; height: 11px; border-radius: 999px; background: var(--lib-dot); }",
  ".clips-mock .library-window-body { flex: 1; min-height: 0; display: flex; }",

  // Sidebar
  ".clips-mock .library-sidebar { width: 216px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 14px 12px; background: var(--lib-chrome-bg); border-right: 1px solid var(--lib-chrome-border); }",
  ".clips-mock .library-brand { display: flex; align-items: center; gap: 8px; padding: 4px 4px 12px; }",
  ".clips-mock .library-brand-mark { height: 14px; width: 24px; flex-shrink: 0; color: var(--lib-fg); }",
  ".clips-mock .library-brand-name { font-weight: 600; font-size: 13px; color: var(--lib-fg); }",
  ".clips-mock .library-new-recording { margin-bottom: 6px; padding: 7px 0; border-radius: 6px; background: var(--lib-btn-bg); border: 1px solid var(--lib-btn-border); color: var(--lib-btn-fg); font-size: 12.5px; font-weight: 600; text-align: center; }",
  ".clips-mock .library-import { margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; border-radius: 6px; border: 1px solid var(--lib-border); color: var(--lib-btn-fg); font-size: 12.5px; }",
  ".clips-mock .library-import-chev { margin-left: 2px; opacity: 0.7; }",
  ".clips-mock .library-nav { display: flex; flex-direction: column; gap: 1px; }",
  ".clips-mock .library-nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; font-size: 12.5px; color: var(--lib-fg-dim); }",
  ".clips-mock .library-nav-item.is-active { background: var(--lib-active-bg); color: var(--lib-active-fg); font-weight: 500; }",
  ".clips-mock .library-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".clips-mock .library-nav-count { color: var(--lib-fg-subtle); font-size: 11px; }",
  ".clips-mock .library-sidebar-section { margin-top: 14px; }",
  ".clips-mock .library-sidebar-section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; color: var(--lib-fg-subtle); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }",
  ".clips-mock .library-sidebar-empty { padding: 6px 8px 0; color: var(--lib-fg-faint); font-size: 12px; }",
  ".clips-mock .library-sidebar-spacer { flex: 1; }",
  ".clips-mock .library-sidebar-bottom { display: flex; flex-direction: column; gap: 1px; border-top: 1px solid var(--lib-chrome-border); padding-top: 8px; }",

  // Main column
  ".clips-mock .library-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }",
  ".clips-mock .library-topbar { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--lib-border); }",
  ".clips-mock .library-heading { font-size: 15px; font-weight: 600; color: var(--lib-fg); }",
  ".clips-mock .library-topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }",
  ".clips-mock .library-search { display: flex; align-items: center; gap: 6px; width: 220px; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--lib-input-border); background: var(--lib-input-bg); color: var(--lib-fg-subtle); font-size: 12px; }",
  ".clips-mock .library-icon-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 6px; color: var(--lib-fg-muted); }",

  // Card grid
  ".clips-mock .library-grid { flex: 1; min-height: 0; overflow: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); grid-auto-rows: max-content; gap: 16px; padding: 20px; align-content: start; }",
  ".clips-mock .library-card { border-radius: 8px; overflow: hidden; background: var(--lib-card-bg); border: 1px solid var(--lib-card-border); }",
  ".clips-mock .library-card-thumb { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: var(--lib-thumb-bg); }",
  ".clips-mock .library-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }",
  ".clips-mock .library-card-thumb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.15); color: #ffffff; }",
  ".clips-mock .library-card-duration { position: absolute; bottom: 6px; right: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.8); color: #ffffff; font-size: 11px; font-variant-numeric: tabular-nums; }",
  ".clips-mock .library-card-title { margin: 10px 12px 0; font-size: 13.5px; font-weight: 500; color: var(--lib-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  ".clips-mock .library-card-owner-row { margin: 5px 12px 0; display: flex; align-items: center; gap: 6px; color: var(--lib-fg-muted); font-size: 11px; }",
  ".clips-mock .library-card-avatar { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 999px; background: var(--lib-avatar-bg); color: var(--lib-avatar-fg); font-size: 8px; font-weight: 700; flex-shrink: 0; }",
  ".clips-mock .library-card-owner-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".clips-mock .library-card-meta { margin: 3px 12px 12px; display: flex; align-items: center; gap: 6px; color: var(--lib-fg-muted); font-size: 11px; }",
  ".clips-mock .library-card-visibility { text-transform: capitalize; }",

  // Tray popover — values mirror templates/clips/desktop/src/styles.css, with
  // the dark palette pinned so the art does not follow the visitor's theme.
  ".clips-mock .clips-mock-popover { --brand: #f5f5f5; --brand-hover: #e5e5e5; --brand-ring: rgba(245, 245, 245, 0.28); --bg: #212121; --surface: #262626; --surface-hover: #2e2e2e; --surface-strong: #3d3d3d; --fg: #f5f5f5; --fg-muted: #a3a3a3; --fg-subtle: #737373; --border: #3d3d3d; --border-strong: #4d4d4d; --radius: 12px; --radius-sm: 8px; --radius-pill: 999px; --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4); --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3); position: absolute; top: -83px; right: 52px; width: 340px; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.4; color: var(--fg); box-shadow: 0 32px 64px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.3); }",
  ".clips-mock .app { margin: 0; padding: 14px; display: flex; flex-direction: column; gap: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 14px; }",
  ".clips-mock .app-recorder { gap: 0; padding: 0; overflow: hidden; }",
  ".clips-mock .clips-mock-popover.app { border-color: #4a4a4a; box-shadow: 0 28px 64px rgba(0, 0, 0, 0.62), 0 6px 18px rgba(0, 0, 0, 0.45); }",
  ".clips-mock .app-recorder > .bottom-row { flex: 0 0 auto; padding: 7px 14px 10px; border-top: 1px solid var(--border); background: var(--bg); }",
  ".clips-mock .recorder-home-content { min-height: 0; padding: 14px; display: flex; flex: 1 1 auto; flex-direction: column; gap: 14px; }",
  ".clips-mock .header.header-centered { position: relative; display: flex; justify-content: center; align-items: center; min-height: 28px; }",
  ".clips-mock .header.header-centered .header-close { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }",
  ".clips-mock .icon-button { width: 28px; height: 28px; border-radius: 8px; background: transparent; color: var(--fg-muted); display: inline-flex; align-items: center; justify-content: center; }",
  ".clips-mock .mode-toggle { display: inline-flex; background: var(--surface); border-radius: var(--radius-pill); padding: 3px; border: 1px solid var(--border); }",
  ".clips-mock .mode-toggle > span { display: inline-flex; align-items: center; justify-content: center; width: 34px; min-width: 34px; height: 28px; background: transparent; color: var(--fg-muted); border-radius: var(--radius-pill); }",
  ".clips-mock .mode-toggle > span.active { background: var(--bg); color: var(--brand); box-shadow: var(--shadow-sm); }",
  ".clips-mock .panel { display: flex; flex-direction: column; gap: 8px; }",
  ".clips-mock .row { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }",
  ".clips-mock .row-off { opacity: 0.6; }",
  ".clips-mock .row-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--fg-muted); flex-shrink: 0; }",
  ".clips-mock .row-on .row-icon { color: var(--fg); }",
  ".clips-mock .row-button { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: transparent; color: var(--fg); font-size: 13px; font-weight: 500; text-align: left; }",
  ".clips-mock .row-label { flex: 0 0 auto; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".clips-mock .row-flex { flex: 1 1 auto; }",
  ".clips-mock .row-chev { display: inline-flex; color: var(--fg-muted); flex-shrink: 0; }",
  ".clips-mock .media-device-picker { position: relative; }",
  ".clips-mock .row-menu-trigger { display: inline-flex; align-items: center; color: var(--fg-muted); }",
  ".clips-mock .toggle { border-radius: var(--radius-pill); padding: 4px 12px; font-size: 12px; font-weight: 600; line-height: 1; height: 22px; display: inline-flex; align-items: center; }",
  ".clips-mock .toggle-on { background: #16a34a; color: #ffffff; }",
  ".clips-mock .toggle-off { background: var(--surface-strong); color: var(--fg-muted); }",
  ".clips-mock .recorder-disclosures { display: flex; flex-direction: column; gap: 0; }",
  ".clips-mock .readiness { border-radius: 0; background: transparent; overflow: hidden; flex-shrink: 0; }",
  ".clips-mock .readiness-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 36px; background: transparent; border-radius: var(--radius-sm); color: var(--fg-muted); padding: 7px 12px; text-align: left; }",
  ".clips-mock .readiness-title { color: inherit; font-size: 13px; font-weight: 500; line-height: 1; }",
  ".clips-mock .readiness-action { display: flex; align-items: center; gap: 3px; color: inherit; font-size: 11px; font-weight: 600; line-height: 1; }",
  ".clips-mock .primary { width: 100%; border-radius: var(--radius); padding: 12px 16px; background: var(--surface-strong); border: 1px solid var(--border-strong); color: var(--fg-muted); font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 44px; }",
  ".clips-mock .primary.start { margin-top: 2px; }",
  ".clips-mock .bottom-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }",
  ".clips-mock .bottom-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; background: transparent; border-radius: var(--radius-sm); color: var(--fg-muted); }",
  ".clips-mock .bottom-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; color: var(--fg-muted); }",
  ".clips-mock .bottom-label { font-size: 11px; font-weight: 500; }",

  // Hover behavior, mirroring the real stylesheet's transitions. The mock is
  // decorative, so these exist purely to make it feel like live UI.
  ".clips-mock .icon-button, .clips-mock .mode-toggle > span, .clips-mock .toggle, .clips-mock .bottom-btn, .clips-mock .bottom-icon, .clips-mock .primary, .clips-mock .row, .clips-mock .library-nav-item, .clips-mock .library-icon-btn, .clips-mock .library-search, .clips-mock .library-new-recording, .clips-mock .library-import { transition: background 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 80ms; }",
  ".clips-mock .icon-button:hover { background: var(--surface-hover); color: var(--fg); }",
  ".clips-mock .mode-toggle > span:hover { color: var(--fg); }",
  ".clips-mock .row:hover { background: var(--surface-hover); border-color: var(--border-strong); }",
  ".clips-mock .toggle-on:hover { background: #15803d; }",
  ".clips-mock .toggle-off:hover { color: var(--fg); }",
  ".clips-mock .primary:hover { background: #474747; color: var(--fg); }",
  ".clips-mock .primary:active { transform: translateY(1px); }",
  ".clips-mock .bottom-btn:hover { background: var(--surface-hover); color: var(--fg); }",
  ".clips-mock .bottom-btn:hover .bottom-icon { color: var(--fg); }",
  ".clips-mock .readiness-summary:hover { color: var(--fg); }",

  // Library hover behavior, mirroring templates/clips/app RecordingCard.
  ".clips-mock .library-card { transition: border-color 140ms, box-shadow 140ms, transform 140ms; }",
  ".clips-mock .library-card:hover { border-color: var(--lib-card-hover-border); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); transform: translateY(-2px); }",
  ".clips-mock .library-card-thumb img { transition: transform 240ms, filter 240ms; }",
  ".clips-mock .library-card:hover .library-card-thumb img { transform: scale(1.03); }",
  ".clips-mock .library-card-thumb-overlay { transition: background 160ms; }",
  ".clips-mock .library-card:hover .library-card-thumb-overlay { background: rgba(0, 0, 0, 0.32); }",
  ".clips-mock .library-nav-item:hover { background: var(--lib-hover-bg); color: var(--lib-active-fg); }",
  ".clips-mock .library-icon-btn:hover { background: var(--lib-hover-bg); color: var(--lib-fg); }",
  ".clips-mock .library-search:hover { border-color: var(--lib-input-hover-border); }",
  ".clips-mock .library-new-recording:hover { background: var(--lib-btn-hover-bg); border-color: var(--lib-btn-hover-border); color: var(--lib-fg); }",
  ".clips-mock .library-import:hover { background: var(--lib-hover-bg); color: var(--lib-fg); }",

  // Light mode. The docs shell puts `light`/`dark` on <html>, so the mock
  // follows the visitor's theme instead of staying pinned to the dark art.
  "html.light .clips-mock { --lib-window-bg: #f1f0ea; --lib-chrome-bg: #eae8e1; --lib-chrome-border: #dedbd2; --lib-dot: #c8c5bb; --lib-border: #dedbd2; --lib-fg: #22201c; --lib-fg-dim: #56534d; --lib-fg-muted: #6f6b64; --lib-fg-subtle: #827e76; --lib-fg-faint: #969288; --lib-btn-bg: #fdfdfb; --lib-btn-border: #d7d3ca; --lib-btn-fg: #3f3c36; --lib-btn-hover-bg: #f8f7f3; --lib-btn-hover-border: #c0bcb2; --lib-hover-bg: rgba(50, 48, 38, 0.05); --lib-active-bg: rgba(50, 48, 38, 0.09); --lib-active-fg: #1d1b17; --lib-input-bg: #fdfdfb; --lib-input-border: #dcd8cf; --lib-input-hover-border: #c0bcb2; --lib-card-bg: #fdfdfb; --lib-card-border: #e3e0d8; --lib-card-hover-border: #c4c0b6; --lib-thumb-bg: #ebe9e3; --lib-avatar-bg: #e4e1d9; --lib-avatar-fg: #5d5a52; }",
  "html.light .clips-mock .library-card:hover { box-shadow: 0 8px 20px rgba(50, 48, 38, 0.14); }",
  "html.light .clips-mock .clips-mock-popover { --brand: #22201c; --brand-hover: #131210; --brand-ring: rgba(34, 32, 28, 0.2); --bg: #fefefc; --surface: #f5f4ef; --surface-hover: #efede7; --surface-strong: #e8e6de; --fg: #22201c; --fg-muted: #6a6760; --fg-subtle: #8b887f; --border: #e2dfd7; --border-strong: #d1cdc4; --shadow-sm: 0 1px 2px rgba(50, 48, 38, 0.09); --shadow-md: 0 8px 24px rgba(50, 48, 38, 0.14), 0 2px 6px rgba(50, 48, 38, 0.07); }",
  "html.light .clips-mock .clips-mock-popover.app { border-color: #dedbd2; box-shadow: 0 28px 64px rgba(50, 48, 38, 0.22), 0 6px 18px rgba(50, 48, 38, 0.12); }",
  "html.light .clips-mock .primary { color: #3f3c36; }",
  "html.light .clips-mock .primary:hover { background: #dedbd3; color: var(--fg); }",
].join("\n");

export function ClipsLibraryMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`clips-mock ${className}`} role="img" aria-label={label}>
      <style>{CLIPS_MOCK_CSS}</style>
      <div className="clips-mock-frame" aria-hidden="true">
        <LibraryWindow />
        <TrayPopover />
      </div>
    </div>
  );
}
