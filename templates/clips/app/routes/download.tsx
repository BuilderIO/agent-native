import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandChrome,
  IconBrandApple,
  IconBrandWindows,
  IconExternalLink,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

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
): { url: string; name: string } | null {
  if (!manifest) return null;
  for (const kind of variant.assetKinds) {
    const asset = manifest.assets.find((a) => a.kind === kind);
    if (asset) return { url: asset.url, name: asset.name };
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
) {
  const asset = pickAsset(manifest, variant);
  const Icon = variant.icon;
  if (asset) {
    return (
      <Button
        asChild
        size="lg"
        className="h-12 min-w-[252px] gap-2 px-6 text-base"
      >
        <a href={asset.url} download onClick={markDesktopAppDownloaded}>
          <Icon className="h-5 w-5" />
          {downloadLabel}
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

export default function DownloadPage() {
  const chromeExtensionEnabled = useClipsChromeExtensionEnabled();
  const t = useT();
  const [channel, setChannel] = useState<DownloadReleaseChannel>("production");
  const [hostResolved, setHostResolved] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [detected, setDetected] = useState<PlatformId | null>(null);
  const [manifestRequest, setManifestRequest] = useState(0);

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
    setManifest(null);
    setManifestError(false);
    const manifestUrl =
      channel === "nightly"
        ? `${LATEST_JSON_URL}?channel=nightly`
        : LATEST_JSON_URL;
    fetch(manifestUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((json) => {
        if (!cancelled) setManifest(json as Manifest);
      })
      .catch(() => {
        if (!cancelled) setManifestError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, hostResolved, manifestRequest]);

  const retryManifest = () => {
    setManifestRequest((request) => request + 1);
  };

  const handleChannelChange = (nextChannel: DownloadReleaseChannel) => {
    if (nextChannel === channel) return;

    setManifest(null);
    setManifestError(false);
    setChannel(nextChannel);
  };

  const primary = VARIANTS.find((v) => v.id === detected) ?? VARIANTS[0];

  const handlePlatformChange = (nextPlatform: PlatformId) => {
    if (nextPlatform === detected) return;
    setDetected(nextPlatform);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <a
            href={appPath("/")}
            className="flex items-center gap-2 font-semibold"
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
            className="ms-auto text-sm text-muted-foreground hover:text-foreground"
          >
            {t("downloadRoute.backToLibrary")}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
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
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            {t("downloadRoute.heroDescription")}
          </p>

          <div className="mt-10 flex flex-col items-center">
            <div className="mb-2 flex justify-center gap-2">
              {VARIANTS.map((variant) => {
                const Icon = variant.icon;
                const active = primary.id === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    aria-label={variant.label}
                    aria-pressed={active}
                    onClick={() => handlePlatformChange(variant.id)}
                    className={`group flex items-center justify-center rounded-lg p-4 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "text-foreground"
                        : "text-muted-foreground opacity-40 hover:opacity-65"
                    }`}
                  >
                    <Icon className="size-6" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <div className="mx-auto mt-8 max-w-2xl text-center">
              {primaryDownloadButton(
                primary,
                manifest,
                manifestError,
                t("downloadRoute.downloadFor", { platform: primary.label }),
                t("downloadRoute.retry"),
                retryManifest,
              )}

              <div className="mt-5 flex justify-center">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("downloadRoute.stable")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={channel === "nightly"}
                    aria-label={t(
                      channel === "nightly"
                        ? "downloadRoute.switchToStable"
                        : "downloadRoute.switchToNightly",
                    )}
                    onClick={() =>
                      handleChannelChange(
                        channel === "nightly" ? "production" : "nightly",
                      )
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      channel === "nightly"
                        ? "bg-foreground"
                        : "bg-muted-foreground/20"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`block size-3.5 rounded-full bg-primary-foreground shadow-sm transition-transform ${
                        channel === "nightly"
                          ? "translate-x-[18px]"
                          : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                  <span
                    className={
                      channel === "nightly"
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {t("downloadRoute.nightly")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {chromeExtensionEnabled && (
            <section className="mt-10 w-full max-w-xl rounded-2xl border border-border bg-card p-4 text-start shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IconBrandChrome className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("downloadRoute.chromeTitle")}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("downloadRoute.chromeDescription")}
                  </p>
                </div>
              </div>
              <Button
                asChild={Boolean(clipsChromeExtensionUrl)}
                disabled={!clipsChromeExtensionUrl}
                variant="outline"
                className="mt-4 w-full gap-2"
              >
                {clipsChromeExtensionUrl ? (
                  <a
                    href={clipsChromeExtensionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternalLink className="h-4 w-4" />
                    {t("downloadRoute.installChrome")}
                  </a>
                ) : (
                  <>
                    <IconExternalLink className="h-4 w-4" />
                    {t("downloadRoute.chromePending")}
                  </>
                )}
              </Button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
