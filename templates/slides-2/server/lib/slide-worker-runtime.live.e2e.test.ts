import { chromium, type Frame, type Page } from "@playwright/test";
import { expect, test } from "vitest";

import {
  compileSlideSource,
  readStoredSlideSource,
} from "../../actions/_slide-source";
import { buildSlideSrcDoc } from "../../app/components/slides-2-runtime/protocol";
import { buildReactSlideRuntime } from "./slide-worker-runtime";

type LiveSlide = {
  frame: Frame;
  page: Page;
  messages: () => Promise<unknown[]>;
  errors: string[];
};

async function withLiveSlide(
  source: string,
  verify: (slide: LiveSlide) => Promise<void>,
) {
  const runtime = await buildReactSlideRuntime(source, {
    current: 1,
    total: 1,
    assetUrls: new Map(),
  });
  const artifact = {
    protocolVersion: 1 as const,
    deckId: "live-wrapper-check-deck",
    slideId: "live-wrapper-check-slide",
    revision: 1,
    sourceHash: "b".repeat(64),
    width: 1920,
    height: 1080,
    html: "<div>static fallback</div>",
    assetOrigins: [],
    runtime,
  };
  const srcDoc = buildSlideSrcDoc(
    artifact,
    "test-frame-nonce",
    "https://slides-2.agent-native.com",
    null,
    "live",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate((content) => {
      (window as any).__messages = [];
      addEventListener("message", (event) =>
        (window as any).__messages.push(event.data),
      );
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.srcdoc = content;
      document.body.append(frame);
    }, srcDoc);
    await page.waitForFunction(
      () =>
        (window as any).__messages?.some((item: any) =>
          ["ready", "error"].includes(item.type),
        ),
      null,
      { timeout: 5000 },
    );
    const frame = page.frames()[1];
    if (!frame) throw new Error("The sandboxed slide frame did not load.");
    await verify({
      frame,
      page,
      messages: () => page.evaluate(() => (window as any).__messages),
      errors,
    });
  } finally {
    await browser.close();
  }
}

test("mounts a sanitized persisted source through the compiler and sandbox", async () => {
  const sourceTsx = `
import { useId } from "react";
import { NoiseBackground, Step, Steps, useIsActivePage, useSlidePageNumber } from "@agent-native/slides-core";

const MOTTLE = "none";
const TOOTH = "none";
const geometry = (offset, scale) => ({ X: (value) => offset + value * scale });
const pointLabel = ([x, y]) => String(x) + ":" + String(y);
const ScaleMark = ({ scale = "1:500", point }) => (
  <text id="scale-mark">{scale}:{pointLabel(point)}</text>
);

export default function Slide() {
  const id = useId();
  const active = useIsActivePage();
  const { current, total } = useSlidePageNumber();
  const measurement = geometry(2, 3).X(4).toFixed(1);
  return (
    <main id={id}>
      <NoiseBackground baseFrequency={0.03} numOctaves={2} seed={8} opacity={0.2} fill="#223344" />
      <div style={{ backgroundImage: MOTTLE, backgroundSize: "840px 840px" }} />
      <div style={{ backgroundImage: TOOTH, backgroundSize: "220px 220px" }} />
      <svg viewBox="0 0 100 100">
        <defs><pattern id="stripes" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" width="8" height="8"><path d="M0 0 L0 8" stroke="#fff" /></pattern></defs>
        <rect width="100" height="100" fill="url(#stripes)" />
      </svg>
      <ScaleMark scale="1:500" point={[4, 5]} />
      <span id="measurement">{measurement}</span>
      <span id="page-context">{current}/{total}:{active ? "active" : "inactive"}</span>
      <Steps><Step duration={240}><span id="step-content">Ready</span></Step></Steps>
    </main>
  );
}
`;
  expect(sourceTsx).not.toMatch(/data:image|base64/i);

  const compiled = await compileSlideSource(sourceTsx, {
    ownerEmail: "fixture@example.invalid",
  });
  const stored = readStoredSlideSource(
    JSON.stringify({
      appId: "slides-2",
      slides: [
        {
          id: "arden-sanitized-1",
          sourceTsx,
          sourceHash: compiled.sourceHash,
          revision: 1,
          content: compiled.content,
        },
      ],
    }),
    "arden-sanitized-1",
  );

  expect(stored.sourceHash).toBe(compiled.sourceHash);
  expect(stored.slide.content).toBe(compiled.content);
  expect(compiled.content).toContain("<feTurbulence");
  expect(compiled.content).toContain('patternUnits="userSpaceOnUse"');

  await withLiveSlide(
    stored.slide.sourceTsx,
    async ({ frame, messages, errors }) => {
      const received = await messages();
      expect(received.some((message: any) => message.type === "ready")).toBe(
        true,
      );
      expect(received.some((message: any) => message.type === "error")).toBe(
        false,
      );
      expect(errors).toEqual([]);
      expect(await frame.locator("#scale-mark").innerText()).toBe("1:500:4:5");
      expect(await frame.locator("#measurement").innerText()).toBe("14.0");
      expect(await frame.locator("#page-context").innerText()).toBe(
        "1/1:active",
      );
      expect(await frame.locator("#step-content").innerText()).toBe("Ready");
      expect(await frame.locator("feTurbulence").count()).toBe(1);
      expect(await frame.locator("#stripes").count()).toBe(1);
    },
  );
});

test("live React mount executes effects and event handlers in a sandboxed frame", async () => {
  const runtime = await buildReactSlideRuntime(
    `import React, { useEffect, useState } from "react";
     export default function Slide() {
       const [message, setMessage] = useState("before effect");
       const [ticks, setTicks] = useState(0);
       useEffect(() => {
         const timeoutId = window.setTimeout(() => setMessage("timer fired"), 10);
         const intervalId = window.setInterval(() => setTicks((value) => value + 1), 50);
         return () => {
           window.clearTimeout(timeoutId);
           window.clearInterval(intervalId);
         };
       }, []);
       return <div id="live-check" data-ticks={ticks} style={{ color: "rgb(10, 20, 30)" }} onClick={() => setMessage("clicked")}>{message}</div>;
     }`,
    { current: 1, total: 1, assetUrls: new Map() },
  );
  const artifact = {
    protocolVersion: 1 as const,
    deckId: "live-check-deck",
    slideId: "live-check-slide",
    revision: 1,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html: '<div id="live-check">static markup</div>',
    assetOrigins: [],
    runtime,
  };
  const srcDoc = buildSlideSrcDoc(
    artifact,
    "live-check-nonce",
    "https://slides-2.agent-native.com",
    null,
    "live",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.evaluate((content) => {
      (window as any).__messages = [];
      addEventListener("message", (event) =>
        (window as any).__messages.push(event.data),
      );
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.srcdoc = content;
      document.body.append(frame);
    }, srcDoc);
    await page.waitForFunction(
      () =>
        (window as any).__messages?.some((item: any) =>
          ["ready", "error"].includes(item.type),
        ),
      null,
      { timeout: 5000 },
    );
    const initialEvents = await page.evaluate(() => (window as any).__messages);
    expect(
      initialEvents.some((item: any) => item.type === "ready"),
      JSON.stringify({ initialEvents, errors }),
    ).toBe(true);
    expect(initialEvents.some((item: any) => item.type === "error")).toBe(
      false,
    );
    expect(errors).toEqual([]);
    const frame = page.frames()[1];
    expect(frame.url()).toBe("about:srcdoc");
    const target = frame.locator("#live-check");
    await frame.waitForFunction(
      () =>
        document.querySelector("#live-check")?.textContent === "timer fired",
      null,
      { timeout: 2000 },
    );
    await frame.waitForFunction(
      () =>
        Number(
          document.querySelector("#live-check")?.getAttribute("data-ticks"),
        ) > 0,
      null,
      { timeout: 2000 },
    );
    const afterEffect = await target.innerText();
    const color = await target.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await target.click();
    await frame.waitForFunction(
      () => document.querySelector("#live-check")?.textContent === "clicked",
      null,
      { timeout: 2000 },
    );
    const afterClick = await target.innerText();
    const events = await page.evaluate(() =>
      (window as any).__messages.map((item: any) => item.type),
    );
    expect(afterEffect).toBe("timer fired");
    expect(color).toBe("rgb(10, 20, 30)");
    expect(afterClick).toBe("clicked");
    expect(events).toContain("rendered");
  } finally {
    await browser.close();
  }
});

test("live React mount caps reduced-motion media query listeners", async () => {
  const registrations = Array.from(
    { length: 65 },
    () => 'query.addEventListener("change", () => {});',
  ).join("\n");
  await withLiveSlide(
    `import React, { useEffect } from "react";
     export default function Slide() {
       useEffect(() => {
         const query = window.matchMedia("(prefers-reduced-motion: reduce)");
         ${registrations}
       }, []);
       return <main>Listener budget</main>;
     }`,
    async ({ frame, messages }) => {
      await frame.waitForTimeout(50);
      const events = await messages();
      expect(
        events.some((item: any) => item.type === "error"),
        JSON.stringify(events),
      ).toBe(true);
    },
  );
});

test("live React mount ignores media query listeners registered during unmount", async () => {
  await withLiveSlide(
    `import React, { useEffect } from "react";
     export default function Slide() {
       useEffect(() => {
         const query = window.matchMedia("(prefers-reduced-motion: reduce)");
         return () => query.addEventListener("change", () => {
           throw "media query listener survived unmount";
         });
       }, []);
       return <main>Unmount listener cleanup</main>;
     }`,
    async ({ frame, page, errors }) => {
      await frame.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(errors).toEqual([]);
    },
  );
});

test("live grid layouts resolve repeated tracks and gaps", async () => {
  await withLiveSlide(
    `export default function Slide() {
       return <div id="grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24 }}><div>First</div><div>Second</div></div>;
     }`,
    async ({ frame, messages, errors }) => {
      const events = await messages();
      expect(events.some((item: any) => item.type === "ready")).toBe(true);
      expect(events.some((item: any) => item.type === "error")).toBe(false);
      expect(errors).toEqual([]);

      const grid = frame.locator("#grid");
      await frame.waitForFunction(
        () => document.querySelector("#grid")?.children.length === 2,
        null,
        { timeout: 2000 },
      );
      const layout = await grid.evaluate((element) => {
        const style = getComputedStyle(element);
        const children = Array.from(element.children, (child) => {
          const { left, right, top } = child.getBoundingClientRect();
          return { left, right, top };
        });
        return {
          display: style.display,
          columns: style.gridTemplateColumns.trim().split(/\s+/),
          columnGap: style.columnGap,
          children,
        };
      });

      expect(await grid.innerText()).toBe("First\nSecond");
      expect(layout.display).toBe("grid");
      expect(layout.columns).toHaveLength(2);
      expect(layout.columnGap).toBe("24px");
      expect(layout.children).toHaveLength(2);
      expect(layout.children[1]!.left).toBeGreaterThan(
        layout.children[0]!.right,
      );
      expect(layout.children[1]!.top).toBe(layout.children[0]!.top);
    },
  );
});

test.each([
  [
    "ImagePlaceholder",
    `import React, { useState } from "react";
     import { ImagePlaceholder } from "@agent-native/slides-core";
     export default function Slide() {
       const [result, setResult] = useState("waiting");
       const inspect = (event) => setResult(
         event.nativeEvent || event.view || event.target.ownerDocument || event.currentTarget.ownerDocument || event.relatedTarget || event.composedPath || event.isDefaultPrevented
           ? "raw event exposed"
           : "filtered event"
       );
       return <><ImagePlaceholder hint="Click" width={220} height={120} onClick={inspect} /><div id="event-result">{result}</div></>;
     }`,
    "#slide-root [data-slide-placeholder]",
  ],
  [
    "MorphElement",
    `import React, { useState } from "react";
     import { MorphElement } from "@agent-native/slides-core";
     export default function Slide() {
       const [result, setResult] = useState("waiting");
       const inspect = (event) => setResult(
         event.nativeEvent || event.view || event.target.ownerDocument || event.currentTarget.ownerDocument || event.relatedTarget || event.composedPath || event.isDefaultPrevented
           ? "raw event exposed"
           : "filtered event"
       );
       return <><MorphElement id="target" onClick={inspect}><h2 id="morph-target">Click</h2></MorphElement><div id="event-result">{result}</div></>;
     }`,
    "#morph-target",
  ],
])(
  "built-in %s event props receive a filtered event view",
  async (_name, source, target) => {
    await withLiveSlide(source, async ({ frame, messages, errors }) => {
      const initial = await messages();
      expect(initial.some((item: any) => item.type === "ready")).toBe(true);
      expect(initial.some((item: any) => item.type === "error")).toBe(false);
      expect(errors).toEqual([]);
      await frame.locator(target).click();
      await frame.waitForFunction(
        () =>
          document.querySelector("#event-result")?.textContent ===
          "filtered event",
        null,
        { timeout: 2000 },
      );
      expect(await frame.locator("#event-result").innerText()).toBe(
        "filtered event",
      );
    });
  },
);

test.each([
  [
    "arbitrary element names",
    `import { MorphElement } from "@agent-native/slides-core";
     export default function Slide() { return <MorphElement id="unsafe" as="iframe" />; }`,
  ],
  [
    "frame nonce attributes",
    `import { ImagePlaceholder } from "@agent-native/slides-core";
     export default function Slide() { return <ImagePlaceholder hint="safe" nonce="test-value" />; }`,
  ],
])("built-in wrappers reject %s", async (_label, source) => {
  await withLiveSlide(source, async ({ frame, messages }) => {
    const events = await messages();
    expect(events.some((item: any) => item.type === "error")).toBe(true);
    expect(events.some((item: any) => item.type === "ready")).toBe(false);
    expect(await frame.locator("iframe").count()).toBe(0);
    expect(await frame.locator("#slide-root [nonce]").count()).toBe(0);
  });
});
