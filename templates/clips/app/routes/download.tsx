import { useEffect, useMemo, useState } from "react";
import {
  IconBrandApple,
  IconBrandWindows,
  IconBrandUbuntu,
  IconDownload,
  IconPlayerRecord,
  IconKeyboard,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function meta() {
  return [
    { title: "Download Clips Desktop" },
    {
      name: "description",
      content:
        "Record your screen from the menu bar. Auto-updating desktop app for macOS, Windows, and Linux.",
    },
  ];
}

type PlatformId = "mac-apple-silicon" | "mac-intel" | "windows" | "linux";

interface PlatformVariant {
  id: PlatformId;
  label: string;
  sublabel: string;
  assetPattern: RegExp;
  icon: typeof IconBrandApple;
}

// Same-origin proxy for the Tauri updater manifest. We can't hit the raw
// GitHub release URL from a browser because GitHub's asset responses lack
// CORS headers. See `server/routes/api/clips-latest.json.get.ts`.
const LATEST_JSON_URL = "/api/clips-latest.json";

// Fallback link when the manifest is unavailable — the public Releases
// page for the `clips-latest` pointer, where users can pick an installer
// by hand. This is a real, browsable URL (NOT the JSON manifest), so the
// button never serves JSON by mistake.
const RELEASE_PAGE_URL =
  "https://github.com/BuilderIO/agent-native/releases/tag/clips-latest";

const VARIANTS: PlatformVariant[] = [
  {
    id: "mac-apple-silicon",
    label: "macOS — Apple Silicon",
    sublabel: "M1 / M2 / M3 / M4",
    assetPattern: /aarch64.*\.dmg$|arm64.*\.dmg$/i,
    icon: IconBrandApple,
  },
  {
    id: "mac-intel",
    label: "macOS — Intel",
    sublabel: "x86_64",
    assetPattern: /x64.*\.dmg$|x86_64.*\.dmg$/i,
    icon: IconBrandApple,
  },
  {
    id: "windows",
    label: "Windows",
    sublabel: "64-bit installer",
    assetPattern: /\.msi$|\.exe$/i,
    icon: IconBrandWindows,
  },
  {
    id: "linux",
    label: "Linux",
    sublabel: "AppImage",
    assetPattern: /\.AppImage$/i,
    icon: IconBrandUbuntu,
  },
];

interface Manifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, { url: string; signature: string }>;
}

function detectPlatform(): PlatformId | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) {
    // Canonical arch signal (Chromium: "arm" | "x86"). Safari does not
    // expose `userAgentData`, in which case we can't reliably tell Intel
    // from Apple Silicon — default to Apple Silicon since it's the
    // overwhelming majority on currently-shipping Macs.
    const arch = (
      navigator as unknown as { userAgentData?: { architecture?: string } }
    ).userAgentData?.architecture;
    if (arch === "arm") return "mac-apple-silicon";
    if (arch === "x86") return "mac-intel";
    return "mac-apple-silicon";
  }
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return null;
}

function pickAsset(
  manifest: Manifest | null,
  variant: PlatformVariant,
): string | null {
  if (!manifest) return null;
  for (const [, value] of Object.entries(manifest.platforms)) {
    if (variant.assetPattern.test(value.url)) return value.url;
  }
  return null;
}

export default function DownloadPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const detected = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    let cancelled = false;
    fetch(LATEST_JSON_URL, { cache: "no-cache" })
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
  const others = VARIANTS.filter((v) => v.id !== primary.id);
  const primaryAsset = pickAsset(manifest, primary);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <IconPlayerRecord className="h-4 w-4" />
            </span>
            <span>Clips</span>
          </a>
          <a
            href="/library"
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            Back to library
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <IconRefresh className="h-3.5 w-3.5" />
            Auto-updates — you always have the latest
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Clips Desktop
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            A menu-bar recorder for screen, camera, and screen + camera.
            One-click start, draggable camera bubble, instant-share link when
            you stop.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3">
            {primaryAsset ? (
              <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                <a href={primaryAsset} download>
                  <primary.icon className="h-5 w-5" />
                  Download for {primary.label}
                </a>
              </Button>
            ) : manifest === null && !manifestError ? (
              <Button size="lg" className="h-12 gap-2 px-6 text-base" disabled>
                <primary.icon className="h-5 w-5" />
                Loading latest release…
              </Button>
            ) : (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 gap-2 px-6 text-base"
              >
                <a href={RELEASE_PAGE_URL} rel="noreferrer">
                  <primary.icon className="h-5 w-5" />
                  Get the latest release
                </a>
              </Button>
            )}
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

        <div className="mt-16 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {others.map((v) => {
            const url = pickAsset(manifest, v);
            const Icon = v.icon;
            return (
              <Card
                key={v.id}
                className="flex items-center gap-3 border border-border bg-muted/20 p-4"
              >
                <span className="grid h-9 w-9 place-items-center rounded-md bg-background">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {v.sublabel}
                  </div>
                </div>
                {url ? (
                  <a
                    href={url}
                    download
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <IconDownload className="h-4 w-4" />
                    Get
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Unavailable
                  </span>
                )}
              </Card>
            );
          })}
        </div>

        <section className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Feature
            icon={IconKeyboard}
            title="Global shortcut"
            body="Press ⌘⇧L anywhere to open the tray — start recording without switching windows."
          />
          <Feature
            icon={IconRefresh}
            title="Stays current"
            body="New builds install themselves in the background and prompt you to restart. No manual updates."
          />
          <Feature
            icon={IconPlayerRecord}
            title="Camera bubble"
            body="Screen + camera mode floats a draggable PiP of your face over everything you capture."
          />
        </section>
      </main>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof IconRefresh;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <Icon className="mb-3 h-5 w-5 text-primary" />
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
