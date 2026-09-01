import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAppWindow,
  IconBrandApple,
  IconBrandWindows,
  IconCheck,
  IconCopy,
  IconDownload,
  IconTerminal2,
  type TablerIcon,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { trackEvent } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";
import { withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage([
    { title: "Download — Agent-Native" },
    {
      name: "description",
      content:
        "Download Agent-Native for macOS, Windows, or Linux. Try open source agentic apps for meetings, design, presentations, analytics, email, and more.",
    },
  ]);

const LATEST_JSON_URL = `${appBasePath()}/api/desktop-latest.json`;
const OPEN_DESKTOP_URL = "agentnative://open";
const MANIFEST_STORAGE_KEY = "agent-native-desktop-download-manifest-v2";
const CREATE_COMMAND = `npx @agent-native/core@latest create my-platform
cd my-platform
pnpm install && pnpm dev`;

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
  // Short label + file extension shown in the all-platforms grid row, distinct
  // from labelKey's full sentence (used by the hero CTA and the quick alt
  // link). The extension is a literal file-format token, not prose — it stays
  // unlocalized the same way "AppImage"/".deb" already do inside labelKey's
  // translated strings.
  gridLabelKey: string;
  ext: string;
  assetKinds: readonly DesktopAssetKind[];
}

interface PlatformInfo {
  name: string;
  icon: TablerIcon;
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
      gridLabelKey: "downloadPage.platforms.mac.gridPrimary",
      ext: "dmg",
      assetKinds: ["mac-arm64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.mac.alternative",
        gridLabelKey: "downloadPage.platforms.mac.gridAlternative",
        ext: "dmg",
        assetKinds: ["mac-x64"],
      },
    ],
  },
  windows: {
    name: "Windows",
    icon: IconBrandWindows,
    primary: {
      labelKey: "downloadPage.platforms.windows.primary",
      gridLabelKey: "downloadPage.platforms.windows.gridPrimary",
      ext: "exe",
      assetKinds: ["windows-x64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.windows.alternative",
        gridLabelKey: "downloadPage.platforms.windows.gridAlternative",
        ext: "exe",
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
      gridLabelKey: "downloadPage.platforms.linux.gridPrimary",
      ext: "tar.gz",
      assetKinds: ["linux-tar-x64", "linux-tar-arm64"],
    },
    alternatives: [
      {
        labelKey: "downloadPage.platforms.linux.appImage",
        gridLabelKey: "downloadPage.platforms.linux.gridAppImage",
        ext: "AppImage",
        assetKinds: ["linux-appimage-x64", "linux-appimage-arm64"],
      },
      {
        labelKey: "downloadPage.platforms.linux.deb",
        gridLabelKey: "downloadPage.platforms.linux.gridDeb",
        ext: "deb",
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

interface ConfirmedDownload {
  asset: Manifest["assets"][number];
  label: string;
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

// Two-option segmented control rather than the on/off switch this replaced:
// "Stable vs Nightly" is a choice between two named things, not a boolean.
function ChannelToggle({
  channel,
  onChange,
}: {
  channel: DesktopReleaseChannel;
  onChange: (next: DesktopReleaseChannel) => void;
}) {
  const t = useT();
  const options: { value: DesktopReleaseChannel; label: string }[] = [
    { value: "production", label: t("downloadPage.stable") },
    { value: "nightly", label: t("downloadPage.nightly") },
  ];

  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border-dim)] p-[3px]">
      {options.map(({ value, label }) => {
        const active = channel === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={[
              "cursor-pointer whitespace-nowrap rounded-[calc(var(--b-radius)-2px)] border-none px-[var(--spacing-4)] py-[var(--spacing-2)]",
              "font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold tracking-[0.02em] transition-colors duration-150",
              active
                ? "bg-[var(--b-text-primary)] text-[var(--b-bg-page)]"
                : "bg-transparent text-[var(--b-text-secondary)] hover:text-[var(--b-text-primary)]",
            ].join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Deliberately not the shared ds/code-block.tsx wrapper (that also nests the
// shiki-highlighted SharedCodeBlock inside its own padded card) — same border
// and background tokens as other code blocks, just applied directly to a
// plain command display instead of double-boxing it.
function CreateCommandBlock() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    void navigator.clipboard.writeText(CREATE_COMMAND);
    trackEvent("copy install command", { command: CREATE_COMMAND });
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t(copied ? "common.copied" : "common.copyCommand")}
        className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-[var(--b-radius)] text-[var(--b-text-secondary)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-[var(--b-text-primary)] focus-visible:opacity-100"
      >
        {copied ? (
          <IconCheck size={16} aria-hidden="true" />
        ) : (
          <IconCopy size={16} aria-hidden="true" />
        )}
      </button>
      <pre className="m-0 overflow-x-auto rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-inset)] py-4 pr-12 pl-4 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-paragraph-2)] leading-[1.9] text-[var(--b-text-secondary)]">
        {CREATE_COMMAND.split("\n").map((line) => (
          <div key={line}>
            <span aria-hidden="true" className="text-[var(--b-text-muted)]">
              ${" "}
            </span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

export default function DownloadPage() {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("mac");
  const [channel, setChannel] = useState<DesktopReleaseChannel>("production");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [manifestRequest, setManifestRequest] = useState(0);
  const [confirmedDownload, setConfirmedDownload] =
    useState<ConfirmedDownload | null>(null);
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
  const bestAlternative = alternativeDownloads[0] ?? null;
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
  const hasPrimaryDownloadStarted =
    confirmedDownload?.asset.url === primaryAsset?.url;
  const downloadButtonLabel = hasPrimaryDownloadStarted
    ? t("downloadPage.downloadStarted")
    : isDesktopApp
      ? desktopDownloadLabel
      : primaryLabel;
  const isManifestLoading = !manifest && !manifestError;

  // Every platform's builds, driven off the same channel manifest — the hero
  // above only ever shows the one platform detected from the user agent.
  const allPlatformDownloads = useMemo(() => {
    return (Object.keys(PLATFORMS) as Platform[]).map((key) => {
      const platformInfo = PLATFORMS[key];
      const options = [
        platformInfo.primary,
        ...(platformInfo.alternatives ?? []),
      ];
      return {
        key,
        info: platformInfo,
        rows: options.map((option) => ({
          option,
          asset: pickAsset(manifest, option),
        })),
      };
    });
  }, [manifest]);

  function handleChannelChange(nextChannel: DesktopReleaseChannel) {
    if (nextChannel === channel) return;
    setManifest(null);
    setManifestError(false);
    setConfirmedDownload(null);
    setChannel(nextChannel);
  }

  function handleRetry() {
    setManifest(null);
    setManifestError(false);
    setConfirmedDownload(null);
    setManifestRequest((request) => request + 1);
  }

  function handleDownload(asset: Manifest["assets"][number], label: string) {
    setConfirmedDownload({ asset, label });
    trackEvent("desktop download", { channel, platform, label });
  }

  function handleGridDownload(forPlatform: Platform, label: string) {
    trackEvent("desktop download", { channel, platform: forPlatform, label });
  }

  function handleOpenDesktop() {
    trackEvent("desktop open", { platform });
  }

  const primaryButtonContent = isManifestLoading ? (
    <span
      aria-hidden="true"
      className="h-4 w-32 animate-pulse rounded-full bg-current/20 motion-reduce:animate-none"
    />
  ) : hasPrimaryDownloadStarted ? (
    <>
      <IconCheck size={18} aria-hidden="true" />
      <span className="truncate">{downloadButtonLabel}</span>
    </>
  ) : (
    <>
      <IconDownload size={18} aria-hidden="true" />
      <span className="truncate">{downloadButtonLabel}</span>
    </>
  );

  return (
    <div className="builder-brand-tokens">
      <PageSection>
        <GridInner className="relative flex flex-col items-center gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-10)] pt-[var(--spacing-40)] pb-[var(--spacing-24)] text-center">
          <h1 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:leading-[1.2]">
            {t("downloadPage.title")}
            {isNightly && <> {t("downloadPage.nightly")}</>}
          </h1>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("downloadPage.body")}
          </p>

          <div className="mt-[var(--spacing-4)] flex flex-col items-center gap-[var(--spacing-3)]">
            <div className="flex flex-wrap items-center justify-center gap-[var(--spacing-3)]">
              {isDesktopApp && (
                <Button
                  variant="cta"
                  icon={null}
                  href={OPEN_DESKTOP_URL}
                  onClick={handleOpenDesktop}
                >
                  <IconAppWindow size={18} aria-hidden="true" />
                  {t("downloadPage.openDesktop")}
                </Button>
              )}

              {primaryAsset ? (
                <Button
                  variant={isDesktopApp ? "secondary" : "cta"}
                  icon={null}
                  href={primaryAsset.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    handleDownload(
                      primaryAsset,
                      primaryDownload?.option.labelKey
                        ? t(primaryDownload.option.labelKey)
                        : t(info.primary.labelKey),
                    )
                  }
                  className="w-full max-w-[18rem]"
                >
                  {primaryButtonContent}
                </Button>
              ) : (
                <Button
                  variant={isDesktopApp ? "secondary" : "cta"}
                  icon={null}
                  onClick={manifestError ? handleRetry : undefined}
                  disabled={!manifestError}
                  aria-label={primaryLabel}
                  aria-busy={isManifestLoading}
                  className="w-full max-w-[18rem]"
                >
                  {primaryButtonContent}
                </Button>
              )}
            </div>

            {confirmedDownload && (
              <p
                aria-live="polite"
                className="mt-1 text-xs text-[var(--b-text-secondary)]"
              >
                <span className="sr-only">
                  {t("downloadPage.downloadStarted")}
                </span>
                <a
                  href={confirmedDownload.asset.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    handleDownload(
                      confirmedDownload.asset,
                      confirmedDownload.label,
                    )
                  }
                  className="text-[var(--b-text-secondary)] underline underline-offset-2 hover:text-[var(--b-text-primary)]"
                >
                  {t("downloadPage.downloadAgain")}
                </a>
              </p>
            )}

            <div className="flex min-h-4 items-center gap-[var(--spacing-3)] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] text-[var(--b-text-secondary)]">
              {releaseStatus && <span>{releaseStatus}</span>}
              {releaseStatus && bestAlternative && (
                <span
                  aria-hidden="true"
                  className="h-[11px] w-px bg-[var(--b-border-default)]"
                />
              )}
              {bestAlternative && (
                <a
                  href={bestAlternative.asset!.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    handleDownload(
                      bestAlternative.asset!,
                      t(bestAlternative.option.labelKey),
                    )
                  }
                  className="font-[family-name:var(--b-font-sans)] text-[var(--b-text-secondary)] no-underline hover:text-[var(--b-text-primary)]"
                >
                  {t(bestAlternative.option.labelKey)}
                </a>
              )}
            </div>
            {info.note && (
              <p className="text-[length:var(--b-t-label-2)] text-[var(--b-text-secondary)]">
                {t(info.note)}
              </p>
            )}
          </div>
        </GridInner>
      </PageSection>

      {/* All platforms — home page three-column grid */}
      <PageSection>
        <GridInner className="flex flex-wrap items-center gap-[var(--spacing-4)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] py-[var(--spacing-5)]">
          <span className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold tracking-[0.02em] text-[var(--b-text-secondary)] uppercase">
            {t("downloadPage.allPlatforms")}
          </span>
          <div className="flex-1" />
          <ChannelToggle channel={channel} onChange={handleChannelChange} />
        </GridInner>

        <GridInner className="border-t border-solid border-[var(--b-border-default)]">
          <div className="grid grid-cols-3 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-solid [&>*:not(:last-child)]:border-[var(--b-border-subtle)] mobile:grid-cols-1 mobile:[&>*:not(:last-child)]:border-r-0 mobile:[&>*:not(:last-child)]:border-b mobile:[&>*:not(:last-child)]:border-solid mobile:[&>*:not(:last-child)]:border-[var(--b-border-subtle)]">
            {allPlatformDownloads.map(({ key, info: platformInfo, rows }) => {
              const Icon = platformInfo.icon;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-[var(--spacing-5)] p-[var(--spacing-8)]"
                >
                  <Icon
                    size={24}
                    stroke={1.5}
                    className="text-[var(--b-text-primary)]"
                  />
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium text-[var(--b-text-primary)]">
                    {platformInfo.name}
                  </h3>
                  <div className="-mx-[var(--spacing-3)] flex flex-col items-stretch gap-0.5">
                    {rows.map(({ option, asset }) => (
                      <a
                        key={option.labelKey}
                        href={asset?.url}
                        target={asset ? "_blank" : undefined}
                        rel={asset ? "noreferrer" : undefined}
                        aria-disabled={!asset}
                        onClick={
                          asset
                            ? () =>
                                handleGridDownload(key, t(option.gridLabelKey))
                            : undefined
                        }
                        className={[
                          "flex items-center gap-[var(--spacing-2)] rounded-[var(--b-radius)] px-[var(--spacing-3)] py-[var(--spacing-2)] no-underline transition-colors duration-150",
                          asset
                            ? "text-[var(--b-text-secondary)] hover:text-[var(--b-text-primary)]"
                            : "pointer-events-none text-[var(--b-text-muted)] opacity-50",
                        ].join(" ")}
                      >
                        <span className="font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)]">
                          {t(option.gridLabelKey)}
                        </span>
                        <span className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] text-[var(--b-text-muted)]">
                          {option.ext}
                        </span>
                      </a>
                    ))}
                  </div>
                  {platformInfo.note && (
                    <p className="m-0 mt-auto text-[length:var(--b-t-label-2)] text-[var(--b-text-secondary)]">
                      {t(platformInfo.note)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </GridInner>
      </PageSection>

      {/* Build your own */}
      <PageSection>
        <GridInner className="grid grid-cols-3 gap-[var(--spacing-10)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] py-[var(--spacing-20)] mobile:grid-cols-1 mobile:gap-[var(--spacing-6)]">
          <div className="flex flex-col gap-[var(--spacing-3)]">
            <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
              {t("downloadPage.runFromSource")}
            </h2>
            <p className="m-0 max-w-[300px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.5] text-[var(--b-text-secondary)]">
              {t("downloadPage.runFromSourceBody")}
            </p>
          </div>
          <div className="col-span-2 mobile:col-span-1">
            <CreateCommandBlock />
          </div>
        </GridInner>
      </PageSection>
    </div>
  );
}
