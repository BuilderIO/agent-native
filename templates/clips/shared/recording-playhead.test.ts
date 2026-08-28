import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("the recording playhead has a shared visual source", () => {
  it("keeps the component and its styles in shared/", () => {
    expect(
      existsSync(new URL("./recording-playhead.tsx", import.meta.url)),
    ).toBe(true);
    expect(
      existsSync(new URL("./recording-playhead.css", import.meta.url)),
    ).toBe(true);
  });

  it("routes both recorder surfaces through the shared component", () => {
    const consumers = [
      new URL(
        "../app/components/recorder/recording-toolbar.tsx",
        import.meta.url,
      ),
      new URL("../desktop/src/overlays/record-pill.tsx", import.meta.url),
    ];
    for (const consumer of consumers) {
      expect(readFileSync(consumer, "utf8"), consumer.pathname).toContain(
        "recording-playhead",
      );
    }
  });
});
