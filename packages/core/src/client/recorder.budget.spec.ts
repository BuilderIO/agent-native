// @vitest-environment happy-dom
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { afterEach, expect, it } from "vitest";

import {
  recordActionStart,
  recorder,
  recordStateWrite,
  resetRecorderForTests,
} from "./recorder.js";

const EVENTS = 10_000;
const MAX_MICROS_PER_EVENT = 1_000;
const MAX_HEAP_GROWTH_BYTES = 2 * 1024 * 1024;

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

function heapUsed(): number {
  gc();
  return process.memoryUsage().heapUsed;
}

function selection(i: number) {
  return {
    designId: "d_8f2c1a",
    activeFileId: "f_home",
    viewMode: "single",
    zoom: 100,
    screens: Array.from({ length: 6 }, (_, s) => ({
      id: `f_${s}`,
      filename: `screen-${s}.html`,
      width: 1440,
      height: 900,
    })),
    selectedScreenIds: ["f_home"],
    selectedElement: {
      tagName: "button",
      sourceId: `n${i % 40}`,
      selector: `[data-agent-native-node-id="n${i % 40}"]`,
      classes: ["btn", "btn-primary"],
      textContent: "Get started",
      boundingRect: { x: 120, y: 340, width: 160, height: 48 },
      computedStyles: {
        opacity: i % 2 ? "0.97" : "0.91",
        width: "160px",
        height: "48px",
        color: "rgb(255, 255, 255)",
        backgroundColor: "rgb(37, 99, 235)",
      },
    },
    mode: "edit",
  };
}

async function microsPerEvent(record: (i: number) => void): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < EVENTS; i += 1) record(i);
  // State writes record when their promise settles.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return ((performance.now() - started) * 1000) / EVENTS;
}

afterEach(() => resetRecorderForTests());

it("records an action, state write, or log in under 1 ms", async () => {
  const saved = Promise.resolve();
  const failure = Object.assign(
    new Error("Action update-file failed: Forbidden"),
    {
      status: 403,
      errorCode: "forbidden",
    },
  );

  const micros = {
    log: await microsPerEvent((i) =>
      recorder.log("checkout.started", { cartId: `c_${i}`, items: 3 }),
    ),
    action: await microsPerEvent((i) =>
      recordActionStart(
        "update-file",
        "POST",
      )({
        error: i % 10 === 0 ? failure : undefined,
        response: undefined,
        signal: undefined,
      }),
    ),
    state: await microsPerEvent((i) =>
      recordStateWrite("design-selection", selection(i), saved, undefined),
    ),
  };

  console.log(`[recorder budget] µs per event ${JSON.stringify(micros)}`);
  for (const value of Object.values(micros)) {
    expect(value).toBeLessThan(MAX_MICROS_PER_EVENT);
  }
});

it("holds a full buffer of the largest events under its memory cap", async () => {
  const largest = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`field${i}`, "x".repeat(300)]),
  );
  const saved = Promise.resolve();
  // Compiles the redaction patterns first, so only the buffer is measured.
  for (let i = 0; i < 50; i += 1) recorder.log("warm", { i, ...largest });
  resetRecorderForTests();
  const before = heapUsed();

  for (let i = 0; i < EVENTS; i += 1) recorder.log("big", { i, ...largest });
  for (let key = 0; key < 50; key += 1) {
    recordStateWrite(
      `state-${key}`,
      { key, ...largest, ...selection(key) },
      saved,
      undefined,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const growth = heapUsed() - before;
  const report = recorder.report();
  const reportChars = JSON.stringify(report).length;

  console.log(
    `[recorder budget] heap growth ${Math.round(growth / 1024)} KB; report of ${report.events.length} events, ${Math.round(reportChars / 1024)} KB, dropped ${report.dropped}`,
  );
  expect(growth).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
  expect(reportChars).toBeLessThan(600 * 1024);
  expect(report.dropped).toBe(EVENTS + 50 - report.events.length);
});
