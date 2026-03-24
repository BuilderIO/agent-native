import { useState, useEffect } from "react";
import { trackEvent } from "../components/TemplateCard";

const DL = "https://github.com/BuilderIO/agent-native/releases/latest/download";

type Platform = "mac" | "windows" | "linux";

interface PlatformInfo {
  name: string;
  icon: React.ReactNode;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
  note: string;
}

const PLATFORMS: Record<Platform, PlatformInfo> = {
  mac: {
    name: "macOS",
    icon: <AppleIcon />,
    primary: {
      label: "Download for Mac",
      href: `${DL}/Agent%20Native.dmg`,
    },
    note: "Universal binary — works on Apple Silicon and Intel.",
  },
  windows: {
    name: "Windows",
    icon: <WindowsIcon />,
    primary: {
      label: "Download for Windows",
      href: `${DL}/Agent%20Native-x64.exe`,
    },
    secondary: {
      label: "ARM64",
      href: `${DL}/Agent%20Native-arm64.exe`,
    },
    note: "Windows 10 or later.",
  },
  linux: {
    name: "Linux",
    icon: <LinuxIcon />,
    primary: {
      label: "Download AppImage",
      href: `${DL}/Agent%20Native-x64.AppImage`,
    },
    secondary: {
      label: "Download .deb",
      href: `${DL}/Agent%20Native-x64.deb`,
    },
    note: "x64 — ARM64 also available on GitHub.",
  },
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "mac";
}

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>("mac");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const info = PLATFORMS[platform];

  function handleDownload(label: string) {
    trackEvent("desktop_download", { platform, label });
  }

  return (
    <main className="mx-auto max-w-[960px] px-6 py-20">
      <div className="mb-16 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Download Agent Native
        </h1>
        <p className="mx-auto max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
          All your agent-native apps in one desktop shell. Production apps
          built-in, with a dev mode toggle for local development.
        </p>
      </div>

      {/* Platform tabs */}
      <div className="mb-10 flex justify-center gap-2">
        {(Object.keys(PLATFORMS) as Platform[]).map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium ${
              platform === p
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--fg-secondary)]"
            }`}
          >
            {PLATFORMS[p].icon}
            {PLATFORMS[p].name}
          </button>
        ))}
      </div>

      {/* Download card */}
      <div className="mx-auto max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-10 text-center">
        <div className="mb-6 flex justify-center text-[var(--fg)]">
          {info.icon}
        </div>

        <h2 className="mb-6 text-xl font-semibold">
          Agent Native for {info.name}
        </h2>

        <a
          href={info.primary.href}
          onClick={() => handleDownload(info.primary.label)}
          className="mb-3 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-8 py-3 text-base font-medium text-white no-underline hover:opacity-90 hover:no-underline"
        >
          <DownloadIcon />
          {info.primary.label}
        </a>

        {info.secondary && (
          <div className="mt-3">
            <a
              href={info.secondary.href}
              onClick={() => handleDownload(info.secondary!.label)}
              className="text-sm text-[var(--accent)] no-underline hover:underline"
            >
              {info.secondary.label}
            </a>
          </div>
        )}

        <p className="mt-6 text-xs text-[var(--fg-secondary)]">{info.note}</p>
      </div>

      {/* What's included */}
      <div className="mt-16">
        <h3 className="mb-6 text-center text-lg font-semibold">
          What's included
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureItem
            title="Built-in apps"
            description="Mail, Calendar, Content, Analytics, Slides, Videos, and Forms — all ready to use."
          />
          <FeatureItem
            title="Auto-updates"
            description="New versions download in the background and install on restart."
          />
          <FeatureItem
            title="Dev mode"
            description="Toggle any app to connect to your local dev server for development."
          />
        </div>
      </div>

      {/* Mobile teaser */}
      <div className="mt-16 mx-auto max-w-lg rounded-lg border border-dashed border-[var(--border)] px-6 py-5 text-center">
        <p className="text-sm text-[var(--fg-secondary)]">
          <span className="mr-1.5">📱</span>A mobile app for iOS and Android is
          in the works.
        </p>
      </div>

      {/* All releases link */}
      <div className="mt-12 text-center">
        <a
          href="https://github.com/BuilderIO/agent-native/releases"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          <GitHubIcon />
          View all releases on GitHub
        </a>
      </div>
    </main>
  );
}

function FeatureItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-5">
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
        {description}
      </p>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5l-8-1.25V12.5zM11.5 12V5.35l9.5-1.6V12H11.5zm0 .5H21v7.75l-9.5-1.6V12.5z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.022 1.903 1.395.199.093.387.229.564.395.228.193.43.395.692.467.263.074.563.014.762-.196.18-.196.36-.395.54-.64.18-.245.4-.395.46-.601a.957.957 0 0 0 .03-.332c-.01-.2-.07-.465-.18-.73-.236-.596-.357-.927-.357-1.395 0-.2.043-.395.137-.6.094-.195.229-.465.2-.728-.024-.2-.08-.4-.24-.597-.36-.444-.793-.593-1.2-.593-.44 0-.897.2-1.253.465a6.916 6.916 0 0 1-1.048.533c-.08-.066-.16-.135-.24-.2l-.26-.2c.48-.68 1.2-1.466 1.12-3.006-.04-.53-.16-1.07-.4-1.594-.24-.53-.6-1.004-1.08-1.47-1.04-1.004-2.08-1.673-2.32-3.34-.08-.465-.04-.94.24-1.6.28-.66.774-1.07.774-1.87 0-.8-.594-1.46-1.31-1.72-.334-.134-.694-.2-1.064-.2zm.07.94c.294 0 .586.06.856.18.54.2.93.54.93 1.04 0 .6-.394.87-.728 1.6-.334.73-.394 1.33-.294 1.93.264 1.866 1.405 2.533 2.445 3.533.44.42.727.87.927 1.33.2.466.32.937.354 1.397.06 1.266-.6 1.93-1.04 2.596-.24-.2-.48-.4-.84-.665-.36-.268-.72-.2-1.08-.135-.36.07-.64.2-.96.267-.32.07-.56.003-.84-.197a3.02 3.02 0 0 1-.262-.227c.04-.065.08-.135.12-.2.16-.24.27-.4.34-.665.08-.2.06-.465-.08-.665a.93.93 0 0 0-.26-.265c-.08-.06-.2-.133-.32-.2l-.04-.02a5.32 5.32 0 0 1-.4-.265c-.2-.134-.28-.2-.34-.334-.06-.132-.06-.2-.06-.465 0-.2-.04-.465-.08-.6a1.9 1.9 0 0 0-.14-.4c-.1-.2-.24-.465-.4-.597l-.06-.06c-.24-.2-.4-.334-.48-.597-.08-.2-.12-.467-.12-.734 0-.665.24-1.397.56-2.13.32-.73.734-1.33 1.28-2.063.56-.734.88-1.33.96-2.33.04-.534.08-.87.24-1.2.16-.334.4-.534.66-.737.24-.2.48-.334.72-.534.44-.395.64-.93.64-1.465 0-.4-.14-.798-.4-1.2.2-.065.42-.065.614-.065z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
