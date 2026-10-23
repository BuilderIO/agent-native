import { createServer } from "node:http";

import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";

it.each(["direct", "runtime"])(
  "%s export recovers opaque stylesheet CSSOM through resource inlining",
  { timeout: 30_000 },
  async (mode) => {
    let unavailable = false;
    const server = createServer((request, response) => {
      if (request.url === "/theme.css") {
        response.writeHead(unavailable ? 503 : 200, {
          "content-type": "text/css",
          "access-control-allow-origin": "*",
        });
        response.end("#promo { color: rgb(12, 34, 56); font-size: 32px; }");
      } else {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html><html><head>
<link rel="stylesheet" href="http://localhost:${(server.address() as { port: number }).port}/theme.css">
</head><body><h1 id="promo">Local promo fixture</h1></body></html>`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
      );
      expect(
        await page
          .locator("#promo")
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe("rgb(12, 34, 56)");
      expect(
        await page.evaluate(() => {
          try {
            document.styleSheets[0]!.cssRules;
            return null;
          } catch (error) {
            return (error as DOMException).name;
          }
        }),
      ).toBe("SecurityError");

      const exporter = await build({
        stdin: {
          contents:
            'export { preserveLiveStylesheets } from "./app/pages/design-editor/png-export-render";',
          resolveDir: process.cwd(),
        },
        bundle: true,
        platform: "browser",
        format: "iife",
        globalName: "exportResources",
        write: false,
        logLevel: "silent",
        define: {
          "process.env.NODE_ENV": '"production"',
          "import.meta.env": "{}",
        },
      });
      await page.addScriptTag({ content: exporter.outputFiles[0]!.text });
      await page.evaluate(() => {
        (window as any).__snapshots = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:runtime-layer-snapshot")
            (window as any).__snapshots.push(event.data.payload.html);
          if (
            event.data?.type ===
            "agent-native:runtime-layer-snapshot-reservation-request"
          )
            window.postMessage(
              {
                type: "grant-runtime-layer-snapshot-reservation",
                requestId: event.data.requestId,
                documentId: event.data.documentId,
                reservationToken: "local-export-fixture",
              },
              "*",
            );
        });
      });
      await page.addScriptTag({
        content: editorChromeBridgeScript
          .replace("__READ_ONLY__", "false")
          .replace("__TEXT_EDITING_ENABLED__", "false")
          .replace("__EDITOR_CHROME_SCALE_X__", "1")
          .replace("__EDITOR_CHROME_SCALE_Y__", "1")
          .replace("__DESIGN_CANVAS_SCREEN_ID__", '"export-fixture"')
          .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
          .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
          .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
          .replace(
            "__RUNTIME_LAYER_SNAPSHOT_ENABLED__",
            String(mode === "runtime"),
          )
          .replace(/__INITIAL_SOURCE_HEAD__/g, '""'),
      });
      if (mode === "runtime")
        await page.waitForFunction(
          () => (window as any).__snapshots.length > 0,
        );

      const serialized = await page.evaluate(async (mode) => {
        if (mode === "runtime") return (window as any).__snapshots[0] as string;
        const iframe = document.createElement("iframe");
        const ready = new Promise<void>(
          (resolve) => (iframe.onload = () => resolve()),
        );
        iframe.srcdoc = `<!doctype html><html><head>${document.querySelector("link[rel=stylesheet]")!.outerHTML}</head><body><h1 id="promo">Local promo fixture</h1></body></html>`;
        document.body.appendChild(iframe);
        await ready;
        const source = iframe.contentDocument!;
        const clone = source.cloneNode(true) as Document;
        (window as any).exportResources.preserveLiveStylesheets(source, clone);
        return "<!doctype html>" + clone.documentElement.outerHTML;
      }, mode);
      const inlined = await page.evaluate(async (html) => {
        const result = await (
          window as any
        ).__anEditorChromeBridgeInstance.inlineExportResources(html);
        return result as {
          html: string;
          complete: boolean;
          errorCode?: string;
        };
      }, serialized);
      expect(inlined.complete).toBe(true);
      expect(
        await page.evaluate(
          (html) =>
            new DOMParser()
              .parseFromString(html, "text/html")
              .documentElement.getAttribute(
                "data-agent-native-export-resource-failures",
              ),
          inlined.html,
        ),
      ).toBeNull();
      const rendered = await browser.newPage({ javaScriptEnabled: false });
      const external: string[] = [];
      await rendered.route("**/*", (route) => {
        external.push(route.request().url());
        return route.abort();
      });
      await rendered.setContent(inlined.html);
      expect(
        await rendered
          .locator("#promo")
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe("rgb(12, 34, 56)");
      expect(external).toEqual([]);

      unavailable = true;
      const rejected = await page.evaluate(async () => {
        const html = `<!doctype html><html><head>${document.querySelector("link[rel=stylesheet]")!.outerHTML}</head><body></body></html>`;
        return await (
          window as any
        ).__anEditorChromeBridgeInstance.inlineExportResources(html);
      });
      expect(rejected.complete).toBe(false);
      expect(rejected.errorCode).toBe("export_resources_unavailable");
      expect(rejected.html).toContain("stylesheet-link");
      const rechecked = await page.evaluate(async (html) => {
        return await (
          window as any
        ).__anEditorChromeBridgeInstance.inlineExportResources(html);
      }, rejected.html);
      expect(rechecked.complete).toBe(false);
      expect(rechecked.errorCode).toBe("export_resources_unavailable");
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
