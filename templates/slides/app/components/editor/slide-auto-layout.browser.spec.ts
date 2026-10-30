import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Host = typeof import("./slide-auto-layout");

declare global {
  interface Window {
    slideAutoLayout: Host;
  }
}

const EDITOR_DIR = path.dirname(fileURLToPath(import.meta.url));
const SLIDES_ROOT = path.resolve(EDITOR_DIR, "../../..");

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({ channel: "chrome", headless: true });
    } catch (channelError) {
      throw new Error(
        [
          "Could not launch Chromium for the slide auto layout E2E.",
          `Bundled Chromium error: ${String(bundledError).split("\n")[0]}`,
          `Chrome channel error: ${String(channelError).split("\n")[0]}`,
        ].join("\n"),
      );
    }
  }
}

/** The auto layout module as one browser script, bundled from source. */
async function bundleHost(): Promise<string> {
  const result = await build({
    configFile: false,
    root: SLIDES_ROOT,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: {
      alias: {
        "@": path.join(SLIDES_ROOT, "app"),
        "@shared": path.join(SLIDES_ROOT, "shared"),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(EDITOR_DIR, "slide-auto-layout.ts"),
        name: "slideAutoLayout",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const bundle = outputs.find((output) => "output" in output);
  const chunk = bundle && "output" in bundle ? bundle.output[0] : undefined;
  if (!chunk) throw new Error("The slide auto layout host did not bundle.");
  return chunk.code;
}

// A slide scaled to half size, as the editor shows it: layout px and screen
// px differ, which is where a measurement in the wrong space would show.
const pageHtml = (body: string) => `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font: 16px/20px sans-serif; }
      .fmd-slide { position: relative; width: 960px; height: 540px; transform: scale(0.5); transform-origin: 0 0; }
      .fmd-slide-group > div { background: #ccc; }
    </style>
  </head>
  <body><div class="fmd-slide">${body}</div></body>
</html>`;

const GROUP = `<div class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group"
  style="position: absolute; left: 120px; top: 80px; width: 420px; height: 120px; box-sizing: border-box;">
  <div data-slide-object-id="third" style="position: absolute; left: 290px; top: 30px; width: 110px; height: 60px;"></div>
  <div data-slide-object-id="first" style="position: absolute; left: 20px; top: 30px; width: 110px; height: 60px;"></div>
  <div class="fmd-text-box" data-slide-object-id="second" style="position: absolute; left: 155px; top: 30px; width: 110px;">Revenue grew</div>
</div>`;

let browser: Browser;
let hostScript: string;

beforeAll(async () => {
  [browser, hostScript] = await Promise.all([launchBrowser(), bundleHost()]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function openPage(body = GROUP): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(pageHtml(body));
  await page.addScriptTag({ content: hostScript });
  return page;
}

type Rects = Record<
  string,
  { left: number; top: number; width: number; height: number }
>;

const memberRects = (page: Page) =>
  page.evaluate(() => {
    const rects: Record<
      string,
      { left: number; top: number; width: number; height: number }
    > = {};
    for (const member of Array.from(
      document.querySelectorAll<HTMLElement>(
        ".fmd-slide-group > [data-slide-object-id]",
      ),
    )) {
      const { left, top, width, height } = member.getBoundingClientRect();
      rects[member.dataset.slideObjectId!] = { left, top, width, height };
    }
    return rects;
  });

function expectSameRects(actual: Rects, expected: Rects) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [id, rect] of Object.entries(expected)) {
    for (const key of ["left", "top", "width", "height"] as const) {
      expect(actual[id]![key], `${id} ${key}`).toBeCloseTo(rect[key], 0);
    }
  }
}

describe("slide group auto layout in Chromium", () => {
  it("turns on without moving any member, then off without moving any", async () => {
    const page = await openPage();
    const before = await memberRects(page);

    const enabled = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      return {
        result,
        style: group.getAttribute("style"),
        order: Array.from(group.children, (child) =>
          child.getAttribute("data-slide-object-id"),
        ),
      };
    });
    expect(enabled.result).toEqual({ status: "applied" });
    expect(enabled.order).toEqual(["first", "second", "third"]);
    expect(enabled.style).toContain("display: flex");
    expect(enabled.style).toContain("gap: 25px");
    expect(enabled.style).toContain("padding: 30px 20px");
    expectSameRects(await memberRects(page), before);

    const disabled = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const result = window.slideAutoLayout.disableSlideGroupAutoLayout(group);
      const text = group.querySelector<HTMLElement>(".fmd-text-box")!;
      return {
        result,
        textHeight: text.style.height,
        textLeft: text.style.left,
      };
    });
    expect(disabled).toEqual({
      result: { status: "applied" },
      textHeight: "",
      textLeft: "155px",
    });
    expectSameRects(await memberRects(page), before);
    await page.close();
  });

  it("refuses to turn off while a member in flow is not rendered", async () => {
    const page = await openPage();
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      group
        .querySelector<HTMLElement>('[data-slide-object-id="third"]')!
        .style.setProperty("display", "none");
      const before = group.outerHTML;
      const result = window.slideAutoLayout.disableSlideGroupAutoLayout(group);
      return { result, untouched: group.outerHTML === before };
    });
    expect(outcome).toEqual({
      result: { status: "refused", reason: "unmeasured", objectIds: ["third"] },
      untouched: true,
    });
    await page.close();
  });

  it("keeps a Fill member at its pinned size when auto layout turns off and on again", async () => {
    const page = await openPage();
    const filled = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const first = group.querySelector<HTMLElement>(
        '[data-slide-object-id="first"]',
      )!;
      api.setSlideLayoutSizing(first, "horizontal", "fill");
      api.disableSlideGroupAutoLayout(group);
      // Room to spare on the right, which a stale flex-grow would take.
      group.style.width = "520px";
      return first.style.flexGrow;
    });
    expect(filled).toBe("");
    const before = await memberRects(page);
    await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      window.slideAutoLayout.enableSlideGroupAutoLayout(group);
    });
    expectSameRects(await memberRects(page), before);
    await page.close();
  });

  it("pins a text member's Fill height when auto layout turns off", async () => {
    const page = await openPage();
    const heights = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const second = group.querySelector<HTMLElement>(
        '[data-slide-object-id="second"]',
      )!;
      api.setSlideLayoutSizing(second, "vertical", "fill");
      const filled = second.offsetHeight;
      api.disableSlideGroupAutoLayout(group);
      return { filled, pinned: second.offsetHeight };
    });
    expect(heights.filled).toBe(60);
    expect(heights.pinned).toBe(60);
    await page.close();
  });

  it("reorders along the row when its members differ in height", async () => {
    const page =
      await openPage(`<div class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group"
  style="position: absolute; left: 120px; top: 80px; width: 420px; height: 160px; box-sizing: border-box; display: flex; gap: 25px; padding: 20px; align-items: flex-start;">
  <div data-slide-object-id="tall" style="width: 110px; height: 120px; flex-shrink: 0;"></div>
  <div data-slide-object-id="middle" style="width: 110px; height: 60px; flex-shrink: 0;"></div>
  <div data-slide-object-id="short" style="width: 110px; height: 20px; flex-shrink: 0;"></div>
</div>`);
    const order = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const tall = group.querySelector<HTMLElement>(
        '[data-slide-object-id="tall"]',
      )!;
      const short = group
        .querySelector<HTMLElement>('[data-slide-object-id="short"]')!
        .getBoundingClientRect();
      // Just short of the last member along the row, well above the row.
      const index = api.resolveSlideFlowInsertionIndex(group, tall, {
        x: short.left + short.width / 2 - 5,
        y: short.top + short.height / 2 - 100,
      });
      api.moveSlideFlowMember(group, tall, index);
      return Array.from(group.children, (child) =>
        child.getAttribute("data-slide-object-id"),
      );
    });
    expect(order).toEqual(["middle", "tall", "short"]);
    await page.close();
  });

  it("reorders a member to the slot under the pointer", async () => {
    const page = await openPage();
    const order = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const first = group.querySelector<HTMLElement>(
        '[data-slide-object-id="first"]',
      )!;
      const third = group.querySelector<HTMLElement>(
        '[data-slide-object-id="third"]',
      )!;
      const target = third.getBoundingClientRect();
      const index = api.resolveSlideFlowInsertionIndex(group, first, {
        x: target.right - 2,
        y: target.top + target.height / 2,
      });
      api.moveSlideFlowMember(group, first, index);
      return Array.from(group.children, (child) =>
        child.getAttribute("data-slide-object-id"),
      );
    });
    expect(order).toEqual(["second", "third", "first"]);
    await page.close();
  });

  it("reorders along a rotated group's own direction", async () => {
    const page = await openPage();
    const order = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      // The row now runs down the screen.
      group.style.transform = "rotate(90deg)";
      const first = group.querySelector<HTMLElement>(
        '[data-slide-object-id="first"]',
      )!;
      const third = group
        .querySelector<HTMLElement>('[data-slide-object-id="third"]')!
        .getBoundingClientRect();
      const index = api.resolveSlideFlowInsertionIndex(group, first, {
        x: third.left + third.width / 2,
        y: third.bottom - 2,
      });
      api.moveSlideFlowMember(group, first, index);
      return Array.from(group.children, (child) =>
        child.getAttribute("data-slide-object-id"),
      );
    });
    expect(order).toEqual(["second", "third", "first"]);
    await page.close();
  });

  it("turns back on after members moved to the edge without keeping the old padding", async () => {
    const page = await openPage();
    const before = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      group.style.justifyContent = "center";
      api.disableSlideGroupAutoLayout(group);
      const members = ["first", "second", "third"].map(
        (id) =>
          group.querySelector<HTMLElement>(`[data-slide-object-id="${id}"]`)!,
      );
      members.forEach((member, index) => {
        member.style.left = `${index * 140}px`;
        member.style.top = "0px";
      });
      // The last member reaches the far edge, so the inferred padding is 0.
      members[2]!.style.width = `${420 - 280}px`;
      members[1]!.style.height = "120px";
      return group.style.padding;
    });
    expect(before).toBe("30px 20px");
    const rects = await memberRects(page);
    const style = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      return {
        padding: group.style.padding,
        justifyContent: group.style.justifyContent,
      };
    });
    expect(style).toEqual({ padding: "0px", justifyContent: "flex-start" });
    expectSameRects(await memberRects(page), rects);
    await page.close();
  });

  it("keeps each member's sizing on its own axis when the direction turns", async () => {
    const page = await openPage();
    const result = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const first = group.querySelector<HTMLElement>(
        '[data-slide-object-id="first"]',
      )!;
      api.setSlideLayoutSizing(first, "horizontal", "fill");
      const before = api.readSlideLayoutSizing(first)?.sizing;
      const outcome = api.updateSlideAutoLayoutFrame(group, {
        direction: "vertical",
      });
      return {
        outcome,
        before,
        after: api.readSlideLayoutSizing(first)?.sizing,
        width: first.offsetWidth,
        height: first.offsetHeight,
        contentWidth: group.clientWidth - 40,
      };
    });
    expect(result.outcome).toEqual({ status: "applied" });
    expect(result.before).toEqual({ horizontal: "fill", vertical: "fixed" });
    expect(result.after).toEqual(result.before);
    expect(result.width).toBe(result.contentWidth);
    expect(result.height).toBe(60);
    await page.close();
  });

  it("keeps members at their size when the group gets too small for them", async () => {
    const page = await openPage();
    const widths = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      group.style.width = "200px";
      return Array.from(
        group.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
        (member) => member.offsetWidth,
      );
    });
    expect(widths).toEqual([110, 110, 110]);
    await page.close();
  });

  it("hugs its members and fills the space they leave", async () => {
    const page = await openPage();
    const result = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const second = group.querySelector<HTMLElement>(
        '[data-slide-object-id="second"]',
      )!;
      const offered = api.readSlideLayoutSizing(group)?.available.horizontal;
      api.setSlideLayoutSizing(group, "horizontal", "hug");
      const hugged = group.offsetWidth;
      api.setSlideLayoutSizing(group, "horizontal", "fixed");
      api.setSlideLayoutSizing(second, "horizontal", "fill");
      return {
        offered,
        hugged,
        fixedWidth: group.style.width,
        filled: second.offsetWidth,
      };
    });
    expect(result.offered).toEqual(["fixed", "hug"]);
    // 3 x 110 members, 2 x 25 gaps, 2 x 20 padding.
    expect(result.hugged).toBe(420);
    expect(result.fixedWidth).toBe("420px");
    expect(result.filled).toBe(110);
    await page.close();
  });

  it("keeps a nested group's members where they render when it joins flow", async () => {
    const page =
      await openPage(`<div class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group"
  style="position: absolute; left: 120px; top: 80px; width: 420px; height: 160px; box-sizing: border-box;">
  <div data-slide-object-id="card" style="position: absolute; left: 20px; top: 30px; width: 110px; height: 60px;"></div>
  <div class="fmd-slide-group" data-slide-group="true" data-slide-object-id="inner"
    style="position: absolute; left: 160px; top: 30px; width: 200px; height: 100px;">
    <div data-slide-object-id="badge" style="position: absolute; left: 40px; top: 20px; width: 50px; height: 30px;"></div>
  </div>
</div>`);
    const badgeRect = () =>
      page.evaluate(() => {
        const { left, top, width, height } = document
          .querySelector('[data-slide-object-id="badge"]')!
          .getBoundingClientRect();
        return { badge: { left, top, width, height } };
      });
    const before = await badgeRect();
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(
        '[data-slide-object-id="group"]',
      )!;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      const inner = group.querySelector<HTMLElement>(
        '[data-slide-object-id="inner"]',
      )!;
      return { result, innerPosition: inner.style.position };
    });
    expect(outcome).toEqual({
      result: { status: "applied" },
      innerPosition: "relative",
    });
    expectSameRects(await badgeRect(), before);
    await page.close();
  });

  it("takes a new main axis size once a Fill member is pinned for a resize", async () => {
    const page = await openPage();
    const widths = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const first = group.querySelector<HTMLElement>(
        '[data-slide-object-id="first"]',
      )!;
      api.setSlideLayoutSizing(first, "horizontal", "fill");
      const filled = first.offsetWidth;
      first.style.width = "60px";
      const ignored = first.offsetWidth;
      api.fixSlideLayoutSizing(first, ["horizontal"]);
      const pinned = first.offsetWidth;
      first.style.width = "60px";
      return { filled, ignored, pinned, resized: first.offsetWidth };
    });
    expect(widths.ignored).toBe(widths.filled);
    expect(widths.pinned).toBe(widths.filled);
    expect(widths.resized).toBe(60);
    await page.close();
  });

  it("puts a member a stylesheet places into flow without moving it", async () => {
    const page = await openPage(
      `<style>.placed { position: absolute; }</style>${GROUP.replace(
        '<div data-slide-object-id="third" style="position: absolute;',
        '<div class="placed" data-slide-object-id="third" style="',
      )}`,
    );
    const before = await memberRects(page);
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      const third = group.querySelector<HTMLElement>(
        '[data-slide-object-id="third"]',
      )!;
      return { result, position: getComputedStyle(third).position };
    });
    expect(outcome).toEqual({
      result: { status: "applied" },
      position: "static",
    });
    expectSameRects(await memberRects(page), before);
    await page.close();
  });

  it("refuses a member a stylesheet keeps placed and leaves the group as it was", async () => {
    const page = await openPage(
      `<style>.pinned { position: absolute !important; }</style>${GROUP.replace(
        '<div data-slide-object-id="third" style="position: absolute;',
        '<div class="pinned" data-slide-object-id="third" style="',
      )}`,
    );
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const before = group.outerHTML;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      return { result, untouched: group.outerHTML === before };
    });
    expect(outcome).toEqual({
      result: {
        status: "refused",
        reason: "placed-by-stylesheet",
        objectIds: ["third"],
      },
      untouched: true,
    });
    await page.close();
  });

  it("reports the flow's screen direction for reversed, rtl, rotated and mirrored groups", async () => {
    const page = await openPage();
    const axes = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      // Members of different heights: an axis inferred from where they
      // paint would tilt under a mirror.
      group.querySelector<HTMLElement>(
        '[data-slide-object-id="third"]',
      )!.style.height = "20px";
      const unit = () => {
        const { x, y } = api.slideFlowScreenAxis(group);
        const length = Math.hypot(x, y);
        return { x: x / length, y: y / length };
      };
      const row = unit();
      group.style.flexDirection = "row-reverse";
      const reversed = unit();
      group.style.flexDirection = "row";
      group.style.direction = "rtl";
      const rtl = unit();
      group.style.direction = "";
      group.style.transform = "rotate(90deg)";
      const rotated = unit();
      group.style.transform = "";
      group.style.rotate = "90deg";
      const rotateProperty = unit();
      group.style.rotate = "";
      group.style.transform = "scaleX(-1)";
      return { row, reversed, rtl, rotated, rotateProperty, mirrored: unit() };
    });
    const expected = {
      row: { x: 1, y: 0 },
      reversed: { x: -1, y: 0 },
      rtl: { x: -1, y: 0 },
      rotated: { x: 0, y: 1 },
      rotateProperty: { x: 0, y: 1 },
      mirrored: { x: -1, y: 0 },
    };
    for (const [name, axis] of Object.entries(expected)) {
      const actual = axes[name as keyof typeof axes];
      expect(actual.x, `${name} x`).toBeCloseTo(axis.x, 6);
      expect(actual.y, `${name} y`).toBeCloseTo(axis.y, 6);
    }
    await page.close();
  });

  it("refuses a group with text directly in it", async () => {
    const page = await openPage(
      GROUP.replace("</div>\n</div>", "</div>\n  Loose words\n</div>"),
    );
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const before = group.outerHTML;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      return { result, untouched: group.outerHTML === before };
    });
    expect(outcome).toEqual({
      result: { status: "refused", reason: "loose-text", objectIds: [] },
      untouched: true,
    });
    await page.close();
  });

  it("drops a member where the pointer is in a reversed row", async () => {
    const page = await openPage();
    const result = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      // The first member now paints rightmost and the third leftmost.
      group.style.flexDirection = "row-reverse";
      const member = (id: string) =>
        group.querySelector<HTMLElement>(`[data-slide-object-id="${id}"]`)!;
      const rightEdge = member("first").getBoundingClientRect().right;
      const index = api.resolveSlideFlowInsertionIndex(group, member("third"), {
        x: rightEdge - 2,
        y: member("first").getBoundingClientRect().top + 5,
      });
      api.moveSlideFlowMember(group, member("third"), index);
      const painted = ["first", "second", "third"]
        .map((id) => ({ id, left: member(id).getBoundingClientRect().left }))
        .sort((a, b) => b.left - a.left)
        .map(({ id }) => id);
      return { index, rightToLeft: painted };
    });
    expect(result).toEqual({
      index: 0,
      rightToLeft: ["third", "first", "second"],
    });
    await page.close();
  });

  it("turns on without moving members in a right-to-left group", async () => {
    const page = await openPage(
      GROUP.replace(
        "box-sizing: border-box;",
        "box-sizing: border-box; direction: rtl;",
      ),
    );
    const before = await memberRects(page);
    const result = await page.evaluate(() =>
      window.slideAutoLayout.enableSlideGroupAutoLayout(
        document.querySelector<HTMLElement>(".fmd-slide-group")!,
      ),
    );
    expect(result).toEqual({ status: "applied" });
    expectSameRects(await memberRects(page), before);
    await page.close();
  });

  it("turns on without moving a member that carries inert flex-item styles", async () => {
    const page = await openPage(
      GROUP.replace(
        'data-slide-object-id="first" style="',
        'data-slide-object-id="first" style="order: 5; flex-grow: 1; align-self: flex-end; ',
      ),
    );
    const before = await memberRects(page);
    const result = await page.evaluate(() =>
      window.slideAutoLayout.enableSlideGroupAutoLayout(
        document.querySelector<HTMLElement>(".fmd-slide-group")!,
      ),
    );
    expect(result).toEqual({ status: "applied" });
    expectSameRects(await memberRects(page), before);
    await page.close();
  });

  it("wraps members of an auto layout group in a nested one where they sit", async () => {
    const page = await openPage();
    const before = await page.evaluate(() => {
      window.slideAutoLayout.enableSlideGroupAutoLayout(
        document.querySelector<HTMLElement>(".fmd-slide-group")!,
      );
      return null;
    });
    expect(before).toBeNull();
    const rects = await memberRects(page);
    const outcome = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      const member = (id: string) =>
        group.querySelector<HTMLElement>(`[data-slide-object-id="${id}"]`)!;
      const result = api.wrapSlideFlowMembers(group, [
        member("second"),
        member("first"),
      ]);
      if (result.status !== "applied") return { status: result.status };
      return {
        status: result.status,
        nested: api.isAutoLayoutSlideGroup(result.group),
        inner: Array.from(result.group.children, (child) =>
          child.getAttribute("data-slide-object-id"),
        ),
        outer: Array.from(group.children, (child) =>
          child === result.group
            ? "wrapper"
            : child.getAttribute("data-slide-object-id"),
        ),
      };
    });
    expect(outcome).toEqual({
      status: "applied",
      nested: true,
      inner: ["first", "second"],
      outer: ["wrapper", "third"],
    });
    const after = await page.evaluate(() => {
      const rects: Record<
        string,
        { left: number; top: number; width: number; height: number }
      > = {};
      for (const id of ["first", "second", "third"]) {
        const { left, top, width, height } = document
          .querySelector(`[data-slide-object-id="${id}"]`)!
          .getBoundingClientRect();
        rects[id] = { left, top, width, height };
      }
      return rects;
    });
    expectSameRects(after, rects);
    await page.close();
  });

  it("refuses to wrap flow members that would move", async () => {
    const page = await openPage();
    const outcomes = await page.evaluate(() => {
      const api = window.slideAutoLayout;
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      api.enableSlideGroupAutoLayout(group);
      const member = (id: string) =>
        group.querySelector<HTMLElement>(`[data-slide-object-id="${id}"]`)!;
      const untouched = (attempt: () => unknown) => {
        const before = group.outerHTML;
        const result = attempt();
        return { result, untouched: group.outerHTML === before };
      };
      const apart = untouched(() =>
        api.wrapSlideFlowMembers(group, [member("first"), member("third")]),
      );
      api.setSlideLayoutSizing(member("first"), "horizontal", "fill");
      const filling = untouched(() =>
        api.wrapSlideFlowMembers(group, [member("first"), member("second")]),
      );
      api.setSlideLayoutSizing(member("first"), "horizontal", "fixed");
      group.style.justifyContent = "space-evenly";
      const spread = untouched(() =>
        api.wrapSlideFlowMembers(group, [member("first"), member("second")]),
      );
      return { apart, filling, spread };
    });
    expect(outcomes.apart).toEqual({
      result: {
        status: "refused",
        reason: "cannot-wrap",
        objectIds: ["first", "third"],
      },
      untouched: true,
    });
    expect(outcomes.filling).toEqual({
      result: {
        status: "refused",
        reason: "cannot-wrap",
        objectIds: ["first", "second"],
      },
      untouched: true,
    });
    expect(outcomes.spread).toEqual(outcomes.filling);
    await page.close();
  });

  it("refuses a member that is not rendered and leaves the group as it was", async () => {
    const page = await openPage();
    const outcome = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
      group
        .querySelector<HTMLElement>('[data-slide-object-id="third"]')!
        .style.setProperty("display", "none");
      const before = group.outerHTML;
      const result = window.slideAutoLayout.enableSlideGroupAutoLayout(group);
      return { result, untouched: group.outerHTML === before };
    });
    expect(outcome).toEqual({
      result: { status: "refused", reason: "unmeasured", objectIds: ["third"] },
      untouched: true,
    });
    await page.close();
  });
});
