import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

type Box = { left: number; top: number; width: number; height: number };

const box = (id: string, b: Box) =>
  `<div data-agent-native-node-id="${id}" style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;background:#ccc"></div>`;

async function measure(hovered: Box) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${box("hovered", hovered)}${box(
        "selected",
        { left: 200, top: 200, width: 200, height: 120 },
      )}</body></html>`,
    );
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="selected"]',
        },
        "*",
      );
    });
    await page.waitForTimeout(50);
    const point = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="hovered"]',
      )!;
      const r = el.getBoundingClientRect();
      const selected = document
        .querySelector('[data-agent-native-node-id="selected"]')!
        .getBoundingClientRect();
      const margin = 16;
      for (let y = r.top + 4; y < r.bottom - 4; y += 4) {
        for (let x = r.left + 4; x < r.right - 4; x += 4) {
          const inside =
            x > selected.left - margin &&
            x < selected.right + margin &&
            y > selected.top - margin &&
            y < selected.bottom + margin;
          if (!inside) return { x, y };
        }
      }
      return { x: r.left + 2, y: r.top + 2 };
    });
    await page.keyboard.down("Alt");
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await page.waitForTimeout(50);
    return await page.evaluate(() => {
      const overlay = document.querySelector(
        "[data-agent-native-measurement-overlay]",
      )!;
      const nodes = [...overlay.children] as HTMLElement[];
      return {
        labels: nodes
          .map((n) => n.textContent)
          .filter(Boolean)
          .sort(),
        dashed: nodes.filter((n) => n.style.cssText.includes("dashed")).length,
      };
    });
  } finally {
    await browser.close();
  }
}

async function measureAfterSelectedElementMoves() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${box("hovered", {
        left: 519,
        top: 400,
        width: 200,
        height: 120,
      })}${box("selected", {
        left: 200,
        top: 200,
        width: 200,
        height: 120,
      })}</body></html>`,
    );
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="selected"]',
        },
        "*",
      );
    });
    await page.waitForTimeout(50);
    await page.keyboard.down("Alt");
    await page.mouse.move(520, 410, { steps: 3 });
    await page.waitForTimeout(50);

    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-agent-native-node-id="selected"]')!
        .style.setProperty("top", "220px");
    });
    await page.waitForFunction(
      () => {
        const overlay = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        return [...(overlay?.children ?? [])].some(
          (node) => node.textContent === "60",
        );
      },
      undefined,
      { timeout: 5_000 },
    );

    return await page.evaluate(() => {
      const overlay = document.querySelector(
        "[data-agent-native-measurement-overlay]",
      )!;
      const nodes = [...overlay.children] as HTMLElement[];
      return {
        labels: nodes
          .map((node) => node.textContent)
          .filter(Boolean)
          .sort(),
        dashed: nodes.filter((node) => node.style.cssText.includes("dashed"))
          .length,
      };
    });
  } finally {
    await browser.close();
  }
}

async function measureAfterHoveredElementMoves() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${box("hovered", {
        left: 519,
        top: 400,
        width: 200,
        height: 120,
      })}${box("selected", {
        left: 200,
        top: 200,
        width: 200,
        height: 120,
      })}</body></html>`,
    );
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="selected"]',
        },
        "*",
      );
    });
    await page.waitForTimeout(50);
    await page.keyboard.down("Alt");
    await page.mouse.move(520, 410, { steps: 3 });
    await page.waitForTimeout(50);

    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-agent-native-node-id="hovered"]')!
        .style.setProperty("top", "420px");
    });
    await page.waitForFunction(
      () => {
        const overlay = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        return [...(overlay?.children ?? [])].some(
          (node) => node.textContent === "100",
        );
      },
      undefined,
      { timeout: 5_000 },
    );

    return await page.evaluate(() => {
      const overlay = document.querySelector(
        "[data-agent-native-measurement-overlay]",
      )!;
      const nodes = [...overlay.children] as HTMLElement[];
      return {
        labels: nodes
          .map((node) => node.textContent)
          .filter(Boolean)
          .sort(),
        dashed: nodes.filter((node) => node.style.cssText.includes("dashed"))
          .length,
      };
    });
  } finally {
    await browser.close();
  }
}

async function measureAfterEditorModeStarts(
  mode: "read-only-message" | "interaction-mode-message" | "read-only-config",
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${box("hovered", {
        left: 519,
        top: 400,
        width: 200,
        height: 120,
      })}${box("selected", {
        left: 200,
        top: 200,
        width: 200,
        height: 120,
      })}</body></html>`,
    );
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="selected"]',
        },
        "*",
      );
    });
    await page.waitForTimeout(50);
    await page.keyboard.down("Alt");
    await page.mouse.move(520, 410, { steps: 3 });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>(
          "[data-agent-native-measurement-overlay]",
        )?.style.display === "block",
    );
    await page.evaluate(() => {
      const selected = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="selected"]',
      )!;
      const hovered = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="hovered"]',
      )!;
      const reads = { selected: 0, hovered: 0 };
      const isMeasurementRead = () =>
        (new Error().stack || "").includes("currentMeasurementGeometry");
      const selectedGetBoundingClientRect =
        selected.getBoundingClientRect.bind(selected);
      const hoveredGetBoundingClientRect =
        hovered.getBoundingClientRect.bind(hovered);
      selected.getBoundingClientRect = () => {
        if (isMeasurementRead()) reads.selected += 1;
        return selectedGetBoundingClientRect();
      };
      hovered.getBoundingClientRect = () => {
        if (isMeasurementRead()) reads.hovered += 1;
        return hoveredGetBoundingClientRect();
      };
      (window as any).__measurementGeometryReads = reads;
    });
    if (mode === "read-only-message") {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const onMessage = (event: MessageEvent) => {
              if (event.data?.type !== "set-read-only") return;
              window.removeEventListener("message", onMessage);
              resolve();
            };
            window.addEventListener("message", onMessage);
            window.postMessage({ type: "set-read-only", readOnly: true }, "*");
          }),
      );
    } else if (mode === "interaction-mode-message") {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const onMessage = (event: MessageEvent) => {
              if (event.data?.type !== "set-interaction-mode") return;
              window.removeEventListener("message", onMessage);
              resolve();
            };
            window.addEventListener("message", onMessage);
            window.postMessage(
              { type: "set-interaction-mode", interact: true },
              "*",
            );
          }),
      );
    } else {
      await page.evaluate(() =>
        (window as any).__anEditorChromeBridgeInstance.updateConfig({
          readOnly: true,
        }),
      );
    }
    const readsAfterModeStarts = await page.evaluate(() => ({
      ...(window as any).__measurementGeometryReads,
    }));
    const overlayAfterModeStarts = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>(
        "[data-agent-native-measurement-overlay]",
      )!;
      return {
        display: overlay.style.display,
        children: overlay.childElementCount,
      };
    });
    await page.waitForTimeout(80);

    return await page
      .evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          "[data-agent-native-measurement-overlay]",
        )!;
        return {
          display: overlay.style.display,
          children: overlay.childElementCount,
          reads: (window as any).__measurementGeometryReads,
        };
      })
      .then((result) => ({
        ...result,
        readsAfterModeStarts,
        overlayAfterModeStarts,
      }));
  } finally {
    await browser.close();
  }
}

describe("Alt-hover measurement", () => {
  it("shows both gaps with dashed runs to a diagonal neighbour", async () => {
    expect(
      await measure({ left: 519, top: 400, width: 200, height: 120 }),
    ).toEqual({ labels: ["119", "80"], dashed: 2 });
  });

  it("shows the reaching side and the gap for a box below", async () => {
    expect(
      await measure({ left: 250, top: 410, width: 300, height: 80 }),
    ).toEqual({ labels: ["150", "90"], dashed: 1 });
  });

  it("shows all four insets for an enclosing box", async () => {
    expect(
      await measure({ left: 50, top: 60, width: 600, height: 450 }),
    ).toEqual({ labels: ["140", "150", "190", "250"], dashed: 0 });
  });

  it("shows every differing side for an intersecting box", async () => {
    expect(
      await measure({ left: 350, top: 280, width: 200, height: 120 }),
    ).toEqual({ labels: ["150", "150", "80", "80"], dashed: 0 });
  });

  it("updates the measurements after the selected element moves", async () => {
    expect(await measureAfterSelectedElementMoves()).toEqual({
      labels: ["119", "60"],
      dashed: 2,
    });
  });

  it("updates the measurements after the hovered element moves", async () => {
    expect(await measureAfterHoveredElementMoves()).toEqual({
      labels: ["100", "119"],
      dashed: 2,
    });
  });

  it.each([
    "read-only-message",
    "interaction-mode-message",
    "read-only-config",
  ] as const)("clears measurements when %s starts", async (mode) => {
    const result = await measureAfterEditorModeStarts(mode);

    expect(result.overlayAfterModeStarts).toEqual({
      display: "none",
      children: 0,
    });
    expect(result.display).toBe("none");
    expect(result.children).toBe(0);
    expect(result.reads).toEqual(result.readsAfterModeStarts);
  });
}, 60_000);
