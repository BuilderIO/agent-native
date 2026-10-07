#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ORACLE_DIR = "templates/design/parity/oracle";
const ORACLE_ID = /^fig\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROBE_PNG_BYTES = 4 * 1024 * 1024;
const FigmaMethods = new Set([
  "figma-desktop-app-click",
  "figma-web-app-click",
  "figma-inspector-read",
  "cdp-plugin-api",
  "cdp-input",
]);

type RecorderManifest = {
  id: string;
  claim: string;
  area: string;
  gesture: string;
  nativeObservation: string;
  operator: string;
  measuredBy: string;
  trials: string;
  figmaPageName: string;
  probeMarker: string;
  designId: string;
  values: Record<string, unknown>;
};

type FigmaPageIdentity = {
  id: string;
  name: string;
  pageChangeCount: number;
};

export function recordedFigmaMetadata(): {
  fileKeyWithheld: true;
  pageName: string;
  appBuild: string;
} {
  return {
    fileKeyWithheld: true,
    pageName: "not captured; private scratch page name withheld",
    appBuild: "not exposed by the native Figma page",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsPrivateFigmaLocator(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateFigmaLocator);
  if (typeof value === "string") {
    return /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board|slides|deck)\/[^/?#\s]+/i.test(
      value,
    );
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    return (
      normalizedKey === "filekey" ||
      normalizedKey === "figmafilekey" ||
      normalizedKey === "pageid" ||
      normalizedKey === "figmapageid" ||
      containsPrivateFigmaLocator(child)
    );
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`manifest is missing ${field}`);
  }
  return value.trim();
}

function requireExactString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`manifest is missing ${field}`);
  }
  return value;
}

export function parseRecorderManifest(value: unknown): RecorderManifest {
  if (!isRecord(value)) throw new Error("manifest must be a JSON object");
  if (containsPrivateFigmaLocator(value)) {
    throw new Error(
      "private Figma locators and page IDs are not accepted in the manifest",
    );
  }
  const manifest: RecorderManifest = {
    id: requireString(value.id, "id"),
    claim: requireString(value.claim, "claim"),
    area: requireString(value.area, "area"),
    gesture: requireString(value.gesture, "gesture"),
    nativeObservation: requireString(
      value.nativeObservation,
      "nativeObservation",
    ),
    operator: requireString(value.operator, "operator"),
    measuredBy: requireString(value.measuredBy, "measuredBy"),
    trials: requireString(value.trials, "trials"),
    figmaPageName: requireExactString(value.figmaPageName, "figmaPageName"),
    probeMarker: requireString(value.probeMarker, "probeMarker"),
    designId: requireString(value.designId, "designId"),
    values: isRecord(value.values) ? value.values : {},
  };
  if (!ORACLE_ID.test(manifest.id)) {
    throw new Error("id must match fig.<area>.<slug>");
  }
  if (!FigmaMethods.has(manifest.measuredBy)) {
    throw new Error(`unsupported measuredBy method: ${manifest.measuredBy}`);
  }
  if (manifest.probeMarker !== `AN-ORACLE-PROBE:${manifest.id}`) {
    throw new Error(`probeMarker must equal AN-ORACLE-PROBE:${manifest.id}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(manifest.designId)) {
    throw new Error("designId must be a local Design id");
  }
  if (Object.keys(manifest.values).length === 0) {
    throw new Error("manifest values must include the measured observables");
  }
  return manifest;
}

export function requireSelectedDesignProbe(
  marker: string,
  available: unknown,
  selected: unknown,
): void {
  if (
    !Array.isArray(available) ||
    available.filter((name) => name === marker).length !== 1 ||
    !Array.isArray(selected) ||
    selected.length !== 1 ||
    selected[0] !== marker
  ) {
    throw new Error(
      "Design must select exactly the marked oracle probe layer before recording",
    );
  }
}

export function requireSelectedFigmaProbe(
  marker: string,
  available: unknown,
  selected: unknown,
): void {
  if (
    !Array.isArray(available) ||
    available.filter((name) => name === marker).length !== 1 ||
    !Array.isArray(selected) ||
    selected.length !== 1 ||
    selected[0] !== marker
  ) {
    throw new Error(
      "Figma must select exactly the marked oracle probe layer before recording",
    );
  }
}

export function requireExpectedFigmaPage(
  expectedName: string,
  value: unknown,
): FigmaPageIdentity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    !Number.isSafeInteger(value.pageChangeCount) ||
    (value.pageChangeCount as number) < 0
  ) {
    throw new Error("active Figma page bridge returned no page identity");
  }
  const page = {
    id: value.id.trim(),
    name: value.name,
    pageChangeCount: value.pageChangeCount as number,
  };
  if (page.name !== expectedName) {
    throw new Error(
      `active Figma page is ${JSON.stringify(page.name)}, expected ${expectedName}`,
    );
  }
  return page;
}

export function requireStableFigmaPage(
  before: FigmaPageIdentity,
  after: unknown,
): FigmaPageIdentity {
  const current = requireExpectedFigmaPage(before.name, after);
  if (
    current.id !== before.id ||
    current.pageChangeCount !== before.pageChangeCount
  ) {
    throw new Error("active Figma page changed during capture");
  }
  return current;
}

export async function withVerifiedFigmaPage<T>(
  expectedName: string,
  readActivePage: () => Promise<unknown>,
  capture: () => Promise<T>,
): Promise<{ activePage: FigmaPageIdentity; result: T }> {
  const before = requireExpectedFigmaPage(expectedName, await readActivePage());
  const result = await capture();
  const activePage = requireStableFigmaPage(before, await readActivePage());
  return { activePage, result };
}

function readManifest(file: string): RecorderManifest {
  const absolute = path.resolve(process.cwd(), file);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read recorder manifest: ${detail}`, {
      cause: error,
    });
  }
  return parseRecorderManifest(value);
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function appBuild(): { commit: string; dirty: boolean } {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );
  return { commit, dirty: status.trim().length > 0 };
}

async function verifyProbePage(page: any, marker: string): Promise<void> {
  const selection = await page.evaluate((expected: string) => {
    const rows = Array.from(
      document.querySelectorAll('[role="row"][data-testid^="layer-row"]'),
    ).map((row) => {
      const rect = row.getBoundingClientRect();
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(row).visibility !== "hidden";
      const label = (row.textContent || "").replace(/\s+/g, " ").trim();
      const selected =
        row.getAttribute("aria-selected") === "true" ||
        row.querySelector('[aria-selected="true"]') !== null;
      return { visible, label, selected };
    });
    return {
      available: rows
        .filter((row) => row.visible && row.label === expected)
        .map((row) => row.label),
      selected: rows
        .filter((row) => row.visible && row.selected)
        .map((row) => row.label),
    };
  }, marker);
  requireSelectedFigmaProbe(marker, selection.available, selection.selected);
}

export async function readFigmaSelectedProbe(
  page: any,
  pluginId: string,
  marker: string,
): Promise<Uint8Array> {
  const requestId = randomUUID();
  if (pluginId.trim() === "") {
    throw new Error("local oracle page bridge manifest has no plugin id");
  }
  const responses = await Promise.all(
    page.frames().map(async (frame: any) => {
      try {
        return await frame.evaluate(
          async ({
            requestId,
            pluginId,
            marker,
          }: {
            requestId: string;
            pluginId: string;
            marker: string;
          }) => {
            if (!document.getElementById("agent-native-oracle-page-bridge")) {
              return null;
            }

            return new Promise((resolve) => {
              const receive = (event: MessageEvent) => {
                const message = (event.data as { pluginMessage?: unknown })
                  ?.pluginMessage;
                if (
                  !message ||
                  typeof message !== "object" ||
                  (message as { type?: unknown }).type !== "selected-probe" ||
                  (message as { requestId?: unknown }).requestId !== requestId
                ) {
                  return;
                }
                window.clearTimeout(timeout);
                window.removeEventListener("message", receive);
                resolve({ found: true, probe: message });
              };
              const timeout = window.setTimeout(() => {
                window.removeEventListener("message", receive);
                resolve({ found: true, probe: null });
              }, 5_000);
              window.addEventListener("message", receive);
              window.parent.postMessage(
                {
                  pluginMessage: {
                    type: "export-selected-probe",
                    requestId,
                    marker,
                  },
                  pluginId,
                },
                "https://www.figma.com",
              );
            });
          },
          { requestId, pluginId, marker },
        );
      } catch (error) {
        throw new Error("could not inspect a Figma page frame", {
          cause: error,
        });
      }
    }),
  );
  const matches = responses.filter((response: any) => response?.found === true);
  if (matches.length !== 1) {
    if (matches.length > 1) {
      throw new Error("multiple active Figma page bridges are open");
    }
    throw new Error(
      "active Figma page bridge is missing; build and run the local oracle page bridge before recording",
    );
  }
  const probe = matches[0].probe;
  if (!isRecord(probe) || probe.type !== "selected-probe") {
    throw new Error("Figma selected probe bridge returned no export");
  }
  if (typeof probe.error === "string") {
    throw new Error(`Figma selected probe export failed: ${probe.error}`);
  }
  if (probe.marker !== marker) {
    throw new Error("Figma probe export did not match the selected marker");
  }
  if (
    !Array.isArray(probe.png) ||
    probe.png.length === 0 ||
    probe.png.length > MAX_PROBE_PNG_BYTES ||
    probe.png.some(
      (byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255,
    )
  ) {
    throw new Error("Figma selected probe export returned invalid PNG bytes");
  }
  return Uint8Array.from(probe.png as number[]);
}

export async function captureSelectedFigmaProbe(
  page: any,
  pluginId: string,
  marker: string,
): Promise<Uint8Array> {
  await verifyProbePage(page, marker);
  return readFigmaSelectedProbe(page, pluginId, marker);
}

export async function captureSelectedDesignProbe(
  page: any,
  marker: string,
  file: string,
): Promise<void> {
  const probe = page
    .frameLocator("iframe")
    .first()
    .locator(`[data-agent-native-layer-name="${marker}"]`);
  const matches = await probe.count();
  if (matches !== 1) {
    throw new Error(
      `local Design preview must contain exactly one matching oracle probe layer; found ${matches}`,
    );
  }
  await probe.screenshot({ path: file });
}

function readFigmaPageBridgePluginId(manifestPath: string): string {
  const bridgeManifestPath = path.resolve(process.cwd(), manifestPath);
  let pluginId: unknown;
  try {
    pluginId = JSON.parse(readFileSync(bridgeManifestPath, "utf8")).id;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot read Figma development plugin manifest; create the local plugin in Figma Desktop and build the bridge into that directory first: ${detail}`,
      { cause: error },
    );
  }
  if (typeof pluginId !== "string" || !/^\d{12,}$/.test(pluginId)) {
    throw new Error(
      "Figma development plugin manifest has no Figma-assigned numeric plugin id",
    );
  }
  return pluginId;
}

export async function readFigmaActivePage(
  page: any,
  pluginId: string,
): Promise<FigmaPageIdentity> {
  const requestId = randomUUID();
  if (pluginId.trim() === "") {
    throw new Error("local oracle page bridge manifest has no plugin id");
  }
  const bridgeResponses = await Promise.all(
    page.frames().map(async (frame: any) => {
      try {
        return await frame.evaluate(
          async ({
            request,
            pluginId,
          }: {
            request: string;
            pluginId: string;
          }) => {
            if (!document.getElementById("agent-native-oracle-page-bridge")) {
              return null;
            }

            return new Promise((resolve) => {
              const receive = (event: MessageEvent) => {
                const message = (event.data as { pluginMessage?: unknown })
                  ?.pluginMessage;
                if (
                  !message ||
                  typeof message !== "object" ||
                  (message as { type?: unknown }).type !== "active-page" ||
                  (message as { requestId?: unknown }).requestId !== request
                ) {
                  return;
                }
                window.clearTimeout(timeout);
                window.removeEventListener("message", receive);
                resolve({
                  found: true,
                  page: (message as { page?: unknown }).page ?? null,
                });
              };
              const timeout = window.setTimeout(() => {
                window.removeEventListener("message", receive);
                resolve({ found: true, page: null });
              }, 2_000);
              window.addEventListener("message", receive);
              window.parent.postMessage(
                {
                  pluginMessage: {
                    type: "get-active-page",
                    requestId: request,
                  },
                  pluginId,
                },
                "https://www.figma.com",
              );
            });
          },
          { request: requestId, pluginId },
        );
      } catch (error) {
        throw new Error("could not inspect a Figma page frame", {
          cause: error,
        });
      }
    }),
  );
  const matches = bridgeResponses.filter(
    (response: any) => response?.found === true,
  );
  if (matches.length !== 1) {
    if (matches.length > 1) {
      throw new Error("multiple active Figma page bridges are open");
    }
    throw new Error(
      "active Figma page bridge is missing; build and run the local oracle page bridge before recording",
    );
  }
  const pageIdentity = matches[0].page;
  if (!isRecord(pageIdentity) || typeof pageIdentity.name !== "string") {
    throw new Error("active Figma page bridge returned no page identity");
  }
  return requireExpectedFigmaPage(pageIdentity.name, pageIdentity);
}

async function readFigmaInspector(page: any): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const values: Record<string, string> = {};
    for (const input of document.querySelectorAll("input")) {
      const rect = input.getBoundingClientRect();
      const label =
        input.getAttribute("aria-label") || input.getAttribute("data-tooltip");
      if (label && rect.width > 2 && rect.x > window.innerWidth - 260) {
        values[label] =
          `${(input as HTMLInputElement).value}${(input as HTMLInputElement).disabled ? " (disabled)" : ""}`;
      }
    }
    return values;
  });
}

function appendArtifact(
  entryId: string,
  stagingDir: string,
  fileName: string,
  kind: string,
): { path: string; kind: string; sha256: string } {
  const file = path.join(stagingDir, fileName);
  const bytes = readFileSync(file);
  if (bytes.byteLength < 1_000) {
    throw new Error(`${kind} capture is empty or unexpectedly small`);
  }
  return {
    path: `${ORACLE_DIR}/${entryId}/${fileName}`,
    kind,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function record(
  manifest: RecorderManifest,
  pluginId: string,
): Promise<string> {
  const finalRoot = path.join(REPO_ROOT, ORACLE_DIR);
  const finalEntry = path.join(finalRoot, `${manifest.id}.json`);
  const finalArtifacts = path.join(finalRoot, manifest.id);
  if (existsSync(finalEntry) || existsSync(finalArtifacts)) {
    throw new Error(`oracle id already exists: ${manifest.id}`);
  }

  const tmpRoot = path.join(REPO_ROOT, ".tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const staging = path.join(
    tmpRoot,
    `oracle-record-${process.pid}-${Date.now()}`,
  );
  const captureDir = path.join(staging, "capture");
  const stagedArtifacts = path.join(staging, manifest.id);
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(stagedArtifacts, { recursive: true });
  mkdirSync(finalRoot, { recursive: true });

  let artifactsPublished = false;
  try {
    const [
      { withLock, FIGMA_LOGIN_COOKIE },
      { CDP_URL, chromium },
      { openEditor },
      { sheet },
    ] = await Promise.all([
      import("../.agents/skills/design-clip-repro/harness/figlib.mjs"),
      import("../.agents/skills/design-clip-repro/harness/harness-env.mjs"),
      import("../.agents/skills/design-clip-repro/harness/dlib.mjs"),
      import("../.agents/skills/design-clip-repro/harness/sheet.mjs"),
    ]);

    let figmaShot = "";
    let figmaInspector: Record<string, string> = {};
    await withLock("osmouse", async () => {
      const browser = await chromium.connectOverCDP(CDP_URL);
      try {
        const page = browser
          .contexts()
          .flatMap((context: any) => context.pages())
          .find((candidate: any) =>
            candidate.url().includes("figma.com/design/"),
          );
        if (!page) {
          throw new Error(
            "no Figma Design tab is open in the CDP-connected Chrome",
          );
        }
        const cookies = await page.context().cookies("https://www.figma.com");
        if (
          !cookies.some(
            (cookie: { name: string }) => cookie.name === FIGMA_LOGIN_COOKIE,
          )
        ) {
          throw new Error(
            "Figma login cookie is unavailable; no capture was written",
          );
        }
        await withVerifiedFigmaPage(
          manifest.figmaPageName,
          () => readFigmaActivePage(page, pluginId),
          async () => {
            const probePng = await captureSelectedFigmaProbe(
              page,
              pluginId,
              manifest.probeMarker,
            );
            figmaInspector = await readFigmaInspector(page);
            figmaShot = path.join(captureDir, "figma.png");
            writeFileSync(figmaShot, probePng);
          },
        );
      } finally {
        await browser.close();
      }
    });

    const design = await openEditor(manifest.designId);
    let designShot: string;
    let designInspector: Record<string, string>;
    try {
      const files = await design.files();
      const probeComment = `<!-- ${manifest.probeMarker} -->`;
      if (
        !Object.values(files).some((content: string) =>
          content.includes(probeComment),
        )
      ) {
        throw new Error(
          "local Design file is not marked as the matching oracle probe",
        );
      }
      const availableProbes = await design.page.evaluate(
        (marker: string) =>
          [...document.querySelectorAll('[role="treeitem"], [role="row"]')]
            .filter((row) => (row as HTMLElement).offsetParent !== null)
            .map((row) => (row.textContent || "").trim().split("\n")[0])
            .filter((name) => name === marker),
        manifest.probeMarker,
      );
      const selection = await design.selectLayer(manifest.probeMarker);
      if (selection.result !== `clicked: ${manifest.probeMarker}`) {
        throw new Error(
          `could not select the marked Design oracle probe: ${selection.result}`,
        );
      }
      requireSelectedDesignProbe(
        manifest.probeMarker,
        availableProbes,
        selection.selected,
      );
      designInspector = await design.inspector();
      designShot = path.join(captureDir, "design.png");
      await captureSelectedDesignProbe(
        design.page,
        manifest.probeMarker,
        designShot,
      );
    } finally {
      await design.close();
    }

    await sheet(
      `Design oracle ${manifest.id}`,
      [
        { label: "Native Figma", image: figmaShot },
        { label: "Design", image: designShot },
      ],
      { columns: 2, out: path.join(captureDir, "comparison.jpg") },
    );

    for (const name of ["figma.png", "design.png", "comparison.jpg"]) {
      copyFileSync(
        path.join(captureDir, name),
        path.join(stagedArtifacts, name),
      );
    }
    const artifacts = [
      appendArtifact(
        manifest.id,
        stagedArtifacts,
        "figma.png",
        "figma-screenshot",
      ),
      appendArtifact(
        manifest.id,
        stagedArtifacts,
        "design.png",
        "design-screenshot",
      ),
      appendArtifact(
        manifest.id,
        stagedArtifacts,
        "comparison.jpg",
        "comparison-sheet",
      ),
    ];
    const entry = {
      schemaVersion: 1,
      id: manifest.id,
      claim: manifest.claim,
      area: manifest.area,
      basis: "measured",
      status: "current",
      measuredBy: manifest.measuredBy,
      operator: manifest.operator,
      date: new Date().toISOString().slice(0, 10),
      gesture: manifest.gesture,
      nativeObservation: manifest.nativeObservation,
      trials: manifest.trials,
      values: {
        ...manifest.values,
        nativeFigmaInspector: figmaInspector,
        designInspector,
      },
      figma: {
        ...recordedFigmaMetadata(),
      },
      designBuild: appBuild(),
      source:
        "Captured by scripts/oracle-record.ts from the marked native Figma probe and matching local Design probe.",
      artifacts,
    };

    const stagedEntry = path.join(staging, `${manifest.id}.json`);
    writeFileSync(stagedEntry, `${JSON.stringify(entry, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(stagedArtifacts, finalArtifacts);
    artifactsPublished = true;
    try {
      renameSync(stagedEntry, finalEntry);
    } catch (error) {
      rmSync(finalArtifacts, { recursive: true, force: true });
      artifactsPublished = false;
      throw error;
    }
    return finalEntry;
  } finally {
    if (artifactsPublished && !existsSync(finalEntry)) {
      rmSync(finalArtifacts, { recursive: true, force: true });
    }
    rmSync(staging, { recursive: true, force: true });
  }
}

function main(): void {
  let manifestPath = "";
  let pluginManifestPath = ".tmp/figma-oracle-page-bridge/manifest.json";
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`missing value for ${flag}`);
      process.exitCode = 2;
      return;
    }
    if (flag === "--manifest") manifestPath = value;
    else if (flag === "--plugin-manifest") pluginManifestPath = value;
    else {
      console.error(`unknown option: ${flag}`);
      process.exitCode = 2;
      return;
    }
    index += 1;
  }
  if (!manifestPath) {
    console.error(
      "usage: pnpm design:oracle-record -- --manifest <probe.json> [--plugin-manifest <figma-plugin-manifest.json>]",
    );
    process.exitCode = 2;
    return;
  }
  let manifest: RecorderManifest;
  let pluginId: string;
  try {
    manifest = readManifest(manifestPath);
    pluginId = readFigmaPageBridgePluginId(pluginManifestPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[oracle-record] ${detail}`);
    process.exitCode = 2;
    return;
  }
  void record(manifest, pluginId).then(
    (file) => {
      console.log(`[oracle-record] wrote ${path.relative(REPO_ROOT, file)}`);
    },
    (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[oracle-record] ${detail}; no partial oracle entry was kept`,
      );
      process.exitCode = 2;
    },
  );
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  main();
}
