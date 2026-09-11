import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { docsUrl } from "@agent-native/core/shared";
import {
  IconBrandChrome,
  IconBrandApple,
  IconBrandWindows,
  IconCheck,
  IconDownload,
  IconHelpCircle,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import enMessages from "@/i18n/en-US";
import {
  clipsChromeExtensionUrl,
  markDesktopAppDownloaded,
  useClipsChromeExtensionEnabled,
} from "@/lib/capture-install-options";
import {
  getDefaultDownloadChannel,
  type DownloadReleaseChannel,
} from "@/lib/download-release-channel";

export function meta() {
  return [
    { title: enMessages.downloadRoute.pageTitle },
    {
      name: "description",
      content: enMessages.downloadRoute.description,
    },
  ];
}

type PlatformId = "mac" | "windows" | "linux";

interface PlatformVariant {
  id: PlatformId;
  label: string;
  assetKinds: readonly (
    | "mac-universal"
    | "mac-arm64"
    | "mac-x64"
    | "windows-msi"
    | "linux-appimage"
    | "linux-deb"
    | "linux-rpm"
  )[];
  icon: typeof IconBrandApple;
}

const LATEST_JSON_URL = `${appBasePath()}/api/clips-latest.json`;
const MANIFEST_STORAGE_KEY = "clips-download-manifest-v1";
const CHROME_EXTENSION_DOCS_URL = docsUrl("template-clips-capture-everywhere", {
  hash: "browser-logs-with-the-chrome-extension",
});

const VARIANTS: PlatformVariant[] = [
  {
    id: "mac",
    label: "macOS",
    assetKinds: ["mac-universal", "mac-arm64", "mac-x64"],
    icon: IconBrandApple,
  },
  {
    id: "windows",
    label: "Windows",
    assetKinds: ["windows-msi"],
    icon: IconBrandWindows,
  },
  {
    id: "linux",
    label: "Linux",
    assetKinds: ["linux-appimage", "linux-deb", "linux-rpm"],
    icon: IconTerminal2,
  },
];

interface Manifest {
  version: string;
  tag: string;
  pub_date: string | null;
  notes?: string;
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

function manifestStorageKey(channel: DownloadReleaseChannel): string {
  return `${MANIFEST_STORAGE_KEY}-${channel}`;
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<Manifest>;
  return (
    typeof manifest.version === "string" &&
    typeof manifest.tag === "string" &&
    (typeof manifest.pub_date === "string" || manifest.pub_date === null) &&
    Array.isArray(manifest.assets) &&
    manifest.assets.every((asset) => {
      if (!asset || typeof asset !== "object") return false;
      const candidate = asset as Partial<Manifest["assets"][number]>;
      return (
        typeof candidate.name === "string" &&
        typeof candidate.url === "string" &&
        typeof candidate.size === "number" &&
        typeof candidate.kind === "string"
      );
    })
  );
}

function readCachedManifest(channel: DownloadReleaseChannel): Manifest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(manifestStorageKey(channel));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isManifest(parsed) ? parsed : null;
    // coercion-ok: an unreadable browser cache is absent; the network fetch remains authoritative.
  } catch {
    return null;
  }
}

function writeCachedManifest(
  channel: DownloadReleaseChannel,
  manifest: Manifest,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      manifestStorageKey(channel),
      JSON.stringify(manifest),
    );
    // coercion-ok: browser storage is optional and must not block the download action.
  } catch {
    // Storage can be unavailable in private browsing or locked-down contexts.
  }
}

function detectPlatform(): PlatformId | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

function pickAsset(
  manifest: Manifest | null,
  variant: PlatformVariant,
): Manifest["assets"][number] | null {
  if (!manifest) return null;
  for (const kind of variant.assetKinds) {
    const asset = manifest.assets.find((a) => a.kind === kind);
    if (asset) return asset;
  }
  return null;
}

function primaryDownloadButton(
  variant: PlatformVariant,
  manifest: Manifest | null,
  manifestError: boolean,
  downloadLabel: string,
  retryLabel: string,
  onRetry: () => void,
  downloadStarted: boolean,
  downloadStartedLabel: string,
  onDownload: (asset: Manifest["assets"][number]) => void,
) {
  const asset = pickAsset(manifest, variant);
  const Icon = variant.icon;
  if (asset) {
    return (
      <Button
        asChild
        size="lg"
        className="h-10 min-w-[252px] gap-2 bg-foreground px-6 text-sm text-background hover:bg-foreground/90"
      >
        <a href={asset.url} download onClick={() => onDownload(asset)}>
          {downloadStarted ? (
            <IconCheck className="h-5 w-5" />
          ) : (
            <IconDownload className="h-5 w-5" />
          )}
          {downloadStarted ? downloadStartedLabel : downloadLabel}
        </a>
      </Button>
    );
  }
  if (manifest === null && !manifestError) {
    return <Skeleton className="h-12 w-[252px] rounded-md" />;
  }
  if (manifestError) {
    return (
      <Button
        size="lg"
        variant="outline"
        className="h-12 min-w-[252px] gap-2 px-6 text-base"
        onClick={onRetry}
      >
        <Icon className="h-5 w-5" />
        {retryLabel}
      </Button>
    );
  }
  return (
    <Button
      size="lg"
      variant="outline"
      className="h-12 min-w-[252px] gap-2 px-6 text-base"
      disabled
    >
      <Icon className="h-5 w-5" />
      {downloadLabel}
    </Button>
  );
}

function DownloadChannelToggle({
  channel,
  onChange,
}: {
  channel: DownloadReleaseChannel;
  onChange: (nextChannel: DownloadReleaseChannel) => void;
}) {
  const t = useT();
  const channelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const channels = [
    ["production", t("downloadRoute.stable")],
    ["nightly", t("downloadRoute.nightly")],
  ] as const;
  return (
    <div
      role="radiogroup"
      aria-label={t("downloadRoute.releaseChannel")}
      className="inline-flex items-center gap-0.5 rounded-md border border-border/60 p-1"
    >
      {channels.map(([value, label], index) => {
        const active = channel === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={(element) => {
              channelRefs.current[index] = element;
            }}
            onClick={() => onChange(value)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!direction) return;
              event.preventDefault();
              const nextIndex =
                (index + direction + channels.length) % channels.length;
              onChange(channels[nextIndex][0]);
              channelRefs.current[nextIndex]?.focus();
            }}
            className={`rounded px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function DownloadPage() {
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();
  const t = useT();
  const [channel, setChannel] = useState<DownloadReleaseChannel>("production");
  const [hostResolved, setHostResolved] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [detected, setDetected] = useState<PlatformId | null>(null);
  const [manifestRequest, setManifestRequest] = useState(0);
  const [confirmedDownload, setConfirmedDownload] =
    useState<ConfirmedDownload | null>(null);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  useEffect(() => {
    setChannel(getDefaultDownloadChannel(window.location.hostname));
    setHostResolved(true);
  }, []);

  useEffect(() => {
    if (!hostResolved) return;

    let cancelled = false;
    const cachedManifest = readCachedManifest(channel);
    setManifest(cachedManifest);
    setManifestError(false);
    const manifestUrl =
      channel === "nightly"
        ? `${LATEST_JSON_URL}?channel=nightly`
        : LATEST_JSON_URL;
    fetch(manifestUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((json) => {
        if (!isManifest(json)) throw new Error("Invalid manifest");
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
  }, [channel, hostResolved, manifestRequest]);

  const retryManifest = () => {
    setConfirmedDownload(null);
    setManifestRequest((request) => request + 1);
  };

  const handleChannelChange = (nextChannel: DownloadReleaseChannel) => {
    if (nextChannel === channel) return;

    setManifest(null);
    setManifestError(false);
    setConfirmedDownload(null);
    setChannel(nextChannel);
  };

  const primary = VARIANTS.find((v) => v.id === detected) ?? VARIANTS[0];
  const primaryAsset = pickAsset(manifest, primary);
  const downloadLabel = t("downloadRoute.downloadFor", {
    platform: primary.label,
  });
  const downloadStartedLabel = t("downloadRoute.downloadStarted");
  const primaryDownloadStarted =
    confirmedDownload?.asset.url === primaryAsset?.url;

  const handleDownload = (asset: Manifest["assets"][number], label: string) => {
    markDesktopAppDownloaded();
    setConfirmedDownload({ asset, label });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40">
        <div className="mx-auto flex h-16 max-w-[1300px] items-center gap-3 border-x border-border/40 px-6 sm:px-10">
          <a
            href={appPath("/")}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <img
              src={appPath("/agent-native-icon-light.svg")}
              alt=""
              aria-hidden="true"
              className="block h-4 w-auto shrink-0 dark:hidden"
            />
            <img
              src={appPath("/agent-native-icon-dark.svg")}
              alt=""
              aria-hidden="true"
              className="hidden h-4 w-auto shrink-0 dark:block"
            />
            <span>Clips</span>
          </a>
          <a
            href={appPath("/library")}
            className="ms-auto text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("downloadRoute.backToLibrary")}
          </a>
        </div>
      </header>

      <main>
        <section className="border-b border-border/40">
          <div className="mx-auto flex max-w-[1300px] flex-col items-center border-x border-border/40 px-6 pb-24 pt-36 text-center sm:px-10">
            <h1 className="text-4xl font-medium tracking-tight sm:text-[56px] sm:leading-[1.05]">
              {t("downloadRoute.clipsDesktop")}
              {channel === "nightly" && (
                <>
                  {" "}
                  <span className="text-highlight">
                    {t("downloadRoute.nightly")}
                  </span>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("downloadRoute.heroDescription")}
            </p>

            <div className="mt-10 flex flex-col items-center gap-3">
              {primaryDownloadButton(
                primary,
                manifest,
                manifestError,
                downloadLabel,
                t("downloadRoute.retry"),
                retryManifest,
                primaryDownloadStarted,
                downloadStartedLabel,
                (asset) => handleDownload(asset, downloadLabel),
              )}

              {confirmedDownload && (
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  <span className="sr-only">{downloadStartedLabel}</span>
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
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {t("downloadRoute.downloadAgain")}
                  </a>
                </p>
              )}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto flex max-w-[1300px] items-center border-x border-b border-border/40 px-6 py-5 sm:px-8">
            <span className="font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("downloadRoute.allPlatforms")}
            </span>
            <div className="flex-1" />
            <DownloadChannelToggle
              channel={channel}
              onChange={handleChannelChange}
            />
          </div>

          <div className="mx-auto grid max-w-[1300px] grid-cols-1 border-x border-b border-border/40 sm:grid-cols-3">
            {VARIANTS.map((variant, index) => {
              const Icon = variant.icon;
              const asset = pickAsset(manifest, variant);
              const extension = asset?.name.split(".").pop() ?? "";
              return (
                <div
                  key={variant.id}
                  className={`flex min-h-60 flex-col gap-5 p-6 sm:p-8 ${
                    index < VARIANTS.length - 1
                      ? "border-b border-border/40 sm:border-r sm:border-b-0"
                      : "border-b-0"
                  }`}
                >
                  <Icon
                    size={24}
                    stroke={1.5}
                    className="text-foreground"
                    aria-hidden="true"
                  />
                  <h2 className="text-lg font-medium">{variant.label}</h2>
                  <a
                    href={asset?.url}
                    target={asset ? "_blank" : undefined}
                    rel={asset ? "noreferrer" : undefined}
                    aria-disabled={!asset}
                    onClick={
                      asset
                        ? () => handleDownload(asset, downloadLabel)
                        : undefined
                    }
                    className={`mt-auto flex items-center gap-2 text-sm no-underline transition-colors ${
                      asset
                        ? "text-muted-foreground hover:text-foreground"
                        : "pointer-events-none text-muted-foreground/50"
                    }`}
                  >
                    <span>
                      {variant.id === "mac"
                        ? t("downloadRoute.macSublabel")
                        : variant.id === "windows"
                          ? t("downloadRoute.windowsSublabel")
                          : t("downloadRoute.downloadFor", {
                              platform: variant.label,
                            })}
                    </span>
                    {extension && (
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        {extension}
                      </span>
                    )}
                  </a>
                </div>
              );
            })}
          </div>
        </section>

        {chromeExtensionEnabled && (
          <section className="mx-auto max-w-[1300px] border-x border-b border-border/40">
            <div className="flex flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:px-8">
              <IconBrandChrome
                size={24}
                stroke={1.5}
                className="text-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-medium">
                  {t("downloadRoute.chromeTitle")}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  {t("captureInstall.chromeDescription")}
                </p>
              </div>
              <a
                href={CHROME_EXTENSION_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                aria-label={t("downloadRoute.chromeTitle")}
                title={t("downloadRoute.chromeTitle")}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <IconHelpCircle className="size-3" aria-hidden="true" />
              </a>
              <Button
                asChild={Boolean(clipsChromeExtensionUrl)}
                disabled={!clipsChromeExtensionUrl}
                variant="outline"
                size="sm"
              >
                {clipsChromeExtensionUrl ? (
                  <a
                    href={clipsChromeExtensionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconBrandChrome className="h-4 w-4" />
                    {t("downloadRoute.installChrome")}
                  </a>
                ) : (
                  <>
                    <IconBrandChrome className="h-4 w-4" />
                    {t("downloadRoute.chromePending")}
                  </>
                )}
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
