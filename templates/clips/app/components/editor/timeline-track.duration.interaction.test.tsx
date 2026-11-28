// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () => ({
  IconArrowBackUp: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { DEFAULT_EDITS } from "@/lib/timestamp-mapping";

import { TimelineTrack } from "./timeline-track";

describe("TimelineTrack range duration", () => {
  it("shows exact milliseconds for short and longer selections", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = () => {};

    for (const [startMs, endMs, summary] of [
      [1_234, 1_268, "00:01.234 – 00:01.268 · 00:00.034"],
      [4_900, 4_950, "00:04.900 – 00:04.950 · 00:00.050"],
      [0, 1_500, "00:00.000 – 00:01.500 · 00:01.500"],
      [4_900, 6_000, "00:04.900 – 00:06.000 · 00:01.100"],
      [2_000, 6_000, "00:02.000 – 00:06.000 · 00:04.000"],
    ] as const) {
      act(() =>
        root.render(
          <TimelineTrack
            width={1_000}
            height={100}
            durationMs={10_000}
            edits={DEFAULT_EDITS}
            selection={{ kind: "range", startMs, endMs }}
            onSelectionChange={noop}
            onPreview={noop}
            onCommit={noop}
          />,
        ),
      );
      const matches = Array.from(container.querySelectorAll("span")).filter(
        (span) => span.textContent === summary,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.closest('[aria-hidden="true"]')).toBeNull();
    }

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
