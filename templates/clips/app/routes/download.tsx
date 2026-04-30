import { useEffect, useMemo, useState } from "react";
import {
  IconBrandApple,
  IconBrandWindows,
  IconDownload,
  IconPlayerRecord,
} from "@tabler/icons-react";
import { appBasePath, appPath } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";

export function meta() {
  return [
    { title: "Download Clips Desktop" },
    {
      name: "description",
      content:
        "Record your screen from the menu bar. Auto-updating desktop app for macOS and Windows.",
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
    | "windows-exe"
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
    sublabel: "64-bit installer",
    assetKinds: ["windows-msi", "windows-exe"],
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

function downloadButton(
  variant: PlatformVariant,
  manifest: Manifest | null,
  manifestError: boolean,
) {
  const asset = pickAsset(manifest, variant);
  const Icon = variant.icon;
  if (asset) {
    return (
      <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
        <a href={asset.url} download>
          <Icon className="h-5 w-5" />
          Download for {variant.label}
        </a>
      </Button>
    );
  }
  if (manifest === null && !manifestError) {
    return (
      <Button size="lg" className="h-12 gap-2 px-6 text-base" disabled>
        <Icon className="h-5 w-5" />
        Loading…
      </Button>
    );
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
        Download for {variant.label}
      </a>
    </Button>
  );
}

export default function DownloadPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const detected = useMemo(() => detectPlatform(), []);

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
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            Back to library
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Clips Desktop
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            A menu-bar recorder for screen, camera, and screen + camera.
            One-click start, draggable camera bubble, instant-share link when
            you stop.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
            {downloadButton(primary, manifest, manifestError)}
            {downloadButton(secondary, manifest, manifestError)}
            <div className="text-xs text-muted-foreground">
              {manifest ? (
                <>
                  Version {manifest.version}
                  {manifest.pub_date
                    ? ` — released ${new Date(manifest.pub_date).toLocaleDateString()}`
                    : null}
                </>
              ) : manifestError ? (
                <>
                  Could not load release manifest — pick an installer from the
                  releases page.
                </>
              ) : (
                <>Loading latest release…</>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
