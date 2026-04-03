import { useState, useEffect } from "react";
import { trackEvent } from "../components/TemplateCard";
import { IconBrandGithub, IconDownload } from "@tabler/icons-react";

const DL = "https://github.com/BuilderIO/agent-native/releases/latest/download";

function AppleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.504 0c-.155 0-.313.015-.467.046-3.574.722-3.573 5.263-3.573 5.263l-.004.005s-.354 3.637.953 5.523c.089.148.222.349.383.588-.107.085-.213.17-.318.26C8.27 12.618 4.209 13.604 3.012 16.409c-.006.015-.343.89-.164 2.345.356 2.9 3.058 4.97 5.136 5.243l.086.001c.48 0 1.075-.206 1.478-.393.42-.195.788-.43 1.103-.618.437-.26.698-.413.911-.413.147 0 .378.093.716.408.33.308.614.722.913 1.156.425.617.906 1.316 1.606 1.753.421.263.91.409 1.405.409.548 0 1.08-.195 1.402-.408.7-.437 1.181-1.136 1.606-1.753.3-.434.583-.848.913-1.156.338-.315.57-.408.716-.408.213 0 .474.153.911.413.315.188.684.423 1.103.618.403.188.998.393 1.478.393l.086-.001c2.078-.272 4.78-2.343 5.136-5.243.18-1.455-.158-2.33-.164-2.345-1.197-2.805-5.258-3.79-6.466-4.724a7.095 7.095 0 0 1-.318-.26c.161-.24.294-.44.383-.588 1.307-1.886.957-5.523.953-5.523l-.004-.005s.001-4.541-3.573-5.263A3.372 3.372 0 0 0 12.504 0zm.002 1.647c.592 0 1.196.582 1.196 1.985 0 1.403-.904 2.597-.904 2.597s-.145.152-.295.152c-.149 0-.291-.152-.291-.152s-.908-1.194-.908-2.597c0-1.403.61-1.985 1.202-1.985zM9.628 7.736c.614 0 1.111.385 1.111.86 0 .474-.497.86-1.111.86-.613 0-1.11-.386-1.11-.86 0-.475.497-.86 1.11-.86zm5.752 0c.614 0 1.111.385 1.111.86 0 .474-.497.86-1.111.86-.613 0-1.11-.386-1.11-.86 0-.475.497-.86 1.11-.86zm-4.108 1.678a.15.15 0 0 1 .09.024c.272.156.598.252.947.252h.003c.348 0 .674-.096.946-.252a.152.152 0 0 1 .2.055.149.149 0 0 1-.056.198 2.085 2.085 0 0 1-.743.35c-.007.056-.028.318-.028.318s.415.07.593.3a.15.15 0 0 1-.03.21.152.152 0 0 1-.212-.03c-.103-.133-.396-.186-.396-.186s-.007.26-.091.3c0 0-.167.084-.312-.3-.145.384-.312.3-.312.3-.084-.04-.09-.3-.09-.3s-.294.053-.397.186a.152.152 0 0 1-.213.03.15.15 0 0 1-.03-.21c.179-.23.594-.3.594-.3s-.021-.262-.028-.319a2.085 2.085 0 0 1-.743-.349.149.149 0 0 1-.055-.198.147.147 0 0 1 .11-.079zm-3.78 4.393c.474 0 1.09.204 1.792.654.831.533 1.253 1.202 1.253 1.988 0 .442-.15.93-.543 1.327-.38.383-.929.622-1.66.665h-.068c-.655 0-1.127-.258-1.41-.482a2.255 2.255 0 0 1-.566-.666 2.154 2.154 0 0 1-.274-.9 2.16 2.16 0 0 1 .138-1.012c.196-.532.62-1.074 1.057-1.362a1.5 1.5 0 0 1 .28-.212zm9.024 0c.098.047.192.12.28.153.464.303.89.84 1.088 1.377a2.16 2.16 0 0 1 .14 1.012 2.155 2.155 0 0 1-.275.9 2.255 2.255 0 0 1-.566.666c-.283.224-.755.482-1.41.482h-.068c-.731-.043-1.28-.282-1.66-.665-.394-.396-.543-.885-.543-1.327 0-.786.422-1.455 1.253-1.988.703-.45 1.318-.654 1.792-.654l-.03.044zm-8.748 1.256a.69.69 0 0 0-.09.01c-.232.054-.555.228-.81.529-.27.319-.408.697-.408.924 0 .066.016.094.016.096.015.02.07.056.185.056a.975.975 0 0 0 .337-.08c.347-.138.657-.395.815-.638.134-.206.15-.356.124-.442a.213.213 0 0 0-.169-.167v.001a.575.575 0 0 0 0 .29zm8.473 0a.576.576 0 0 0 0-.29v-.001a.213.213 0 0 0-.169.167c-.026.086-.01.236.124.442.158.243.468.5.815.637a.975.975 0 0 0 .337.081c.115 0 .17-.036.185-.056 0-.002.016-.03.016-.096 0-.227-.139-.605-.408-.924-.255-.301-.578-.475-.81-.53a.686.686 0 0 0-.09-.009z" />
    </svg>
  );
}

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
      href: `${DL}/Agent-Native.dmg`,
    },
    note: "Universal binary — works on Apple Silicon and Intel.",
  },
  windows: {
    name: "Windows",
    icon: <WindowsIcon />,
    primary: {
      label: "Download for Windows",
      href: `${DL}/Agent-Native-x64.exe`,
    },
    secondary: {
      label: "ARM64",
      href: `${DL}/Agent-Native-arm64.exe`,
    },
    note: "Windows 10 or later.",
  },
  linux: {
    name: "Linux",
    icon: <LinuxIcon />,
    primary: {
      label: "Download AppImage",
      href: `${DL}/Agent-Native-x86_64.AppImage`,
    },
    secondary: {
      label: "Download .deb",
      href: `${DL}/Agent-Native-amd64.deb`,
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
      <div className="mb-14 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Download Agent Native
        </h1>
        <p className="mx-auto max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
          All your agent-native apps in one desktop shell. Production apps
          built-in, with a dev mode toggle for local development.
        </p>
      </div>

      {/* Platform selector */}
      <div className="mb-2 flex justify-center gap-2">
        {(Object.keys(PLATFORMS) as Platform[]).map((p) => {
          const plt = PLATFORMS[p];
          const active = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              aria-label={plt.name}
              title={plt.name}
              className={`group flex items-center justify-center rounded-lg border p-4 transition-colors ${
                active
                  ? "border-[var(--fg-secondary)] bg-[var(--bg-secondary)] text-[var(--fg)]"
                  : "border-transparent text-[var(--fg-secondary)] opacity-50 hover:opacity-75"
              }`}
            >
              {plt.icon}
            </button>
          );
        })}
      </div>

      {/* Download section */}
      <div className="mx-auto mt-8 max-w-2xl text-center">
        <a
          href={info.primary.href}
          onClick={() => handleDownload(info.primary.label)}
          className="inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] no-underline hover:opacity-85 hover:no-underline"
        >
          <IconDownload size={18} />
          {info.primary.label}
        </a>

        {info.secondary && (
          <div className="mt-3">
            <a
              href={info.secondary.href}
              onClick={() => handleDownload(info.secondary!.label)}
              className="text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)] hover:underline"
            >
              {info.secondary.label}
            </a>
          </div>
        )}

        <p className="mt-4 text-xs text-[var(--fg-secondary)]">{info.note}</p>
      </div>

      {/* What's included */}
      <div className="mt-20">
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
          <IconBrandGithub size={16} />
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
