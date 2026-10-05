import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PDFParse } from "pdf-parse";

import { comparePngs } from "../scripts/figma-fidelity/lib/compare";

test.use({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Parity Inter";
        font-style: normal;
        font-weight: 100 900;
        font-display: swap;
        src: url("/inter.woff2") format("woff2");
      }
      html, body { box-sizing: border-box; width: 360px; height: 240px; margin: 0; overflow: hidden; }
      html { background: linear-gradient(135deg, #fef3c7 0 50%, #dbeafe 50% 100%); }
      body { color: #182230; font: 400 16px/1.65 "Parity Inter", sans-serif; }
      main { box-sizing: border-box; width: 360px; height: 240px; padding: 20px; }
      h1 { margin: 0 0 8px; font-size: 25px; font-weight: 700; line-height: 1.24; letter-spacing: -0.55px; }
      p { margin: 0 0 7px; }
      .two-line { width: 304px; font-size: 16px; line-height: 1.8; }
      .small { font-size: 12px; font-weight: 600; letter-spacing: 0.2px; }
    </style>
    <title>Single-screen PDF font parity</title>
  </head>
  <body>
    <main>
      <h1>Wide Willow &amp; Wrenfield</h1>
      <p class="two-line">Sphinx of black quartz, judge my vow. Fonts change line wraps and the space between these two lines.</p>
      <p class="small">AV 0123456789 · office · affine · fjord</p>
    </main>
    <script>
      document.fonts.ready.then(() => {
        document.documentElement.dataset.exportFontReady = String(document.fonts.check('400 16px "Parity Inter"'));
      });
    </script>
  </body>
</html>`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readDownload(page: Page, click: () => Promise<unknown>) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`${download.suggestedFilename()} had no bytes`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function firstPdfPagePng(pdf: Buffer) {
  const parser = new PDFParse({ data: pdf });
  try {
    const rendered = await parser.getScreenshot({
      desiredWidth: 720,
      partial: [1],
      imageBuffer: true,
      imageDataUrl: false,
    });
    const page = rendered.pages[0]?.data;
    if (!page) throw new Error("single-screen PDF had no rendered page");
    return Buffer.from(page);
  } finally {
    await parser.destroy();
  }
}

test("single-screen PDF download preserves localhost source pixels", async ({
  page: basePage,
  browser,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("test baseURL is unavailable");
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "design-export-pdf-"));
  const publicPath = path.join(rootPath, "public");
  fs.mkdirSync(publicPath);
  fs.writeFileSync(path.join(rootPath, "index.html"), HTML);
  fs.copyFileSync(
    path.resolve(
      process.cwd(),
      "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    ),
    path.join(publicPath, "inter.woff2"),
  );
  fs.writeFileSync(
    path.join(rootPath, "vite.config.ts"),
    "export default { server: { cors: true } };\n",
  );

  const sourcePort = await freePort();
  const sourceUrl = `http://127.0.0.1:${sourcePort}`; // e2e-harness-ignore: ephemeral source server uses its own port.
  let vite: ReturnType<typeof spawn> | null = null;
  let bridge: DesignConnectBridge | null = null;
  let designId: string | null = null;
  let cdp: { detach: () => Promise<void> } | null = null;
  let sourcePage: Page | null = null;
  fs.mkdirSync(path.resolve(process.cwd(), ".tmp/design-export-parity"), {
    recursive: true,
  });
  const artifactPath = fs.mkdtempSync(
    path.resolve(process.cwd(), ".tmp/design-export-parity/single-screen-pdf-"),
  );

  try {
    const viteEntrypoint = path.resolve(
      path.dirname(createRequire(import.meta.url).resolve("vite")),
      "../../bin/vite.js",
    );
    vite = spawn(
      process.execPath,
      [
        viteEntrypoint,
        "--host",
        "127.0.0.1",
        "--port",
        String(sourcePort),
        "--strictPort",
      ],
      { cwd: rootPath, stdio: ["ignore", "pipe", "pipe"] },
    );
    let viteError = "";
    vite.stderr?.on("data", (chunk) => (viteError += String(chunk)));
    await expect
      .poll(
        async () => {
          if (vite?.exitCode !== null) {
            throw new Error(`Vite exited with ${vite?.exitCode}: ${viteError}`);
          }
          return (await fetch(sourceUrl).catch(() => null))?.ok ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: sourceUrl,
      port: await freePort(),
    });
    const opened = (await postAction(request, baseURL, "open-visual-edit", {
      title: "Single-screen PDF font parity",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      routes: [
        {
          path: "/",
          url: sourceUrl,
          title: "Font screen",
          width: 360,
          height: 240,
        },
      ],
      navigate: false,
      publicReadOnly: false,
    })) as { designId: string; bridgeToken: string; previewToken: string };
    designId = opened.designId;
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });

    const exportPage = basePage;
    const cdpSession = await basePage.context().newCDPSession(exportPage);
    cdp = cdpSession;
    await cdpSession.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await exportPage.goto(
      `${baseURL}/visual-edit/${designId}?editorView=overview`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await expect(exportPage.locator("[data-design-editor]")).toBeVisible({
      timeout: 45_000,
    });
    const allowLocalAccess = exportPage.getByRole("button", {
      name: "Allow local access",
    });
    if (await allowLocalAccess.isVisible().catch(() => false)) {
      await allowLocalAccess.click();
    }

    const iframe = exportPage.locator(
      'iframe[data-design-preview-iframe][data-design-source-type="localhost"]',
    );
    await expect(iframe).toHaveCount(1, { timeout: 30_000 });
    await expect
      .poll(() =>
        iframe
          .contentFrame()
          .locator("html")
          .getAttribute("data-export-font-ready"),
      )
      .toBe("true");

    sourcePage = await basePage.context().newPage();
    await sourcePage.setViewportSize({ width: 360, height: 240 });
    await sourcePage.goto(sourceUrl);
    await expect
      .poll(() =>
        sourcePage!.locator("html").getAttribute("data-export-font-ready"),
      )
      .toBe("true");
    const sourcePng = await sourcePage.locator("html").screenshot({
      animations: "disabled",
      omitBackground: true,
    });

    await exportPage
      .locator("[data-frame-title]")
      .first()
      .click({ force: true });
    await expect(exportPage.locator("[data-frame-selection-box]")).toHaveCount(
      1,
    );
    const rightPanel = exportPage.locator(
      '[data-design-chrome-region="right-panel"]',
    );
    await expect(
      rightPanel.getByRole("button", { name: "Export", exact: true }),
    ).toBeVisible();
    const formatSelect = rightPanel
      .getByRole("combobox")
      .filter({ hasText: "PNG" });
    await formatSelect.click();
    await exportPage.getByRole("option", { name: "PDF", exact: true }).click();

    const pdf = await readDownload(exportPage, () =>
      rightPanel.getByRole("button", { name: "Export", exact: true }).click(),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect([
      ...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[/g),
    ]).toHaveLength(1);
    const pdfPng = await firstPdfPagePng(pdf);
    const diff = await comparePngs(browser, sourcePng, pdfPng, {
      threshold: 0,
    });

    fs.writeFileSync(path.join(artifactPath, "live-source.png"), sourcePng);
    fs.writeFileSync(path.join(artifactPath, "single-screen.pdf"), pdf);
    fs.writeFileSync(path.join(artifactPath, "pdf-page.png"), pdfPng);
    fs.writeFileSync(path.join(artifactPath, "diff.png"), diff.diffPng);
    console.info(
      `[single-screen-pdf-fidelity] reference=${JSON.stringify(diff.reference)} candidate=${JSON.stringify(diff.candidate)} diffRatio=${diff.diffRatio} maxDelta=${diff.maxDelta}`,
    );
    expect(diff.dimensionMismatch).toBe(false);
    expect(diff.diffRatio).toBe(0);
  } finally {
    await sourcePage?.close().catch(() => undefined);
    if (cdp) await cdp.detach().catch(() => undefined);
    await bridge?.server.close();
    if (vite && vite.exitCode === null) {
      vite.kill();
      await new Promise<void>((resolve) => vite?.once("exit", () => resolve()));
    }
    if (designId) {
      await postAction(request, baseURL, "delete-design", {
        id: designId,
      }).catch((error) =>
        console.error("single-screen PDF fixture cleanup failed", error),
      );
    }
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
