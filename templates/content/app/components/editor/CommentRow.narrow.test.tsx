// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentRow, useCommentTimestamp } from "./CommentRow";

const { formatRelativeTime } = vi.hoisted(() => ({
  formatRelativeTime: vi.fn(
    (
      amount: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat("en-US", options).format(amount, unit),
  ),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: () => "Sep 10, 2026, 9:00 AM",
    formatRelativeTime,
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => <>{content}</>,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-09-10T12:00:00Z").getTime();

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  formatRelativeTime.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Labels({ ages }: { ages: number[] }) {
  const timestamp = useCommentTimestamp();
  return (
    <ul>
      {ages.map((age) => (
        <li key={age}>{timestamp(NOW - age).label}</li>
      ))}
    </ul>
  );
}

describe("comment header in a 320px column", () => {
  it("labels recent activity in the narrow relative style", () => {
    const minute = 60_000;
    act(() =>
      root.render(
        <Labels
          ages={[10_000, 7 * minute, 3 * 60 * minute, 14 * 1440 * minute]}
        />,
      ),
    );

    expect(
      [...host.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["now", "7m ago", "3h ago", "2w ago"]);
    for (const [, , options] of formatRelativeTime.mock.calls) {
      expect(options?.style).toBe("narrow");
    }
  });

  it("keeps the name on its own line and lets badge and time wrap beneath it", () => {
    act(() =>
      root.render(
        <CommentRow
          avatar={null}
          name="Alexandra Featherstonehaugh"
          badge={<span data-testid="badge">Agent</span>}
          timestamp={{ label: "7m ago", title: "Sep 10, 2026, 11:53 AM" }}
          actions={<button type="button">More</button>}
        />,
      ),
    );

    const identity = host.querySelector("[data-comment-row-identity]");
    expect(identity?.className).toContain("flex-wrap");
    expect(identity?.className).toContain("flex-1");
    expect(identity?.textContent).toContain("Alexandra Featherstonehaugh");
    expect(identity?.querySelector("time")?.textContent).toBe("7m ago");
    expect(identity?.querySelector("time")?.getAttribute("title")).toBe(
      "Sep 10, 2026, 11:53 AM",
    );

    const actions = host.querySelector("[data-comment-row-actions]");
    expect(identity?.contains(actions ?? null)).toBe(false);
    expect(actions?.className).toContain("shrink-0");
    expect(actions?.className).not.toContain("invisible");
  });

  it("reserves hover-revealed actions so revealing them never reflows the card", () => {
    act(() =>
      root.render(
        <CommentRow
          avatar={null}
          name="Sam"
          revealActions="hover"
          actions={<button type="button">More</button>}
        />,
      ),
    );

    const actions = host.querySelector("[data-comment-row-actions]");
    const classes = actions?.className.split(/\s+/) ?? [];
    expect(classes).toContain("invisible");
    expect(classes).toContain("group-hover/comment:visible");
    expect(classes).toContain("group-focus-within/comment:visible");
    expect(classes).toContain("pointer-coarse:visible");
    expect(classes).not.toContain("hidden");
  });

  it("wraps long suggestion summaries to two lines instead of one", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CommentsSidebar.tsx"),
      "utf8",
    );

    expect(source).toContain(
      '<span className="line-clamp-2 min-w-0 flex-1 break-words font-medium">',
    );
    expect(source).not.toContain(
      '<span className="min-w-0 flex-1 truncate font-medium">',
    );
  });
});
