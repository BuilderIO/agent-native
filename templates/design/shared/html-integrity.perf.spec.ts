import { describe, expect, it } from "vitest";

import { inspectDesignHtmlDocumentIntegrity } from "./html-integrity";

function median(samples: number[]): number {
  return [...samples].sort((left, right) => left - right)[
    Math.floor(samples.length / 2)
  ]!;
}

function measure(html: string): number {
  const start = performance.now();
  const result = inspectDesignHtmlDocumentIntegrity(html);
  const elapsed = performance.now() - start;
  expect(result.valid).toBe(true);
  return elapsed;
}

function expectLinearScaling(
  warmupHtml: string,
  smallHtml: string,
  largeHtml: string,
): void {
  for (const html of [warmupHtml, smallHtml, largeHtml]) {
    expect(inspectDesignHtmlDocumentIntegrity(html).valid).toBe(true);
  }

  const smallSamples: number[] = [];
  const largeSamples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    if (sample % 2 === 0) {
      smallSamples.push(measure(smallHtml));
      largeSamples.push(measure(largeHtml));
    } else {
      largeSamples.push(measure(largeHtml));
      smallSamples.push(measure(smallHtml));
    }
  }

  expect(median(largeSamples)).toBeLessThan(
    Math.max(median(smallSamples), 1) * 10,
  );
}

describe("Design HTML integrity performance", () => {
  it("stays linear across many raw-text blocks", () => {
    const build = (count: number) =>
      `<!doctype html><html><head><meta charset="UTF-8"></head><body>${"<style>.a{color:red}</style><script>var a=1</script>".repeat(count)}</body></html>`;

    expectLinearScaling(build(400), build(800), build(3200));
  });

  it("stays linear on large valid documents", () => {
    const build = (count: number) =>
      `<!doctype html><html><head><meta charset="UTF-8"></head><body>${"<div>x</div>".repeat(count)}</body></html>`;

    expectLinearScaling(build(1000), build(2000), build(8000));
  });
});
