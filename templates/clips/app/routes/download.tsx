import { appBasePath, appPath, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconBrandChrome,
  IconBrandApple,
  IconBrandWindows,
  IconExternalLink,
  IconPlayerRecord,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import enMessages from "@/i18n/en-US";
import {
  clipsChromeExtensionEnabled,
  clipsChromeExtensionUrl,
} from "@/lib/capture-install-options";

export function meta() {
  return [
    { title: enMessages.downloadRoute.pageTitle },
    {
      name: "description",
      content: enMessages.downloadRoute.description,
    },
  ];
}

type PlatformId = "mac" | "windows";

interface PlatformVariant {
  id: PlatformId;
  label: string;
  sublabel: string;
  assetKinds: readonly (
    | "mac-universal"
    | "mac-arm64"
    | "mac-x64"
    | "windows-msi"
  )[];
  icon: typeof IconBrandApple;
}

const LATEST_JSON_URL = `${appBasePath()}/api/clips-latest.json`;

const RELEASE_PAGE_URL =
  "https://github.com/BuilderIO/agent-native/releases?q=clips-v";

const VARIANTS: PlatformVariant[] = [
  {
    id: "mac",
    label: "macOS",
    sublabel: "Universal (Apple Silicon + Intel)",
    assetKinds: ["mac-universal", "mac-arm64", "mac-x64"],
    icon: IconBrandApple,
  },
  {
    id: "windows",
    label: "Windows",
    sublabel: "64-bit MSI installer",
    assetKinds: ["windows-msi"],
    icon: IconBrandWindows,
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
) {
  const asset = pickAsset(manifest, variant);
  const Icon = variant.icon;
  if (asset) {
    return (
      <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
        <a href={asset.url} download>
          <Icon className="h-5 w-5" />
          {downloadLabel}
        </a>
      </Button>
    );
  }
  if (manifest === null && !manifestError) {
    return <Skeleton className="h-12 w-[252px] rounded-md" />;
  }
  return (
    <Button
      asChild
      size="lg"
      variant="outline"
      className="h-12 gap-2 px-6 text-base"
    >
      <a href={RELEASE_PAGE_URL} rel="noreferrer">
        <Icon className="h-5 w-5" />
        {downloadLabel}
      </a>
    </Button>
  );
}

function secondaryDownloadButton(
  variant: PlatformVariant,
  manifest: Manifest | null,
  manifestError: boolean,
  downloadLabel: string,
) {
  const asset = pickAsset(manifest, variant);
  const Icon = variant.icon;
  const className =
    "h-auto gap-1.5 px-2 py-1 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground";
  if (asset) {
    return (
      <Button asChild variant="ghost" className={className}>
        <a href={asset.url} download>
          <Icon className="h-4 w-4" />
          {downloadLabel}
        </a>
      </Button>
    );
  }
  if (manifest === null && !manifestError) {
    return <Skeleton className="h-7 w-[208px] rounded-md" />;
  }
  return (
    <Button asChild variant="ghost" className={className}>
      <a href={RELEASE_PAGE_URL} rel="noreferrer">
        <Icon className="h-4 w-4" />
        {downloadLabel}
      </a>
    </Button>
  );
}

export default function DownloadPage() {
  const t = useT();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [detected, setDetected] = useState<PlatformId | null>(null);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(LATEST_JSON_URL)
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
  }, []);

  const primary = VARIANTS.find((v) => v.id === detected) ?? VARIANTS[0];
  const secondary = VARIANTS.find((v) => v.id !== primary.id)!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <a
            href={appPath("/")}
            className="flex items-center gap-2 font-semibold"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <IconPlayerRecord className="h-4 w-4" />
            </span>
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
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            {t("downloadRoute.heroDescription")}
          </p>

          <div className="mt-10 flex flex-col items-center gap-3">
            {primaryDownloadButton(
              primary,
              manifest,
              manifestError,
              t("downloadRoute.downloadFor", { platform: primary.label }),
            )}
            {secondaryDownloadButton(
              secondary,
              manifest,
              manifestError,
              t("downloadRoute.alsoFor", { platform: secondary.label }),
            )}
            <div className="text-xs text-muted-foreground">
              {manifest ? (
                <>
                  {manifest.pub_date
                    ? t("downloadRoute.versionReleased", {
                        version: manifest.version,
                        date: new Date(manifest.pub_date).toLocaleDateString(),
                      })
                    : t("downloadRoute.version", {
                        version: manifest.version,
                      })}
                </>
              ) : manifestError ? (
                <>{t("downloadRoute.manifestError")}</>
              ) : (
                <>{t("downloadRoute.loadingRelease")}</>
              )}
            </div>
          </div>

          {clipsChromeExtensionEnabled && (
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
