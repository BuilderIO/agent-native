import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Host = typeof import("./slide-object-transform.browser-host");

declare global {
  interface Window {
    slideObjects: Host;
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
          "Could not launch Chromium for the slide transform E2E.",
          `Bundled Chromium error: ${String(bundledError).split("\n")[0]}`,
          `Chrome channel error: ${String(channelError).split("\n")[0]}`,
        ].join("\n"),
      );
    }
  }
}

/** The editor's DOM helpers as one browser script, bundled from source. */
async function bundleHost(): Promise<string> {
  const result = await build({
    configFile: false,
    root: SLIDES_ROOT,
    logLevel: "silent",
    // A library build leaves React's `process.env.NODE_ENV` reads in place.
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
        entry: path.join(EDITOR_DIR, "slide-object-transform.browser-host.ts"),
        name: "slideObjects",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const bundle = outputs.find((output) => "output" in output);
  const chunk = bundle && "output" in bundle ? bundle.output[0] : undefined;
  if (!chunk) throw new Error("The slide object host did not bundle.");
  return chunk.code;
}

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const pageHtml = (css: string, body: string) => `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; }
      .stage { position: relative; width: 800px; height: 450px; }
      .object { position: absolute; left: 300px; top: 150px; width: 120px; height: 40px; background: #888; }
      ${css}
    </style>
  </head>
  <body><div class="stage">${body}</div></body>
</html>`;

let browser: Browser;
let hostScript: string;

beforeAll(async () => {
  [browser, hostScript] = await Promise.all([launchBrowser(), bundleHost()]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function openPage(css: string, body: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(pageHtml(css, body));
  await page.addScriptTag({ content: hostScript });
  return page;
}

const hullOf = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const { left, top, width, height } = document
      .querySelector(target)!
      .getBoundingClientRect();
    return { left, top, width, height };
  }, selector);

function expectSameHull(
  actual: Awaited<ReturnType<typeof hullOf>>,
  expected: Awaited<ReturnType<typeof hullOf>>,
) {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 2);
  }
}

describe("the rotation of a slide object in Chromium", () => {
  const OBJECT = ".object";
  const CASES: Array<{
    name: string;
    css?: string;
    attributes: string;
    expected: number;
  }> = [
    {
      name: "an inline rotate(200deg)",
      attributes: 'class="object" style="transform: rotate(200deg)"',
      expected: 200,
    },
    {
      name: "an inline rotate(-30deg)",
      attributes: 'class="object" style="transform: rotate(-30deg)"',
      expected: 330,
    },
    {
      name: "an inline rotate(370deg)",
      attributes: 'class="object" style="transform: rotate(370deg)"',
      expected: 10,
    },
    {
      name: "the rotate property",
      attributes: 'class="object" style="rotate: 200deg"',
      expected: 200,
    },
    {
      name: "a stylesheet rule's rotate(200deg)",
      css: ".turned { transform: rotate(200deg); }",
      attributes: 'class="object turned"',
      expected: 200,
    },
    {
      name: "a stylesheet rule's rotate property",
      css: ".turned { rotate: -90deg; }",
      attributes: 'class="object turned"',
      expected: 270,
    },
    {
      name: "a transform that also translates and scales",
      attributes:
        'class="object" style="transform: translate(10px, 5px) rotate(370deg) scale(2)"',
      expected: 10,
    },
    {
      name: "a rotate property over a scaled transform",
      attributes: 'class="object" style="rotate: -40deg; transform: scale(2)"',
      expected: 320,
    },
  ];

  it.each(CASES)(
    "reads $name in [0, 360) and writes the same value back without moving it",
    async ({ css = "", attributes, expected }) => {
      const page = await openPage(css, `<div ${attributes}></div>`);
      try {
        const read = () =>
          page.evaluate(
            (target) =>
              window.slideObjects.readSlideObjectRotation(
                document.querySelector<HTMLElement>(target)!,
              ),
            OBJECT,
          );
        const painted = await hullOf(page, OBJECT);

        const rotation = await read();
        expect(rotation).toBeCloseTo(expected, 3);
        expect(rotation).toBeGreaterThanOrEqual(0);
        expect(rotation).toBeLessThan(360);

        const written = await page.evaluate(
          ([target, degrees]) =>
            window.slideObjects.setSlideObjectRotation(
              document.querySelector<HTMLElement>(target as string)!,
              degrees as number,
            ),
          [OBJECT, Math.round(rotation ?? Number.NaN)],
        );
        expect(written).toBe(true);
        expectSameHull(await hullOf(page, OBJECT), painted);
        expect(await read()).toBeCloseTo(expected, 3);
      } finally {
        await page.close();
      }
    },
  );

  it("writes a pure rotation back as a rotate() the author can read", async () => {
    const page = await openPage(
      "",
      '<div class="object" style="transform: rotate(15deg)"></div>',
    );
    try {
      await page.evaluate(() =>
        window.slideObjects.setSlideObjectRotation(
          document.querySelector<HTMLElement>(".object")!,
          200,
        ),
      );

      expect(
        await page.evaluate(
          () => document.querySelector<HTMLElement>(".object")!.style.transform,
        ),
      ).toBe("rotate(200deg)");
    } finally {
      await page.close();
    }
  });

  it.each([
    ["a rotate property with an axis", "rotate: x 20deg"],
    ["a transform with a 3D rotation", "transform: rotateY(30deg)"],
  ])(
    "has no rotation for %s and writes nothing to it",
    async (_name, declaration) => {
      const page = await openPage(
        "",
        `<div class="object" style="${declaration}"></div>`,
      );
      try {
        const painted = await hullOf(page, OBJECT);
        const result = await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(".object")!;
          const style = element.getAttribute("style");
          return {
            rotation: window.slideObjects.readSlideObjectRotation(element),
            written: window.slideObjects.setSlideObjectRotation(element, 30),
            unchanged: element.getAttribute("style") === style,
          };
        });

        expect(result).toEqual({
          rotation: null,
          written: false,
          unchanged: true,
        });
        expectSameHull(await hullOf(page, OBJECT), painted);
      } finally {
        await page.close();
      }
    },
  );

  it.each([
    ["from 200 across no boundary", 200, 30, 230],
    ["from 350 across the turn", 350, 20, 10],
    ["backwards across the turn", 10, -30, 340],
  ])(
    "plans a rotate-handle drag %s from the rotation it reads",
    async (_name, from, delta, expected) => {
      const page = await openPage(
        `.turned { transform: rotate(${from}deg); }`,
        '<div class="object turned"></div>',
      );
      try {
        const rotated = await page.evaluate(
          ([degrees]) => {
            const element = document.querySelector<HTMLElement>(".object")!;
            const center = () => {
              const { left, top, width, height } =
                element.getBoundingClientRect();
              return { x: left + width / 2, y: top + height / 2 };
            };
            const before = center();
            const plan = window.slideObjects.rotateSlideObjectMembers(
              [
                {
                  objectId: "object",
                  element,
                  start: {
                    x: element.offsetLeft,
                    y: element.offsetTop,
                    width: element.offsetWidth,
                    height: element.offsetHeight,
                  },
                  ...window.slideObjects.readSlideObjectTransformSnapshot(
                    element,
                  ),
                  rotation:
                    window.slideObjects.readSlideObjectRotation(element),
                },
              ],
              degrees as number,
            );
            const next = plan.get("object");
            if (!next) return null;
            element.style.left = `${next.geometry.x}px`;
            element.style.top = `${next.geometry.y}px`;
            element.style.transform = next.transform;
            const after = center();
            return {
              moved: Math.hypot(after.x - before.x, after.y - before.y),
              rotation: window.slideObjects.readSlideObjectRotation(element),
              planned: next.rotation,
            };
          },
          [delta],
        );

        expect(rotated).not.toBeNull();
        expect(rotated!.moved).toBeLessThan(0.01);
        expect(rotated!.rotation).toBeCloseTo(expected, 3);
        expect(rotated!.planned).toBeCloseTo(expected, 3);
      } finally {
        await page.close();
      }
    },
  );

  it("ungroups a group a stylesheet rule rotates without moving its members", async () => {
    const page = await openPage(
      ".turned { transform: rotate(200deg); }",
      `<div class="fmd-slide-group turned" data-slide-group="true" data-slide-object-id="group" style="position: absolute; left: 200px; top: 100px; width: 300px; height: 160px">
        <div id="first" data-slide-object-id="first" style="position: absolute; left: 20px; top: 30px; width: 80px; height: 40px; background: #888"></div>
        <div id="second" data-slide-object-id="second" style="position: absolute; left: 180px; top: 90px; width: 60px; height: 50px; background: #444"></div>
      </div>`,
    );
    try {
      const result = await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
        const members = ["first", "second"].map(
          (id) => document.getElementById(id)!,
        );
        const center = (element: HTMLElement) => {
          const { left, top, width, height } = element.getBoundingClientRect();
          return { x: left + width / 2, y: top + height / 2 };
        };
        const before = members.map(center);
        const ungrouped = window.slideObjects.ungroupSlideObject(
          group,
          (element) => ({
            x: element.offsetLeft,
            y: element.offsetTop,
            width: element.offsetWidth,
            height: element.offsetHeight,
          }),
          (element, geometry) => {
            element.style.left = `${geometry.x}px`;
            element.style.top = `${geometry.y}px`;
            element.style.width = `${geometry.width}px`;
            if (geometry.height !== undefined) {
              element.style.height = `${geometry.height}px`;
            }
          },
        );
        return {
          ungrouped: ungrouped?.length ?? null,
          moved: members.map((member, index) =>
            Math.hypot(
              center(member).x - before[index]!.x,
              center(member).y - before[index]!.y,
            ),
          ),
          rotations: members.map((member) =>
            window.slideObjects.readSlideObjectRotation(member),
          ),
        };
      });

      expect(result.ungrouped).toBe(2);
      for (const moved of result.moved) expect(moved).toBeLessThan(0.05);
      for (const rotation of result.rotations) {
        expect(rotation).toBeCloseTo(200, 3);
      }
    } finally {
      await page.close();
    }
  });
});

describe("starting to crop an image in Chromium", () => {
  const imageHtml = (inline = "") =>
    `<img id="pic" class="ruled" src="${PIXEL}" style="position: absolute; left: 200px; top: 100px; width: 160px; height: 90px; ${inline}">`;
  const IMAGE = imageHtml();
  const TRANSFORM_PROPERTIES = ["transform", "translate", "rotate", "scale"];
  const CASES: Array<{
    name: string;
    rule: string;
    extra?: string;
    inline?: string;
  }> = [
    {
      name: "a transform and its origin",
      rule: "transform: rotate(20deg); transform-origin: top left;",
    },
    { name: "the rotate property", rule: "rotate: 20deg;" },
    { name: "the scale property", rule: "scale: 1.3;" },
    { name: "the translate property", rule: "translate: 40px 10px;" },
    {
      name: "all four, about an origin",
      rule: "translate: 10px 5px; rotate: 15deg; scale: 1.2; transform: skewX(5deg); transform-origin: 20% 30%;",
    },
    {
      name: "an !important transform",
      rule: "transform: rotate(20deg) !important; transform-origin: top left;",
    },
    {
      name: "an !important rotate property",
      rule: "rotate: 20deg !important;",
    },
    {
      name: "an !important transform that beats the image's inline one",
      rule: "transform: rotate(50deg) !important;",
      inline: "transform: rotate(20deg);",
    },
    {
      name: "an !important rotate property that beats the image's inline one",
      rule: "rotate: 50deg !important;",
      inline: "rotate: 20deg;",
    },
    {
      name: "an !important transform under a transition, over the image's inline one",
      rule: "transform: rotate(50deg) !important; transition: transform 1s;",
      inline: "transform: rotate(20deg);",
    },
    {
      name: "an !important none that switches the image's inline transform off",
      rule: "transform: none !important;",
      inline: "transform: rotate(20deg);",
    },
    {
      name: "an !important origin that beats the image's inline one",
      rule: "transform-origin: 100% 100% !important;",
      inline: "transform: rotate(30deg); transform-origin: 0 0;",
    },
  ];

  it.each(CASES)(
    "carries $name from a stylesheet rule onto the frame without a jump",
    async ({ rule, extra = "", inline }) => {
      const page = await openPage(
        `${extra} .ruled { ${rule} }`,
        inline ? imageHtml(inline) : IMAGE,
      );
      try {
        const painted = await hullOf(page, "#pic");
        const effective = await page.evaluate((properties) => {
          const style = getComputedStyle(document.getElementById("pic")!);
          return Object.fromEntries(
            properties.map((property) => [
              property,
              style.getPropertyValue(property),
            ]),
          );
        }, TRANSFORM_PROPERTIES);

        await page.evaluate(() => {
          const image = document.getElementById("pic") as HTMLImageElement;
          const wrapped = window.slideObjects.wrapImageInCropFrame(image)!;
          wrapped.frame.id = "frame";
          wrapped.viewport.id = "viewport";
        });

        expectSameHull(await hullOf(page, "#frame"), painted);
        expectSameHull(await hullOf(page, "#pic"), painted);

        // The crop handles resize the frame about the corner opposite the one
        // dragged, so that corner has to stay where the frame paints it.
        const resized = await page.evaluate(() => {
          const frame = document.getElementById("frame")!;
          const probe = document.createElement("i");
          probe.style.cssText =
            "position:absolute;left:0;top:0;width:0;height:0";
          frame.append(probe);
          const corner = () => {
            const { left, top } = probe.getBoundingClientRect();
            return { left, top };
          };
          const before = corner();
          const next = window.slideObjects.resizeTransformedSlideObject(
            {
              x: frame.offsetLeft,
              y: frame.offsetTop,
              width: frame.offsetWidth,
              height: frame.offsetHeight,
            },
            window.slideObjects.readSlideObjectTransformSnapshot(frame),
            { handle: "se", dx: 30, dy: 20, preserveAspectRatio: false },
          );
          if (!next) return null;
          frame.style.left = `${next.x}px`;
          frame.style.top = `${next.y}px`;
          frame.style.width = `${next.width}px`;
          frame.style.height = `${next.height}px`;
          const after = corner();
          probe.remove();
          return { before, after, grew: next.width > 160 };
        });
        expect(resized).not.toBeNull();
        expect(resized!.grew).toBe(true);
        expect(resized!.after.left).toBeCloseTo(resized!.before.left, 1);
        expect(resized!.after.top).toBeCloseTo(resized!.before.top, 1);

        // Committing leaves the rule's transform in effect once, on the frame.
        const committed = await page.evaluate((properties) => {
          const image = document.getElementById("pic") as HTMLImageElement;
          const frame = document.getElementById("frame")!;
          window.slideObjects.writeImageCropPercentGeometry(
            image,
            document.getElementById("viewport")!,
          );
          const read = (element: HTMLElement) =>
            Object.fromEntries(
              properties.map((property) => [
                property,
                getComputedStyle(element).getPropertyValue(property),
              ]),
            );
          return {
            frame: read(frame),
            image: read(image),
            inline: Object.fromEntries(
              properties.map((property) => [
                property,
                frame.style.getPropertyValue(property),
              ]),
            ),
          };
        }, TRANSFORM_PROPERTIES);

        expect(committed.frame).toEqual(effective);
        expect(committed.image).toEqual({
          transform: "none",
          translate: "none",
          rotate: "none",
          scale: "none",
        });
        for (const property of TRANSFORM_PROPERTIES) {
          expect(committed.inline[property] !== "").toBe(
            effective[property] !== "none",
          );
        }
      } finally {
        await page.close();
      }
    },
  );

  it("moves an inline transform as authored beside one a rule gives the image", async () => {
    const page = await openPage(
      ".ruled { rotate: 15deg; }",
      IMAGE.replace(
        'style="',
        'style="transform: scale(1.2) translate(10px, 5px); ',
      ),
    );
    try {
      const painted = await hullOf(page, "#pic");

      const frame = await page.evaluate(() => {
        const wrapped = window.slideObjects.wrapImageInCropFrame(
          document.getElementById("pic") as HTMLImageElement,
        )!;
        wrapped.frame.id = "frame";
        return {
          transform: wrapped.frame.style.transform,
          rotate: wrapped.frame.style.getPropertyValue("rotate"),
        };
      });

      expect(frame).toEqual({
        transform: "scale(1.2) translate(10px, 5px)",
        rotate: "15deg",
      });
      expectSameHull(await hullOf(page, "#frame"), painted);
      expectSameHull(await hullOf(page, "#pic"), painted);
    } finally {
      await page.close();
    }
  });

  it.each([
    {
      name: "a custom property its class defines",
      rule: "--turn: 25deg;",
      declaration: "transform: rotate(var(--turn))",
    },
    {
      name: "a custom property in a rotate property",
      rule: "--turn: 25deg;",
      declaration: "rotate: var(--turn)",
    },
    {
      name: "an em length against its class's font size",
      rule: "font-size: 40px;",
      declaration: "translate: 2em 0",
    },
  ])(
    "resolves $name before it moves onto a frame that does not share the class",
    async ({ rule, declaration }) => {
      const page = await openPage(
        `.ruled { ${rule} }`,
        IMAGE.replace('style="', `style="${declaration}; `),
      );
      try {
        const painted = await hullOf(page, "#pic");

        await page.evaluate(() => {
          const wrapped = window.slideObjects.wrapImageInCropFrame(
            document.getElementById("pic") as HTMLImageElement,
          )!;
          wrapped.frame.id = "frame";
        });

        expectSameHull(await hullOf(page, "#frame"), painted);
        expectSameHull(await hullOf(page, "#pic"), painted);
      } finally {
        await page.close();
      }
    },
  );

  it("leaves a transform on the image's wrapper with the wrapper", async () => {
    const page = await openPage(
      ".ruled { transform: rotate(20deg); }",
      `<div id="wrap" class="ruled" style="position: absolute; left: 100px; top: 50px; width: 400px; height: 300px">${IMAGE.replace('class="ruled" ', "")}</div>`,
    );
    try {
      const painted = await hullOf(page, "#pic");

      const frame = await page.evaluate(() => {
        const wrapped = window.slideObjects.wrapImageInCropFrame(
          document.getElementById("pic") as HTMLImageElement,
        )!;
        wrapped.frame.id = "frame";
        return {
          parent: wrapped.frame.parentElement?.id,
          inline: wrapped.frame.getAttribute("style"),
        };
      });

      expect(frame.parent).toBe("wrap");
      expect(frame.inline).not.toMatch(/transform|rotate|scale|translate/);
      expectSameHull(await hullOf(page, "#pic"), painted);
    } finally {
      await page.close();
    }
  });
});

describe("starting to crop an image a CSS animation moves in Chromium", () => {
  const imageHtml = (inline = "") =>
    `<img id="pic" class="ruled" src="${PIXEL}" style="position: absolute; left: 200px; top: 100px; width: 160px; height: 90px; ${inline}">`;
  const SPIN = "@keyframes spin { to { transform: rotate(360deg); } }";
  const CASES: Array<{
    name: string;
    css: string;
    inline?: string;
    settle: number;
    animations: string[];
  }> = [
    {
      name: "an entrance that finished and holds its resting transform",
      css: `@keyframes enter { from { transform: translateY(40px); opacity: 0; } to { transform: rotate(10deg); opacity: 1; } } .ruled { animation: enter 300ms ease-out forwards; }`,
      settle: 600,
      animations: ["enter"],
    },
    {
      name: "an entrance that finished and holds a resting none",
      css: `@keyframes enter { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } } .ruled { animation: enter 300ms ease-out forwards; }`,
      settle: 600,
      animations: ["enter"],
    },
    {
      name: "an entrance still in flight",
      css: `@keyframes enter { from { transform: translateY(40px); opacity: 0; } to { transform: rotate(10deg); opacity: 1; } } .ruled { animation: enter 3s ease-out forwards; }`,
      settle: 400,
      animations: ["enter"],
    },
    {
      name: "an infinite animation on transform",
      css: `${SPIN} .ruled { animation: spin 4s linear infinite; }`,
      settle: 400,
      animations: ["spin"],
    },
    {
      name: "an infinite animation over an inline transform",
      css: `${SPIN} .ruled { animation: spin 4s linear infinite; }`,
      inline: "transform: translate(10px, 5px);",
      settle: 400,
      animations: ["spin"],
    },
    {
      name: "an animation on the rotate property only",
      css: "@keyframes turn { to { rotate: 360deg; } } .ruled { animation: turn 4s linear infinite; }",
      settle: 400,
      animations: ["turn"],
    },
    {
      name: "an animation the rule holds paused",
      css: "@keyframes held { to { transform: rotate(30deg); } } .ruled { animation: held 10s linear -5s paused; }",
      settle: 0,
      animations: ["held"],
    },
    {
      name: "a fade running beside a spin",
      css: `${SPIN} @keyframes fade { from { opacity: 0.2; } to { opacity: 1; } } .ruled { animation: fade 1s linear infinite, spin 4s linear infinite; }`,
      settle: 400,
      animations: ["fade", "spin"],
    },
  ];
  // The hull of the element with every animation on it seeked to `time`.
  const hullAt = (page: Page, selector: string, time: number) =>
    page.evaluate(
      ([target, ms]) => {
        const element = document.querySelector(target as string)!;
        for (const animation of element.getAnimations()) {
          animation.currentTime = ms as number;
        }
        const { left, top, width, height } = element.getBoundingClientRect();
        return { left, top, width, height };
      },
      [selector, time],
    );

  it.each(CASES)(
    "holds $name on the frame where it was, without a jump",
    async ({ css, inline, settle, animations }) => {
      const page = await openPage(css, imageHtml(inline));
      try {
        await page.waitForTimeout(settle);
        // One task, so no animation frame separates what the image painted
        // from what the frame paints.
        const started = await page.evaluate(() => {
          const rect = (element: Element) => {
            const { left, top, width, height } =
              element.getBoundingClientRect();
            return { left, top, width, height };
          };
          const names = (element: Element) =>
            element
              .getAnimations()
              .map((animation) => (animation as CSSAnimation).animationName);
          const image = document.getElementById("pic") as HTMLImageElement;
          const painted = rect(image);
          const wrapped = window.slideObjects.wrapImageInCropFrame(image)!;
          wrapped.frame.id = "frame";
          return {
            painted,
            frame: rect(wrapped.frame),
            image: rect(image),
            frameAnimations: names(wrapped.frame),
            imageAnimations: names(image),
            imageAnimationName: getComputedStyle(image).animationName,
            imageStyle: image.getAttribute("style") ?? "",
          };
        });

        expectSameHull(started.frame, started.painted);
        expectSameHull(started.image, started.painted);
        expect(started.frameAnimations).toEqual(animations);
        expect(started.imageAnimations).toEqual([]);
        expect(started.imageAnimationName).toBe("none");
        // The name alone: the `animation` shorthand serializes with an `auto`
        // duration that an engine without it drops whole.
        expect(started.imageStyle).toContain("animation-name: none !important");
        expect(started.imageStyle).not.toMatch(/\bauto\b/);

        // Held still while the crop is edited: its handles are placed from
        // where the frame paints.
        await page.waitForTimeout(300);
        expectSameHull(await hullOf(page, "#frame"), started.frame);

        // What is saved plays on the frame as it played on the image.
        const saved = await page.evaluate(
          () => document.getElementById("frame")!.outerHTML,
        );
        const reopened = await openPage(css, saved);
        const reference = await openPage(css, imageHtml(inline));
        try {
          for (const time of [0, 250, 700]) {
            expectSameHull(
              await hullAt(reopened, "#frame", time),
              await hullAt(reference, "#pic", time),
            );
          }
        } finally {
          await reopened.close();
          await reference.close();
        }
      } finally {
        await page.close();
      }
    },
  );

  it("leaves an animation that does not move the transform on the image", async () => {
    const page = await openPage(
      "@keyframes fade { from { opacity: 0.2; } to { opacity: 1; } } .ruled { animation: fade 1s linear infinite; }",
      imageHtml("transform: rotate(20deg);"),
    );
    try {
      const wrapped = await page.evaluate(() => {
        const image = document.getElementById("pic") as HTMLImageElement;
        const wrapped = window.slideObjects.wrapImageInCropFrame(image)!;
        return {
          frame: wrapped.frame.getAnimations().length,
          image: image.getAnimations().length,
        };
      });

      expect(wrapped).toEqual({ frame: 0, image: 1 });
    } finally {
      await page.close();
    }
  });

  it.each([
    {
      name: "an inline !important transform",
      css: `${SPIN} .ruled { animation: spin 4s linear infinite; }`,
      inline: "transform: rotate(10deg) !important;",
    },
    {
      name: "a stylesheet !important transform",
      css: `${SPIN} .ruled { transform: rotate(50deg) !important; animation: spin 4s linear infinite; }`,
    },
    {
      name: "a stylesheet !important rotate property",
      css: "@keyframes turn { to { rotate: 360deg; } } .ruled { rotate: 20deg !important; animation: turn 4s linear infinite; }",
    },
  ])(
    "leaves an animation $name beats on the image, without a jump",
    async ({ css, inline }) => {
      const page = await openPage(css, imageHtml(inline));
      try {
        await page.waitForTimeout(300);
        const started = await page.evaluate(() => {
          const rect = (element: Element) => {
            const { left, top, width, height } =
              element.getBoundingClientRect();
            return { left, top, width, height };
          };
          const image = document.getElementById("pic") as HTMLImageElement;
          const painted = rect(image);
          const wrapped = window.slideObjects.wrapImageInCropFrame(image)!;
          wrapped.frame.id = "frame";
          return {
            painted,
            frame: rect(wrapped.frame),
            frameAnimations: wrapped.frame.getAnimations().length,
            imageAnimations: image.getAnimations().length,
            imageStyle: image.getAttribute("style") ?? "",
          };
        });

        expectSameHull(started.frame, started.painted);
        expect(started.frameAnimations).toBe(0);
        expect(started.imageAnimations).toBe(1);
        expect(started.imageStyle).not.toContain("animation-name");

        await page.waitForTimeout(300);
        expectSameHull(await hullOf(page, "#frame"), started.frame);
      } finally {
        await page.close();
      }
    },
  );
});

describe("setting the rotation of a slide object in Chromium", () => {
  const CENTRED =
    'class="object" style="left: 50%; top: 50%; transform: translate(-50%, -50%)';

  const centerOf = (page: Page) =>
    page.evaluate(() => {
      const { left, top, width, height } = document
        .querySelector(".object")!
        .getBoundingClientRect();
      return { x: left + width / 2, y: top + height / 2 };
    });
  const rotate = (page: Page, degrees: number) =>
    page.evaluate(
      (value) =>
        window.slideObjects.setSlideObjectRotation(
          document.querySelector<HTMLElement>(".object")!,
          value,
        ),
      degrees,
    );
  const painted = (page: Page) =>
    page.evaluate(
      () => getComputedStyle(document.querySelector(".object")!).transform,
    );

  it("keeps a centring translate(-50%, -50%) tracking the object's size", async () => {
    const page = await openPage("", `<div ${CENTRED} rotate(10deg)"></div>`);
    try {
      const before = await centerOf(page);

      expect(await rotate(page, 45)).toBe(true);
      const transform = await page.evaluate(
        () => document.querySelector<HTMLElement>(".object")!.style.transform,
      );
      await page.evaluate(() => {
        document.querySelector<HTMLElement>(".object")!.style.width = "240px";
      });

      expect(transform).toBe("translate(-50%, -50%) rotate(45deg)");
      const after = await centerOf(page);
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
    } finally {
      await page.close();
    }
  });

  it("sets the whole rotation when a transform list holds more than one rotate()", async () => {
    const page = await openPage(
      "",
      `<div ${CENTRED} rotate(10deg) rotate(20deg)"></div>`,
    );
    try {
      const before = await centerOf(page);

      expect(await rotate(page, 45)).toBe(true);

      const rotation = await page.evaluate(() =>
        window.slideObjects.readSlideObjectRotation(
          document.querySelector<HTMLElement>(".object")!,
        ),
      );
      expect(rotation).toBeCloseTo(45, 3);
      const after = await centerOf(page);
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
    } finally {
      await page.close();
    }
  });

  it.each([
    ["scale(0)", "transform: scale(0)"],
    ["a collapsed axis under a rotation", "transform: rotate(30deg) scaleX(0)"],
    ["the scale property at 0", "scale: 0"],
  ])(
    "has no rotation for %s and writes nothing to it",
    async (_name, declaration) => {
      const page = await openPage(
        "",
        `<div class="object" style="${declaration}"></div>`,
      );
      try {
        const result = await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(".object")!;
          const style = element.getAttribute("style");
          return {
            rotation: window.slideObjects.readSlideObjectRotation(element),
            written: window.slideObjects.setSlideObjectRotation(element, 90),
            unchanged: element.getAttribute("style") === style,
          };
        });

        expect(result).toEqual({
          rotation: null,
          written: false,
          unchanged: true,
        });
      } finally {
        await page.close();
      }
    },
  );

  it.each([
    ["a horizontal mirror", "scaleX(-1)", 0],
    ["a vertical mirror", "scaleY(-1)", 180],
    ["a mirror turned by 30deg", "rotate(30deg) scaleX(-1)", 30],
  ])(
    "reads %s as its rotation about the mirrored x axis",
    async (_name, transform, expected) => {
      const page = await openPage(
        "",
        `<div class="object" style="transform: ${transform}"></div>`,
      );
      try {
        const rotation = await page.evaluate(() =>
          window.slideObjects.readSlideObjectRotation(
            document.querySelector<HTMLElement>(".object")!,
          ),
        );

        expect(rotation).toBeCloseTo(expected, 3);
      } finally {
        await page.close();
      }
    },
  );

  it("turns a mirrored object without changing which axis it is mirrored on", async () => {
    const page = await openPage(
      "",
      '<div class="object" style="transform: scaleX(-1)"></div>',
    );
    const reference = await openPage(
      "",
      '<div class="object" style="transform: rotate(30deg) scaleX(-1)"></div>',
    );
    try {
      expect(await rotate(page, 30)).toBe(true);
      expect(await painted(page)).toBe(await painted(reference));

      expect(await rotate(page, 0)).toBe(true);
      expect(await painted(page)).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    } finally {
      await page.close();
      await reference.close();
    }
  });
});

describe("a transform a stylesheet or an animation keeps over an inline one in Chromium", () => {
  const OVERRIDES = [
    {
      name: "an !important stylesheet transform",
      css: ".object { transform: rotate(50deg) !important; }",
      painted: 50,
    },
    {
      name: "an animation on transform",
      css: "@keyframes sweep { to { transform: rotate(80deg); } } .object { animation: sweep 10s linear -5s paused; }",
      painted: 45,
    },
  ];
  const INLINE = '<div class="object" style="transform: rotate(10deg)"></div>';

  const state = (page: Page) =>
    page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".object")!;
      return {
        inline: element.getAttribute("style") ?? "",
        painted: getComputedStyle(element).transform,
        rotation: window.slideObjects.readSlideObjectRotation(element),
      };
    });
  const setRotation = (page: Page, degrees: number) =>
    page.evaluate(
      (value) =>
        window.slideObjects.setSlideObjectRotation(
          document.querySelector<HTMLElement>(".object")!,
          value,
        ),
      degrees,
    );

  it.each(OVERRIDES)(
    "does not report turning an object that $name keeps painting",
    async ({ css, painted }) => {
      const page = await openPage(css, INLINE);
      try {
        const before = await state(page);
        expect(before.rotation).toBeCloseTo(painted, 3);

        expect(await setRotation(page, 90)).toBe(false);

        expect(await state(page)).toEqual(before);
      } finally {
        await page.close();
      }
    },
  );

  it("does not report turning an object whose only transform is an !important stylesheet one", async () => {
    const page = await openPage(
      ".object { transform: rotate(50deg) !important; }",
      '<div class="object"></div>',
    );
    try {
      const before = await state(page);

      expect(await setRotation(page, 90)).toBe(false);

      expect(await state(page)).toEqual(before);
      expect(before.inline).toBe("");
    } finally {
      await page.close();
    }
  });

  it("still turns an object whose rotate property is the !important one", async () => {
    const page = await openPage(
      ".object { rotate: 30deg !important; }",
      INLINE,
    );
    try {
      expect((await state(page)).rotation).toBeCloseTo(40, 3);

      expect(await setRotation(page, 90)).toBe(true);

      expect((await state(page)).rotation).toBeCloseTo(90, 3);
    } finally {
      await page.close();
    }
  });

  it.each(OVERRIDES)(
    "offers no rotation to edit or plan for an object that $name keeps painting",
    async ({ css, painted }) => {
      const page = await openPage(css, INLINE);
      try {
        const result = await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(".object")!;
          const rotation =
            window.slideObjects.readEditableSlideObjectRotation(element);
          const plan = window.slideObjects.rotateSlideObjectMembers(
            [
              {
                objectId: "object",
                element,
                start: {
                  x: element.offsetLeft,
                  y: element.offsetTop,
                  width: element.offsetWidth,
                  height: element.offsetHeight,
                },
                ...window.slideObjects.readSlideObjectTransformSnapshot(
                  element,
                ),
                rotation,
              },
            ],
            30,
          );
          return {
            read: window.slideObjects.readSlideObjectRotation(element),
            rotation,
            planned: plan.size,
          };
        });

        expect(result.read).toBeCloseTo(painted, 3);
        expect(result.rotation).toBeNull();
        expect(result.planned).toBe(0);
      } finally {
        await page.close();
      }
    },
  );

  it("offers the rotation of an object whose inline transform paints", async () => {
    const page = await openPage(
      ".object { transition: transform 1s; }",
      INLINE,
    );
    try {
      const rotation = await page.evaluate(() =>
        window.slideObjects.readEditableSlideObjectRotation(
          document.querySelector<HTMLElement>(".object")!,
        ),
      );

      expect(rotation).toBeCloseTo(10, 3);
    } finally {
      await page.close();
    }
  });

  it("is not fooled by a transition on the transform", async () => {
    const page = await openPage(
      ".object { transition: transform 1s; transform: rotate(50deg) !important; }",
      INLINE,
    );
    try {
      const before = await state(page);

      expect(await setRotation(page, 90)).toBe(false);
      expect(
        await page.evaluate(() =>
          window.slideObjects.readEditableSlideObjectRotation(
            document.querySelector<HTMLElement>(".object")!,
          ),
        ),
      ).toBeNull();
      expect(await state(page)).toEqual(before);
    } finally {
      await page.close();
    }
  });

  it.each([
    {
      name: "a stylesheet transition on the transform",
      css: ".object { transition: transform 0.5s; }",
      style: "transform: rotate(10deg)",
    },
    {
      name: "a stylesheet transition on everything",
      css: ".object { transition: all 0.75s; }",
      style: "transform: rotate(10deg)",
    },
    {
      name: "an inline transition",
      css: "",
      style: "transform: rotate(10deg); transition: transform 1s ease",
    },
    {
      name: "an inline transition longhand",
      css: "",
      style: "transform: rotate(10deg); transition-duration: 1s",
    },
    {
      name: "an inline !important transform under a transition",
      css: ".object { transition: transform 1s; }",
      style: "transform: rotate(10deg) !important",
    },
  ])(
    "turns an object with $name at once and leaves the transition as authored",
    async ({ css, style }) => {
      const page = await openPage(
        css,
        `<div class="object" style="${style}"></div>`,
      );
      try {
        const result = await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(".object")!;
          const { transition, transitionDuration } = element.style;
          const written = window.slideObjects.setSlideObjectRotation(
            element,
            90,
          );
          return {
            written,
            rotation: window.slideObjects.readSlideObjectRotation(element),
            transform: element.style.getPropertyValue("transform"),
            priority: element.style.getPropertyPriority("transform"),
            kept:
              element.style.transition === transition &&
              element.style.transitionDuration === transitionDuration,
          };
        });

        expect(result.written).toBe(true);
        expect(result.rotation).toBeCloseTo(90, 3);
        expect(result.transform).toBe("rotate(90deg)");
        expect(result.priority).toBe(
          style.includes("important") ? "important" : "",
        );
        expect(result.kept).toBe(true);
        // No transition left running from the old rotation to the new one.
        await page.waitForTimeout(200);
        expect((await state(page)).rotation).toBeCloseTo(90, 3);
      } finally {
        await page.close();
      }
    },
  );

  it.each(["none", "initial", "unset", "revert"])(
    "does not report turning an object a stylesheet `transform: %s !important` keeps flat",
    async (value) => {
      const page = await openPage(
        `.object { transform: ${value} !important; }`,
        INLINE,
      );
      try {
        const before = await state(page);
        expect(before.painted).toBe("none");
        expect(before.rotation).toBeCloseTo(0, 3);

        expect(await setRotation(page, 90)).toBe(false);
        expect(
          await page.evaluate(() =>
            window.slideObjects.readEditableSlideObjectRotation(
              document.querySelector<HTMLElement>(".object")!,
            ),
          ),
        ).toBeNull();

        expect(await state(page)).toEqual(before);
      } finally {
        await page.close();
      }
    },
  );

  it("does not report turning an object with no inline transform that a stylesheet keeps flat", async () => {
    const page = await openPage(
      ".object { transform: none !important; }",
      '<div class="object"></div>',
    );
    try {
      const before = await state(page);

      expect(await setRotation(page, 90)).toBe(false);

      expect(await state(page)).toEqual(before);
      expect(before.inline).toBe("");
    } finally {
      await page.close();
    }
  });

  it.each([
    {
      name: "a delayed animation on transform",
      css: "@keyframes sweep { to { transform: rotate(80deg); } } .object { animation: sweep 1s linear 5s; }",
    },
    {
      name: "an animation on the rotate property",
      css: "@keyframes turn { to { rotate: 360deg; } } .object { animation: turn 4s linear infinite; }",
    },
  ])(
    "does not report turning an object $name is about to move",
    async ({ css }) => {
      const page = await openPage(css, INLINE);
      try {
        const before = await state(page);

        expect(await setRotation(page, 90)).toBe(false);
        expect(
          await page.evaluate(() =>
            window.slideObjects.readEditableSlideObjectRotation(
              document.querySelector<HTMLElement>(".object")!,
            ),
          ),
        ).toBeNull();

        expect((await state(page)).inline).toBe(before.inline);
      } finally {
        await page.close();
      }
    },
  );

  it("does not ungroup a group whose member keeps a transform the ungrouping has to write", async () => {
    const page = await openPage(
      ".turned { transform: rotate(200deg); } #first { transform: rotate(10deg) !important; }",
      `<div class="fmd-slide-group turned" data-slide-group="true" data-slide-object-id="group" style="position: absolute; left: 200px; top: 100px; width: 300px; height: 160px">
        <div id="first" data-slide-object-id="first" style="position: absolute; left: 20px; top: 30px; width: 80px; height: 40px; background: #888"></div>
        <div id="second" data-slide-object-id="second" style="position: absolute; left: 180px; top: 90px; width: 60px; height: 50px; background: #444"></div>
      </div>`,
    );
    try {
      const result = await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>(".fmd-slide-group")!;
        const html = document.body.innerHTML;
        const ungrouped = window.slideObjects.ungroupSlideObject(
          group,
          (element) => ({
            x: element.offsetLeft,
            y: element.offsetTop,
            width: element.offsetWidth,
            height: element.offsetHeight,
          }),
          () => {},
        );
        return { ungrouped, untouched: document.body.innerHTML === html };
      });

      expect(result).toEqual({ ungrouped: null, untouched: true });
    } finally {
      await page.close();
    }
  });

  it("reads the transform origin a stylesheet !important declaration gives over an inline one", async () => {
    const page = await openPage(
      ".object { transform-origin: 100% 100% !important; }",
      '<div class="object" style="transform: rotate(30deg); transform-origin: 0 0"></div>',
    );
    try {
      const origin = await page.evaluate(
        () =>
          window.slideObjects.readSlideObjectTransformSnapshot(
            document.querySelector<HTMLElement>(".object")!,
          ).transformOrigin,
      );

      expect(origin).toBe("100% 100%");
    } finally {
      await page.close();
    }
  });

  it("keeps the transform origin an inline declaration paints as authored", async () => {
    const page = await openPage(
      "",
      '<div class="object" style="transform: rotate(30deg); transform-origin: left top"></div>',
    );
    try {
      const origin = await page.evaluate(
        () =>
          window.slideObjects.readSlideObjectTransformSnapshot(
            document.querySelector<HTMLElement>(".object")!,
          ).transformOrigin,
      );

      expect(origin).toBe("left top");
    } finally {
      await page.close();
    }
  });
});
