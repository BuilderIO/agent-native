/**
 * Writes the Clips desktop updater manifest (`latest.json`) for a release
 * whose platform builds uploaded their bundles and `.sig` files separately.
 *
 * tauri-action can write this file itself, but each build reads, merges and
 * re-uploads it, so builds running at the same time drop each other's
 * platforms. The release workflow builds every platform in parallel and runs
 * this once afterwards. The keys and URLs match what tauri-action writes, so
 * the in-app updater reads the same shape either way.
 *
 *   node --experimental-strip-types scripts/clips-updater-manifest.ts \
 *     --release release.json --signatures sigs/ --version 0.1.340 \
 *     --require darwin-universal,windows-x86_64,linux-x86_64
 *
 * `release.json` is `gh release view <tag> --json assets,body`; `sigs/` holds
 * the release's `.sig` assets.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export type ReleaseAsset = { name: string; apiUrl: string };

export type UpdaterManifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};

type UpdaterBundle = {
  os: "darwin" | "windows" | "linux";
  bundle: "app" | "msi" | "nsis" | "appimage" | "deb" | "rpm";
  /** Higher wins the plain `{os}-{arch}` key, as in tauri-action. */
  priority: number;
};

function updaterBundle(name: string): UpdaterBundle | null {
  if (name.endsWith(".app.tar.gz")) {
    return { os: "darwin", bundle: "app", priority: 0 };
  }
  if (name.endsWith(".msi"))
    return { os: "windows", bundle: "msi", priority: 2 };
  if (name.endsWith("-setup.exe")) {
    return { os: "windows", bundle: "nsis", priority: 1 };
  }
  if (name.endsWith(".AppImage")) {
    return { os: "linux", bundle: "appimage", priority: 2 };
  }
  if (name.endsWith(".deb")) return { os: "linux", bundle: "deb", priority: 0 };
  if (name.endsWith(".rpm")) return { os: "linux", bundle: "rpm", priority: 0 };
  return null;
}

function bundleArch(name: string): string {
  const stem = name.toLowerCase();
  if (stem.includes("universal")) return "universal";
  if (/(^|[^a-z0-9])(aarch64|arm64)([^a-z0-9]|$)/.test(stem)) return "aarch64";
  if (/(^|[^a-z0-9])(x86_64|x64|amd64)([^a-z0-9]|$)/.test(stem)) {
    return "x86_64";
  }
  throw new Error(`Cannot tell which architecture ${name} is for.`);
}

export function buildUpdaterManifest(input: {
  version: string;
  notes: string;
  pubDate: string;
  assets: ReleaseAsset[];
  signatures: ReadonlyMap<string, string>;
  required: readonly string[];
}): UpdaterManifest {
  const assetsByName = new Map(input.assets.map((a) => [a.name, a]));
  const entries: Array<{
    key: string;
    os: string;
    arch: string;
    priority: number;
    platform: { signature: string; url: string };
  }> = [];

  for (const [sigName, signature] of input.signatures) {
    if (!sigName.endsWith(".sig")) {
      throw new Error(`${sigName} is not a signature file.`);
    }
    const bundleName = sigName.slice(0, -".sig".length);
    const kind = updaterBundle(bundleName);
    if (!kind) {
      throw new Error(
        `${sigName} signs ${bundleName}, which is not an updater bundle.`,
      );
    }
    const asset = assetsByName.get(bundleName);
    if (!asset) {
      throw new Error(`${sigName} has no ${bundleName} asset in the release.`);
    }
    const arch = bundleArch(bundleName);
    entries.push({
      key: `${kind.os}-${arch}-${kind.bundle}`,
      os: kind.os,
      arch,
      priority: kind.priority,
      platform: { signature, url: asset.apiUrl },
    });
  }

  for (const asset of input.assets) {
    if (
      updaterBundle(asset.name) &&
      !input.signatures.has(`${asset.name}.sig`)
    ) {
      throw new Error(
        `${asset.name} has no .sig file, so the updater cannot verify it.`,
      );
    }
  }

  const platforms: UpdaterManifest["platforms"] = {};
  for (const entry of entries) {
    if (platforms[entry.key]) {
      throw new Error(`Two bundles map to the updater key ${entry.key}.`);
    }
    platforms[entry.key] = entry.platform;
  }

  const primaries = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const primaryKey = `${entry.os}-${entry.arch}`;
    const current = primaries.get(primaryKey);
    if (!current || entry.priority > current.priority) {
      primaries.set(primaryKey, entry);
    }
  }
  for (const [primaryKey, entry] of primaries) {
    platforms[primaryKey] = entry.platform;
  }

  // A universal macOS build also serves both native architectures unless a
  // native build of that architecture is in the release.
  const universal = primaries.get("darwin-universal");
  if (universal) {
    for (const arch of ["aarch64", "x86_64"]) {
      if (!primaries.has(`darwin-${arch}`)) {
        platforms[`darwin-${arch}`] = universal.platform;
        platforms[`darwin-${arch}-app`] = universal.platform;
      }
    }
  }

  const missing = input.required.filter((key) => !platforms[key]);
  if (missing.length > 0) {
    throw new Error(
      `The release has no signed updater bundle for ${missing.join(", ")}.`,
    );
  }

  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.pubDate,
    platforms,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      release: { type: "string" },
      signatures: { type: "string" },
      version: { type: "string" },
      require: { type: "string" },
    },
  });
  if (
    !values.release ||
    !values.signatures ||
    !values.version ||
    !values.require
  ) {
    throw new Error("Pass --release, --signatures, --version and --require.");
  }
  const release = JSON.parse(readFileSync(values.release, "utf8")) as {
    assets?: ReleaseAsset[];
    body?: string;
  };
  if (!Array.isArray(release.assets) || typeof release.body !== "string") {
    throw new Error(
      `${values.release} is not gh release view --json assets,body output.`,
    );
  }
  const signatures = new Map<string, string>();
  for (const asset of release.assets) {
    if (!asset.name.endsWith(".sig")) continue;
    signatures.set(
      asset.name,
      readFileSync(path.join(values.signatures, asset.name), "utf8"),
    );
  }
  const manifest = buildUpdaterManifest({
    version: values.version,
    notes: release.body,
    pubDate: new Date().toISOString(),
    assets: release.assets.filter((asset) => !asset.name.endsWith(".sig")),
    signatures,
    required: values.require.split(",").filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `::error::${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
