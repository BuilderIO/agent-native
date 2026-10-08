import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_MARKER = "AN-ORACLE-PROBE:fig.inspector.build-plugin";

describe("build-figma-oracle-page-bridge", () => {
  it("embeds the generated UI and exports only the selected Figma probe", async () => {
    const outputDir = mkdtempSync(
      path.join(os.tmpdir(), "figma-oracle-bridge-"),
    );
    const manifestPath = path.join(outputDir, "manifest.json");
    try {
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ id: "123456789012" }, null, 2)}\n`,
      );
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "scripts/build-figma-oracle-page-bridge.ts",
          "--manifest",
          manifestPath,
        ],
        { cwd: ROOT, stdio: "pipe" },
      );

      const pluginSource = readFileSync(
        path.join(outputDir, "plugin.js"),
        "utf8",
      );
      const builtHtml = readFileSync(path.join(outputDir, "ui.html"), "utf8");
      assert.doesNotMatch(pluginSource, /\b__html__\b/);

      const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const exportSettings: unknown[] = [];
      const messages: Array<Record<string, unknown>> = [];
      const selectedNode = {
        name: PROBE_MARKER,
        async exportAsync(settings: unknown) {
          exportSettings.push(settings);
          return png;
        },
      };
      const figma: any = {
        currentPage: {
          id: "page-1",
          name: "oracle-probes",
          selection: [selectedNode],
        },
        showUI(html: string) {
          figma.uiHtml = html;
        },
        on() {},
        ui: {
          onmessage: null,
          postMessage(message: Record<string, unknown>) {
            messages.push(message);
          },
        },
      };

      runInNewContext(pluginSource, { figma, Uint8Array });
      assert.equal(figma.uiHtml, builtHtml);
      assert.match(builtHtml, /123456789012/);
      const handler = figma.ui.onmessage as
        | ((message: unknown) => Promise<void>)
        | null;
      assert.ok(handler);
      await handler({
        type: "export-selected-probe",
        requestId: "request-1",
        marker: PROBE_MARKER,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(exportSettings)), [
        {
          format: "PNG",
          constraint: { type: "WIDTH", value: 1200 },
          contentsOnly: true,
        },
      ]);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].type, "selected-probe");
      assert.equal(messages[0].requestId, "request-1");
      assert.equal(messages[0].marker, PROBE_MARKER);
      assert.deepEqual(
        Array.from(messages[0].png as number[]),
        Array.from(png),
      );

      figma.currentPage.selection = [{ name: "a different layer" }];
      await handler({
        type: "export-selected-probe",
        requestId: "request-2",
        marker: PROBE_MARKER,
      });
      assert.equal(exportSettings.length, 1);
      assert.equal(messages[1].type, "selected-probe");
      assert.equal(messages[1].requestId, "request-2");
      assert.equal(
        messages[1].error,
        "Figma must select exactly the marked oracle probe layer before recording",
      );
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
