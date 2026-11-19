import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUpdaterManifest,
  type ReleaseAsset,
} from "./clips-updater-manifest.ts";

const api = (id: number) =>
  `https://api.github.com/repos/BuilderIO/agent-native/releases/assets/${id}`;

// The bundles clips-v0.1.339 shipped, with the asset ids tauri-action wrote
// into that release's latest.json.
const CLIPS_0_1_339: ReleaseAsset[] = [
  { name: "Clips-0.1.339-1.x86_64.rpm", apiUrl: api(703348845) },
  { name: "Clips_0.1.339_amd64.AppImage", apiUrl: api(703348932) },
  { name: "Clips_0.1.339_amd64.deb", apiUrl: api(703348774) },
  { name: "Clips_0.1.339_universal.app.tar.gz", apiUrl: api(703268654) },
  { name: "Clips_0.1.339_universal.dmg", apiUrl: api(703268449) },
  { name: "Clips_0.1.339_x64_en-US.msi", apiUrl: api(703310757) },
];

function signaturesFor(assets: ReleaseAsset[], skip: string[] = []) {
  return new Map(
    assets
      .filter((a) => !a.name.endsWith(".dmg") && !skip.includes(a.name))
      .map((a) => [`${a.name}.sig`, `signature of ${a.name}`]),
  );
}

function build(
  assets: ReleaseAsset[],
  signatures = signaturesFor(assets),
  required = ["darwin-universal", "windows-x86_64", "linux-x86_64"],
) {
  return buildUpdaterManifest({
    version: "0.1.339",
    notes: "Auto-updating production build of the Clips menu-bar app.",
    pubDate: "2026-11-02T22:12:32.252Z",
    assets,
    signatures,
    required,
  });
}

describe("buildUpdaterManifest", () => {
  it("writes the keys and URLs tauri-action published for clips-v0.1.339", () => {
    const manifest = build(CLIPS_0_1_339);
    const urls = Object.fromEntries(
      Object.entries(manifest.platforms).map(([key, p]) => [key, p.url]),
    );
    assert.deepEqual(urls, {
      "darwin-aarch64": api(703268654),
      "darwin-x86_64": api(703268654),
      "darwin-universal": api(703268654),
      "darwin-aarch64-app": api(703268654),
      "darwin-x86_64-app": api(703268654),
      "darwin-universal-app": api(703268654),
      "windows-x86_64": api(703310757),
      "windows-x86_64-msi": api(703310757),
      "linux-x86_64": api(703348932),
      "linux-x86_64-appimage": api(703348932),
      "linux-x86_64-deb": api(703348774),
      "linux-x86_64-rpm": api(703348845),
    });
    assert.equal(
      manifest.platforms["linux-x86_64-deb"]?.signature,
      "signature of Clips_0.1.339_amd64.deb",
    );
    assert.equal(manifest.version, "0.1.339");
    assert.equal(manifest.pub_date, "2026-11-02T22:12:32.252Z");
  });

  it("prefers the MSI over the NSIS installer for the plain Windows key", () => {
    const assets = [
      ...CLIPS_0_1_339,
      { name: "Clips_0.1.339_x64-setup.exe", apiUrl: api(1) },
    ];
    const manifest = build(assets);
    assert.equal(manifest.platforms["windows-x86_64"]?.url, api(703310757));
    assert.equal(manifest.platforms["windows-x86_64-nsis"]?.url, api(1));
  });

  it("keeps a native macOS build's keys when a universal build is also there", () => {
    const assets = [
      ...CLIPS_0_1_339,
      { name: "Clips_0.1.339_aarch64.app.tar.gz", apiUrl: api(2) },
    ];
    const manifest = build(assets);
    assert.equal(manifest.platforms["darwin-aarch64"]?.url, api(2));
    assert.equal(manifest.platforms["darwin-aarch64-app"]?.url, api(2));
    assert.equal(manifest.platforms["darwin-x86_64"]?.url, api(703268654));
  });

  it("refuses an updater bundle that has no signature", () => {
    assert.throws(
      () =>
        build(
          CLIPS_0_1_339,
          signaturesFor(CLIPS_0_1_339, ["Clips_0.1.339_x64_en-US.msi"]),
        ),
      /Clips_0\.1\.339_x64_en-US\.msi has no \.sig file/,
    );
  });

  it("refuses a signature whose bundle is not in the release", () => {
    const assets = CLIPS_0_1_339.filter((a) => !a.name.endsWith(".msi"));
    assert.throws(
      () => build(assets, signaturesFor(CLIPS_0_1_339)),
      /Clips_0\.1\.339_x64_en-US\.msi\.sig has no Clips_0\.1\.339_x64_en-US\.msi asset/,
    );
  });

  it("refuses a release missing a required platform", () => {
    const assets = CLIPS_0_1_339.filter((a) => !a.name.includes("universal"));
    assert.throws(
      () => build(assets),
      /no signed updater bundle for darwin-universal/,
    );
  });

  it("refuses a bundle whose architecture it cannot tell", () => {
    const assets = [
      ...CLIPS_0_1_339,
      { name: "Clips_0.1.339.AppImage", apiUrl: api(3) },
    ];
    assert.throws(() => build(assets), /Cannot tell which architecture/);
  });
});
