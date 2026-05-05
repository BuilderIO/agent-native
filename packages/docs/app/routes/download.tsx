import { useEffect, useMemo, useState } from "react";
import { appBasePath } from "@agent-native/core/client";
import { trackEvent } from "../components/TemplateCard";
import {
  IconBrandApple,
  IconBrandGithub,
  IconBrandWindows,
  IconDownload,
  IconTerminal2,
} from "@tabler/icons-react";

const LATEST_JSON_URL = `${appBasePath()}/api/desktop-latest.json`;
const RELEASES =
  "https://github.com/BuilderIO/agent-native/releases?q=Agent-Native";

type Platform = "mac" | "windows" | "linux";
type DesktopAssetKind =
  | "mac-arm64"
  | "mac-x64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-appimage-x64"
  | "linux-appimage-arm64"
  | "linux-deb-x64"
  | "linux-deb-arm64";

interface DownloadOption {
  label: string;
  assetKinds: readonly DesktopAssetKind[];
}

interface PlatformInfo {
  name: string;
  icon: typeof IconBrandApple;
  primary: DownloadOption;
  secondary?: DownloadOption;
  note: string;
}

const PLATFORMS: Record<Platform, PlatformInfo> = {
  mac: {
    name: "macOS",
    icon: IconBrandApple,
    primary: {
      label: "Download for Apple Silicon",
      assetKinds: ["mac-arm64"],
    },
    secondary: {
      label: "Intel Mac",
      assetKinds: ["mac-x64"],
    },
    note: "Signed and notarized macOS installers are available from the latest desktop release.",
  },
  windows: {
    name: "Windows",
    icon: IconBrandWindows,
    primary: {
      label: "Download for Windows",
      assetKinds: ["windows-x64"],
    },
    secondary: {
      label: "ARM64",
      assetKinds: ["windows-arm64"],
    },
    note: "Windows 10 or later.",
  },
  linux: {
    name: "Linux",
    icon: IconTerminal2,
    primary: {
      label: "Download AppImage",
      assetKinds: ["linux-appimage-x64", "linux-appimage-arm64"],
    },
    secondary: {
      label: "Download .deb",
      assetKinds: ["linux-deb-x64", "linux-deb-arm64"],
    },
    note: "x64 and ARM64 builds are published when available.",
  },
};

interface Manifest {
  version: string;
  tag: string;
  pub_date: string | null;
  assets: {
    name: string;
    url: string;
    size: number;
    kind: string;
  }[];
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "mac";
}

function pickAsset(manifest: Manifest | null, option: DownloadOption) {
  if (!manifest) return null;
  for (const kind of option.assetKinds) {
    const asset = manifest.assets.find((a) => a.kind === kind);
    if (asset) return asset;
  }
  return null;
}

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>("mac");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(LATEST_JSON_URL)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("failed")),
      )
      .then((json) => {
        if (!cancelled) setManifest(json as Manifest);
      })
      .catch(() => {
        if (!cancelled) setManifestError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const info = PLATFORMS[platform];
  const primaryAsset = useMemo(
    () => pickAsset(manifest, info.primary),
    [manifest, info.primary],
  );
  const secondaryAsset = useMemo(
    () => (info.secondary ? pickAsset(manifest, info.secondary) : null),
    [manifest, info.secondary],
  );
  const releaseStatus = manifest
    ? `Latest desktop release: ${manifest.version}`
    : manifestError
      ? "Could not load the latest desktop release. The releases page has all installers."
      : "Checking the latest desktop release...";

  function handleDownload(label: string) {
    trackEvent("desktop download", { platform, label });
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
          const Icon = plt.icon;
          const active = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              aria-label={plt.name}
              className={`group flex items-center justify-center rounded-lg p-4 ${
                active
                  ? "text-[var(--fg)]"
                  : "text-[var(--fg-secondary)] opacity-40 hover:opacity-65"
              }`}
            >
              <Icon size={24} />
              <span className="sr-only">{plt.name}</span>
            </button>
          );
        })}
      </div>

      {/* Download section */}
      <div className="mx-auto mt-8 max-w-2xl text-center">
        {primaryAsset || manifestError ? (
          <a
            href={primaryAsset?.url ?? RELEASES}
            onClick={() => handleDownload(info.primary.label)}
            className="inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] no-underline hover:opacity-85 hover:no-underline"
          >
            <IconDownload size={18} />
            {info.primary.label}
          </a>
        ) : (
          <button
            disabled
            className="inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] opacity-60"
          >
            <IconDownload size={18} />
            Loading latest release...
          </button>
        )}

        {info.secondary && (
          <div className="mt-3">
            <a
              href={secondaryAsset?.url ?? RELEASES}
              onClick={() => handleDownload(info.secondary!.label)}
              className="text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)] hover:underline"
            >
              {info.secondary.label}
            </a>
          </div>
        )}

        <p className="mt-4 text-xs text-[var(--fg-secondary)]">
          {releaseStatus}
          <span className="block mt-1">{info.note}</span>
        </p>
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
      <div className="mt-16 mx-auto max-w-lg rounded-lg border border-dashed border-[var(--docs-border)] px-6 py-5 text-center">
        <p className="text-sm text-[var(--fg-secondary)]">
          A mobile app for iOS and Android is in the works.
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
    <div className="rounded-lg border border-[var(--docs-border)] p-5">
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
        {description}
      </p>
    </div>
  );
}
