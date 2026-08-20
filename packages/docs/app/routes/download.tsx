import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAppWindow,
  IconBrandApple,
  IconBrandWindows,
  IconDownload,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { trackEvent } from "../components/TemplateCard";

const LATEST_JSON_URL = `${appBasePath()}/api/desktop-latest.json`;
const OPEN_DESKTOP_URL = "agentnative://open";
const MANIFEST_STORAGE_KEY = "agent-native-desktop-download-manifest-v2";

type Platform = "mac" | "windows" | "linux";
type DesktopReleaseChannel = "production" | "nightly";
type DesktopAssetKind =
  | "mac-arm64"
  | "mac-x64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-tar-x64"
  | "linux-tar-arm64"
  | "linux-appimage-x64"
  | "linux-appimage-arm64"
  | "linux-deb-x64"
  | "linux-deb-arm64";

interface DownloadOption {
  labelKey: string;
  assetKinds: readonly DesktopAssetKind[];
}

interface PlatformInfo {
  name: string;
  icon: typeof IconBrandApple;
  primary: DownloadOption;
  alternatives?: readonly DownloadOption[];
  note?: string;
}

const PLATFORMS: Record<Platform, PlatformInfo> = {
  mac: {
    name: "macOS",
    icon: IconBrandApple,
    primary: {
      labelKey: "downloadPage.platforms.mac.primary",
      assetKinds: ["mac-arm64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.mac.alternative",
        assetKinds: ["mac-x64"],
      },
    ],
  },
  windows: {
    name: "Windows",
    icon: IconBrandWindows,
    primary: {
      labelKey: "downloadPage.platforms.windows.primary",
      assetKinds: ["windows-x64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.windows.alternative",
        assetKinds: ["windows-arm64"],
      },
    ],
    note: "downloadPage.platforms.windows.note",
  },
  linux: {
    name: "Linux",
    icon: IconTerminal2,
    primary: {
      labelKey: "downloadPage.platforms.linux.primary",
      assetKinds: ["linux-tar-x64", "linux-tar-arm64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.linux.appImage",
        assetKinds: ["linux-appimage-x64", "linux-appimage-arm64"],
      },
      {
        labelKey: "downloadPage.platforms.linux.deb",
        assetKinds: ["linux-deb-x64", "linux-deb-arm64"],
      },
    ],
    note: "downloadPage.platforms.linux.note",
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

function isManifestAsset(value: unknown): value is Manifest["assets"][number] {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<Manifest["assets"][number]>;
  return (
    typeof asset.name === "string" &&
    typeof asset.url === "string" &&
    typeof asset.size === "number" &&
    typeof asset.kind === "string"
  );
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<Manifest>;
  return (
    typeof manifest.version === "string" &&
    typeof manifest.tag === "string" &&
    (typeof manifest.pub_date === "string" || manifest.pub_date === null) &&
    Array.isArray(manifest.assets) &&
    manifest.assets.every(isManifestAsset)
  );
}

function manifestStorageKey(channel: DesktopReleaseChannel): string {
  return `${MANIFEST_STORAGE_KEY}-${channel}`;
}

function readCachedManifest(channel: DesktopReleaseChannel): Manifest | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = window.localStorage.getItem(manifestStorageKey(channel));
    if (!cached) return null;
    const parsed: unknown = JSON.parse(cached);
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedManifest(
  channel: DesktopReleaseChannel,
  manifest: Manifest,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      manifestStorageKey(channel),
      JSON.stringify(manifest),
    );
  } catch {
    // Storage can be unavailable in private browsing or locked-down contexts.
  }
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
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("mac");
  const [channel, setChannel] = useState<DesktopReleaseChannel>("production");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [manifestRequest, setManifestRequest] = useState(0);
  const [isDesktopApp, setIsDesktopApp] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsDesktopApp(/AgentNativeDesktop/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedManifest = readCachedManifest(channel);
    setManifest(cachedManifest);
    setManifestError(false);
    const manifestUrl =
      channel === "nightly"
        ? `${LATEST_JSON_URL}?channel=nightly`
        : LATEST_JSON_URL;

    fetch(manifestUrl)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("failed")),
      )
      .then((json) => {
        if (!isManifest(json)) throw new Error("invalid manifest");
        if (!cancelled) {
          setManifest(json);
          setManifestError(false);
          writeCachedManifest(channel, json);
        }
      })
      .catch(() => {
        if (!cancelled && !cachedManifest) setManifestError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, manifestRequest]);

  const isNightly = channel === "nightly";
  const info = PLATFORMS[platform];
  const downloads = useMemo(() => {
    const options = [info.primary, ...(info.alternatives ?? [])];
    return options.map((option) => ({
      option,
      asset: pickAsset(manifest, option),
    }));
  }, [manifest, info]);
  const primaryDownload =
    downloads.find((download) => download.asset) ?? downloads[0];
  const primaryAsset = primaryDownload?.asset ?? null;
  const alternativeDownloads = downloads.filter(
    (download) =>
      download.option !== primaryDownload?.option && Boolean(download.asset),
  );
  const releaseStatus = manifestError
    ? t("downloadPage.loadError")
    : !manifest
      ? t("downloadPage.checkingRelease")
      : null;
  const primaryLabel = primaryAsset
    ? t(primaryDownload?.option.labelKey ?? info.primary.labelKey)
    : manifestError
      ? t("downloadPage.retry")
      : !manifest
        ? t("downloadPage.checkingRelease")
        : t("downloadPage.unavailable");
  const desktopDownloadLabel = primaryAsset
    ? t("downloadPage.downloadInstaller")
    : primaryLabel;
  const isManifestLoading = !manifest && !manifestError;

  function handleChannelChange(nextChannel: DesktopReleaseChannel) {
    if (nextChannel === channel) return;
    setManifest(null);
    setManifestError(false);
    setChannel(nextChannel);
  }

  function handleRetry() {
    setManifest(null);
    setManifestError(false);
    setManifestRequest((request) => request + 1);
  }

  function handleDownload(label: string) {
    trackEvent("desktop download", { channel, platform, label });
  }

  function handleOpenDesktop() {
    trackEvent("desktop open", { platform });
  }

  return (
    <main className="mx-auto max-w-[960px] px-6 py-20">
      <div className="mb-14 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          {t("downloadPage.title")}
          {isNightly && (
            <>
              {" "}
              <span className="text-blue-600 dark:text-blue-400">
                {t("downloadPage.nightly")}
              </span>
            </>
          )}
        </h1>
        <p className="mx-auto max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
          {t("downloadPage.body")}
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
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          {isDesktopApp && (
            <a
              href={OPEN_DESKTOP_URL}
              onClick={handleOpenDesktop}
              className="inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] no-underline hover:opacity-85 hover:no-underline"
            >
              <IconAppWindow size={18} />
              {t("downloadPage.openDesktop")}
            </a>
          )}

          {primaryAsset ? (
            <a
              href={primaryAsset.url}
              onClick={() =>
                handleDownload(
                  primaryDownload?.option.labelKey
                    ? t(primaryDownload.option.labelKey)
                    : t(info.primary.labelKey),
                )
              }
              className={
                isDesktopApp
                  ? "inline-flex items-center gap-2.5 rounded-lg border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline hover:bg-[var(--sidebar-hover)] hover:no-underline"
                  : "inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] no-underline hover:opacity-85 hover:no-underline"
              }
            >
              <IconDownload size={18} />
              {isDesktopApp ? desktopDownloadLabel : primaryLabel}
            </a>
          ) : (
            <button
              type="button"
              onClick={manifestError ? handleRetry : undefined}
              disabled={!manifestError}
              aria-busy={isManifestLoading}
              className={
                manifestError
                  ? isDesktopApp
                    ? "inline-flex items-center gap-2.5 rounded-lg border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover)]"
                    : "inline-flex items-center gap-2.5 rounded-lg bg-[var(--fg)] px-8 py-3.5 text-base font-medium text-[var(--bg)] hover:opacity-85"
                  : `inline-flex cursor-not-allowed items-center gap-2.5 rounded-lg px-8 py-3.5 text-base font-medium opacity-60 ${
                      isDesktopApp
                        ? "border border-[var(--docs-border)] text-[var(--fg)]"
                        : "bg-[var(--fg)] text-[var(--bg)]"
                    }`
              }
            >
              <IconDownload size={18} />
              {isDesktopApp ? desktopDownloadLabel : primaryLabel}
            </button>
          )}
        </div>

        {alternativeDownloads.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2">
            {alternativeDownloads.map(({ option, asset }) => (
              <a
                key={option.labelKey}
                href={asset!.url}
                onClick={() => handleDownload(t(option.labelKey))}
                className="text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)] hover:underline"
              >
                {t(option.labelKey)}
              </a>
            ))}
          </div>
        )}

        {releaseStatus && (
          <p className="mt-4 text-xs text-[var(--fg-secondary)]">
            {releaseStatus}
          </p>
        )}
        {info.note && (
          <p className="mt-4 text-xs text-[var(--fg-secondary)]">
            {t(info.note)}
          </p>
        )}
        <div className="mt-5 flex justify-center">
          <div className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
            <span>{t("downloadPage.stable")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isNightly}
              aria-label={t(
                isNightly
                  ? "downloadPage.switchToStable"
                  : "downloadPage.switchToNightly",
              )}
              onClick={() =>
                handleChannelChange(isNightly ? "production" : "nightly")
              }
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-[var(--docs-border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                isNightly ? "bg-blue-600" : "bg-[var(--sidebar-hover)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`block size-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  isNightly ? "translate-x-[18px]" : "translate-x-[2px]"
                }`}
              />
            </button>
            <span
              className={
                isNightly
                  ? "font-medium text-blue-600 dark:text-blue-400"
                  : "text-blue-600 dark:text-blue-400"
              }
            >
              {t("downloadPage.nightly")}
            </span>
          </div>
        </div>
      </div>

      {/* Run from source */}
      <div className="mt-16 mx-auto max-w-2xl">
        <div className="rounded-lg border border-[var(--docs-border)] px-6 py-5">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <IconTerminal2 size={16} />
            {t("downloadPage.runFromSource")}
          </h4>
          <p className="mb-3 text-xs text-[var(--fg-secondary)]">
            {t("downloadPage.runFromSourceBody")}
          </p>
          <pre className="overflow-x-auto rounded-md bg-[var(--docs-code-bg,rgba(0,0,0,0.04))] px-4 py-3 text-xs">
            <code>{`npx @agent-native/core@latest create my-platform
cd my-platform
pnpm install && pnpm dev`}</code>
          </pre>
        </div>
      </div>
    </main>
  );
}
