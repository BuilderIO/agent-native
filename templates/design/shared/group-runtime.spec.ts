import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { applyVisualEdit } from "./code-layer";
import {
  ensureGroupRuntime,
  GROUP_RUNTIME_ATTR,
  GROUP_RUNTIME_SOURCE,
} from "./group-runtime";
import { inspectDesignHtmlDocumentIntegrity } from "./html-integrity";

describe("measured flow Group runtime", () => {
  it("keeps measured Frames fixed and runtime-free", () => {
    const patch = applyVisualEdit(
      '<body><span data-agent-native-node-id="label">Label</span></body>',
      {
        kind: "wrapNodes",
        targetIds: ["label"],
        wrapperKind: "frame",
        sizeHints: { label: { width: 38, height: 18, left: 0, top: 0 } },
      },
    );

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('data-an-primitive="frame"');
    expect(patch.content).toContain(
      'style="position: relative; width: 38px; height: 18px;"',
    );
    expect(patch.content).not.toContain(
      "data-agent-native-measured-flow-group",
    );
    expect(patch.content).not.toContain(`<script ${GROUP_RUNTIME_ATTR}`);
  });

  it("grows a Group and its hug parent after a linked text override", async () => {
    const authored = `<!doctype html><html><body><main id="parent" style="display:inline-flex;flex-direction:column;align-items:flex-start"><span data-agent-native-node-id="label" data-agent-native-component-source-node-id="label-source" style="display:inline-block;width:max-content;white-space:nowrap;font:16px Arial">Short</span></main></body></html>`;
    const patch = applyVisualEdit(authored, {
      kind: "wrapNodes",
      targetIds: ["label"],
      sizeHints: { label: { width: 38, height: 18, left: 0, top: 0 } },
    });
    expect(patch.result.status).toBe("applied");
    expect(
      patch.content.match(new RegExp(`<script ${GROUP_RUNTIME_ATTR}\\b`, "g")),
    ).toHaveLength(1);
    expect(ensureGroupRuntime(patch.content)).toBe(patch.content);
    expect(GROUP_RUNTIME_SOURCE).not.toMatch(/<\/script/i);
    expect(inspectDesignHtmlDocumentIntegrity(patch.content)).toEqual({
      valid: true,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(patch.content);
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-agent-native-measured-flow-group]")
            ?.getAttribute("data-agent-native-group-runtime-state") ===
          "active",
      );
      const before = await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>(
          "[data-agent-native-measured-flow-group]",
        )!;
        const parent = document.querySelector<HTMLElement>("#parent")!;
        const child = document.querySelector<HTMLElement>(
          "[data-agent-native-component-source-node-id]",
        )!;
        let styleMutations = 0;
        new MutationObserver((records) => {
          styleMutations += records.filter(
            (record) => record.attributeName === "style",
          ).length;
        }).observe(group, { attributes: true });
        (
          window as typeof window & { __groupStyleMutations?: () => number }
        ).__groupStyleMutations = () => styleMutations;
        return {
          groupWidth: group.getBoundingClientRect().width,
          parentWidth: parent.getBoundingClientRect().width,
          childStyle: child.getAttribute("style"),
        };
      });

      await page.evaluate(() => {
        document.querySelector<HTMLElement>(
          "[data-agent-native-component-source-node-id]",
        )!.textContent = "A substantially longer linked instance label";
      });
      await page.waitForFunction(
        ([groupWidth, parentWidth]) => {
          const group = document.querySelector<HTMLElement>(
            "[data-agent-native-measured-flow-group]",
          )!;
          const parent = document.querySelector<HTMLElement>("#parent")!;
          return (
            group.getBoundingClientRect().width > groupWidth + 100 &&
            parent.getBoundingClientRect().width > parentWidth + 100
          );
        },
        [before.groupWidth, before.parentWidth],
      );
      await page.waitForTimeout(100);
      const settled = await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>(
          "[data-agent-native-measured-flow-group]",
        )!;
        const parent = document.querySelector<HTMLElement>("#parent")!;
        const child = document.querySelector<HTMLElement>(
          "[data-agent-native-component-source-node-id]",
        )!;
        return {
          groupWidth: group.getBoundingClientRect().width,
          parentWidth: parent.getBoundingClientRect().width,
          childStyle: child.getAttribute("style"),
          childText: child.textContent,
          mutations: (
            window as typeof window & { __groupStyleMutations: () => number }
          ).__groupStyleMutations(),
        };
      });
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(() =>
          (
            window as typeof window & {
              __groupStyleMutations: () => number;
            }
          ).__groupStyleMutations(),
        ),
      ).toBe(settled.mutations);
      expect(settled.groupWidth).toBeCloseTo(settled.parentWidth, 1);
      expect(settled.childStyle).toBe(before.childStyle);
      expect(settled.childText).toBe(
        "A substantially longer linked instance label",
      );
      expect(patch.content).toContain(">Short</span>");
    } finally {
      await browser.close();
    }
  });

  it("measures a nested Group under the managed Board surface translation", async () => {
    const html = ensureGroupRuntime(`<!doctype html><html><body>
      <section style="translate:65536px 65536px">
        <div id="group" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px">
          <span style="position:absolute;left:0;top:0;width:80px;height:20px"></span>
        </div>
      </section>
    </body></html>`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      await page.waitForFunction(
        () =>
          document
            .getElementById("group")
            ?.getAttribute("data-agent-native-group-runtime-state") ===
          "active",
      );
      expect(
        await page.evaluate(
          () => document.getElementById("group")!.style.width,
        ),
      ).toBe("80px");
    } finally {
      await browser.close();
    }
  });

  it("keeps unsupported coordinates and sizing at canonical geometry", async () => {
    const html = ensureGroupRuntime(`<!doctype html><html><body>
      <style>.half-width { width: 50%; }</style>
      <div id="negative" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px">
        <span style="position:absolute;left:-20px;top:0;width:80px;height:20px"></span>
        <span style="position:absolute;left:80px;top:0;width:20px;height:20px"></span>
      </div>
      <div style="transform:scale(2)"><div id="scaled" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span style="position:absolute;width:80px;height:20px"></span></div></div>
      <div style="zoom:2"><div id="zoomed" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span style="position:absolute;width:80px;height:20px"></span></div></div>
      <div id="percent" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span style="position:absolute;width:50%;height:20px"></span></div>
      <div id="fill" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span style="position:absolute;flex:1;width:20px;height:20px"></span></div>
      <div id="transform" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span style="position:absolute;transform:translateX(1px);width:20px;height:20px"></span></div>
      <div id="class-percent" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span class="half-width" style="position:absolute;height:20px"></span></div>
    </body></html>`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      await page.waitForFunction(() =>
        [
          "negative",
          "scaled",
          "zoomed",
          "percent",
          "fill",
          "transform",
          "class-percent",
        ].every(
          (id) =>
            document
              .getElementById(id)
              ?.getAttribute("data-agent-native-group-runtime-state") ===
            "unsupported",
        ),
      );
      await page.waitForTimeout(100);
      const before = await page.evaluate(() => ({
        unsupported: [
          "negative",
          "scaled",
          "zoomed",
          "percent",
          "fill",
          "transform",
          "class-percent",
        ].map((id) => document.getElementById(id)!.style.width),
      }));
      await page.waitForTimeout(150);
      expect(before.unsupported).toEqual(Array(7).fill("44px"));
      expect(
        await page.evaluate(() =>
          [
            "negative",
            "scaled",
            "zoomed",
            "percent",
            "fill",
            "transform",
            "class-percent",
          ].map((id) => document.getElementById(id)!.style.width),
        ),
      ).toEqual(before.unsupported);
    } finally {
      await browser.close();
    }
  });

  it("refreshes canonical fallback geometry from source ownership", async () => {
    const html = ensureGroupRuntime(`<!doctype html><html><body>
      <div id="group" data-agent-native-measured-flow-group style="position:relative;width:44px;height:20px"><span id="child" style="position:absolute;width:80px;height:20px"></span></div>
    </body></html>`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      await page.waitForFunction(
        () => document.getElementById("group")!.style.width === "80px",
      );
      await page.evaluate(() => {
        const group = document.getElementById("group") as HTMLElement & {
          __anSourceMeta?: { style: string };
        };
        const sourceStyle = "position:relative;width:72px;height:24px";
        group.__anSourceMeta = { style: sourceStyle };
        group.style.cssText = sourceStyle;
        document.getElementById("child")!.style.width = "50%";
      });
      await page.waitForFunction(
        () =>
          document
            .getElementById("group")
            ?.getAttribute("data-agent-native-group-runtime-state") ===
          "unsupported",
      );
      expect(
        await page.evaluate(() => ({
          width: document.getElementById("group")!.style.width,
          height: document.getElementById("group")!.style.height,
        })),
      ).toEqual({ width: "72px", height: "24px" });
    } finally {
      await browser.close();
    }
  });
});
