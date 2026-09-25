import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const designUrl = process.env.VISUAL_EDIT_DESIGN_URL ?? "http://localhost:8091";
const slidesUrl = process.env.VISUAL_EDIT_SLIDES_URL ?? "http://localhost:8084";
const bridgeUrl = process.env.VISUAL_EDIT_BRIDGE_URL ?? "http://127.0.0.1:7331";
const bridgeToken =
  process.env.VISUAL_EDIT_BRIDGE_TOKEN ?? "visual-edit-runtime-proof-token";
const rootPath =
  process.env.VISUAL_EDIT_ROOT_PATH ??
  path.resolve(import.meta.dirname, "../../slides");
const editorUrl = process.env.VISUAL_EDIT_EDITOR_URL;
const outputDir =
  process.env.VISUAL_EDIT_PROOF_DIR ??
  path.resolve(import.meta.dirname, "../../../.tmp/visual-edit-proof");
const screenPaths = [
  "/home",
  "/home?focus=deck",
  "/templates",
  "/design-systems",
  "/settings",
  "/settings/account",
  "/settings/agent",
  "/settings/agent/resources",
  "/settings/agent/automations",
  "/settings/agent/agents",
  "/settings/integrations",
  "/settings/keys",
  "/settings/mcp",
  "/settings/usage",
  "/settings/organization",
  "/settings/workspace",
  "/settings/labs",
  "/settings/whats-new",
  "/settings/general?tab=language",
  "/settings/general?tab=notifications",
  "/home?onboarding=preview",
  "/home?onboarding=preview&step=choice",
  "/home?onboarding=preview&step=role",
  "/home?onboarding=preview&step=connecting",
  "/home?onboarding=preview&step=extension",
  "/home?onboarding=preview&step=references",
];

type LiveResponse = { url: string; status: number };
type BootSample = {
  elapsedMs: number;
  liveIframes: number;
  snapshots: number;
  placeholders: number;
};

async function main() {
  if (screenPaths.length < 20) {
    throw new Error("The boot proof must exercise at least 20 screens.");
  }
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: process.env.VISUAL_EDIT_HEADLESS !== "0",
  });
  const page = await browser.newPage({
    viewport: { width: 1900, height: 1100 },
  });
  await page.addInitScript({
    content: `(() => {
      const startedAt = performance.now();
      const samples = [];
      Object.defineProperty(window, "__visualEditBootSamples", {
        configurable: false,
        value: samples,
      });
      function sample() {
        samples.push({
          elapsedMs: Math.round(performance.now() - startedAt),
          liveIframes: document.querySelectorAll("iframe[data-design-preview-iframe]").length,
          snapshots: document.querySelectorAll("iframe[data-screen-snapshot]").length,
          placeholders: document.querySelectorAll("[data-screen-placeholder]").length,
        });
      }
      sample();
      window.setInterval(sample, 100);
    })();`,
  });
  const failedRequests: Array<{ url: string; failure: string }> = [];
  const liveResponses: LiveResponse[] = [];
  const consoleErrors: string[] = [];
  let createdDesignId: string | undefined;

  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (request.url().includes("7331") || failure.includes("RESOURCE")) {
      failedRequests.push({ url: request.url(), failure });
    }
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/live-edit?") ||
      response.url().includes("/live-edit-bridge?") ||
      response.url().includes("/snapshot?")
    ) {
      liveResponses.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const postAction = async (name: string, data: Record<string, unknown>) => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/actions/${name}`,
      {
        data,
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Tab": "visual-edit-runtime-proof",
          "X-Agent-Native-Frontend": "1",
        },
      },
    );
    const body = await response.text();
    if (!response.ok()) {
      throw new Error(`${name}: ${response.status()} ${body}`);
    }
    const parsed = body
      ? (JSON.parse(body) as Record<string, unknown>)
      : undefined;
    return parsed;
  };

  try {
    let targetUrl = editorUrl;
    if (!targetUrl) {
      const opened = await postAction("open-visual-edit", {
        title: "Slides live boot budget proof",
        devServerUrl: slidesUrl,
        bridgeUrl,
        bridgeToken,
        rootPath,
        paths: screenPaths,
        publicReadOnly: true,
        navigate: false,
      });
      createdDesignId =
        typeof opened?.designId === "string" ? opened.designId : undefined;
      const urlPath = typeof opened?.urlPath === "string" ? opened.urlPath : "";
      if (!urlPath) throw new Error("open-visual-edit returned no editor URL");
      targetUrl = `${designUrl}${urlPath}&editorView=overview&zoom=18`;
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    await page.reload({ waitUntil: "commit" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const samplerMode = (await page.evaluate(`(() => {
      const samples = window.__visualEditBootSamples || [];
      if (samples.length > 0) return "document-start";
      const startedAt = performance.now();
      if (!window.__visualEditBootSamples) {
        Object.defineProperty(window, "__visualEditBootSamples", {
          configurable: false,
          value: samples,
        });
      }
      function sample() {
        samples.push({
          elapsedMs: Math.round(performance.now() - startedAt),
          liveIframes: document.querySelectorAll("iframe[data-design-preview-iframe]").length,
          snapshots: document.querySelectorAll("iframe[data-screen-snapshot]").length,
          placeholders: document.querySelectorAll("[data-screen-placeholder]").length,
        });
      }
      sample();
      window.setInterval(sample, 100);
      return "post-load-restarted";
    })()`)) as "document-start" | "post-load-restarted";

    const checkpoints: BootSample[] = [];
    let elapsed = 0;
    for (const waitMs of [1_000, 3_000, 6_000, 9_000, 15_000, 30_000, 45_000]) {
      await page.waitForTimeout(waitMs - elapsed);
      elapsed = waitMs;
      const checkpoint = await page.evaluate((targetMs) => {
        type Sample = {
          elapsedMs: number;
          liveIframes: number;
          snapshots: number;
          placeholders: number;
        };
        const browserWindow = window as Window & {
          __visualEditBootSamples?: Sample[];
        };
        const samples = browserWindow.__visualEditBootSamples ?? [];
        return samples.reduce<Sample | undefined>((nearest, sample) => {
          if (!nearest) return sample;
          return Math.abs(sample.elapsedMs - targetMs) <
            Math.abs(nearest.elapsedMs - targetMs)
            ? sample
            : nearest;
        }, undefined);
      }, waitMs);
      if (checkpoint) checkpoints.push(checkpoint);
      if (waitMs === 3_000) {
        await page.screenshot({
          path: `${outputDir}/boot-budget-live-20-plus-early.png`,
          fullPage: true,
        });
      }
    }

    const frameBodies = [];
    for (const frame of page.frames()) {
      if (!frame.url().includes("7331")) continue;
      const bodyText = await frame
        .locator("body")
        .innerText({ timeout: 1_000 });
      frameBodies.push({
        url: frame.url(),
        hasRenderError: /RenderErrorBoundary|Something went wrong/i.test(
          bodyText,
        ),
      });
    }

    const { counts, bootSamples } = await page.evaluate(() => {
      type Sample = {
        elapsedMs: number;
        liveIframes: number;
        snapshots: number;
        placeholders: number;
      };
      const browserWindow = window as Window & {
        __visualEditBootSamples?: Sample[];
      };
      return {
        counts: {
          liveIframes: document.querySelectorAll(
            "iframe[data-design-preview-iframe]",
          ).length,
          snapshots: document.querySelectorAll("iframe[data-screen-snapshot]")
            .length,
          placeholders: document.querySelectorAll("[data-screen-placeholder]")
            .length,
        },
        bootSamples: browserWindow.__visualEditBootSamples ?? [],
      };
    });
    await page.screenshot({
      path: `${outputDir}/boot-budget-live-20-plus.png`,
      fullPage: true,
    });

    const resourceFailures = failedRequests.filter(({ failure }) =>
      failure.includes("INSUFFICIENT_RESOURCES"),
    );
    const renderErrors = frameBodies.filter((frame) => frame.hasRenderError);
    const result = {
      screenCount: screenPaths.length,
      targetUrl,
      counts,
      checkpoints,
      bootSamples: {
        count: bootSamples.length,
        peakPlaceholders: Math.max(
          0,
          ...bootSamples.map((sample) => sample.placeholders),
        ),
      },
      samplerMode,
      liveResponses: {
        total: liveResponses.length,
        ok: liveResponses.filter(({ status }) => status === 200).length,
        nonOk: liveResponses.filter(({ status }) => status !== 200),
      },
      failedRequests,
      resourceFailures,
      renderErrors,
      consoleErrors: consoleErrors.length,
    };
    console.log(JSON.stringify(result, null, 2));
    if (
      counts.placeholders > 0 ||
      counts.liveIframes + counts.snapshots < screenPaths.length ||
      resourceFailures.length > 0 ||
      renderErrors.length > 0 ||
      result.liveResponses.nonOk.length > 0
    ) {
      throw new Error(
        "Visual-edit runtime proof did not drain every frame cleanly.",
      );
    }
  } finally {
    if (createdDesignId) {
      try {
        await postAction("delete-design", { id: createdDesignId });
      } catch (error) {
        console.warn("visual-edit proof cleanup failed", error);
      }
    }
    await browser.close();
  }
}

await main();
