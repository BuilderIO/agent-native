import { readFileSync } from "node:fs";

import { vectorEndpointMarkerRefX } from "@shared/vector-endpoints";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./MultiScreenCanvas.tsx", import.meta.url),
  "utf8",
);

describe("screen selection chrome", () => {
  it("keeps draft vector endpoint marker reference points symmetric", () => {
    const start = source.indexOf("function DraftPrimitiveContent(");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 10_000);
    expect(body).toContain("refX={vectorEndpointMarkerRefX(endpoint)}");
    expect(vectorEndpointMarkerRefX("reversed-triangle")).toBe("0");
    expect(vectorEndpointMarkerRefX("triangle")).toBe("8");
    expect(body).toContain("orient={vectorEndpointMarkerOrientation(side)}");
  });
});
