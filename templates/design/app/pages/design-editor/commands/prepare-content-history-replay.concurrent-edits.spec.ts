import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: () => false,
}));
vi.mock("@/pages/design-editor/source-publication", () => ({
  prepareAcceptedSourceContent: vi.fn(),
}));

import {
  prepareContentHistoryReplay,
  STALE_CONTENT_HISTORY_REPLAY,
} from "./prepare-content-history-replay";

const page = (alpha: string, beta: string) =>
  `<main>\n<button id="alpha" style="${alpha}">Alpha</button>\n<button id="beta" style="${beta}">Beta</button>\n</main>`;

const ORIGINAL = page("color:blue", "color:green");
const ALPHA_RED = page("color:red", "color:green");
const ALPHA_RED_BETA_ROUND = page(
  "color:red",
  "color:green;border-radius:30px",
);
const BETA_ROUND = page("color:blue", "color:green;border-radius:30px");

const replay = (
  direction: "undo" | "redo",
  change: { before: string; after: string },
  live: string,
) =>
  prepareContentHistoryReplay({
    activeFile: null,
    changes: [{ fileId: "screen-1", ...change }],
    direction,
    files: [],
    getFreshActiveContent: () => live,
    getScreenContent: () => live,
    liveScreenSnapshotsById: {},
    t: (key) => key,
  });

describe("content history replay against collaborators' edits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("undoes only this user's edit when a collaborator saved a different one since", () => {
    const prepared = replay(
      "undo",
      { before: ORIGINAL, after: ALPHA_RED },
      ALPHA_RED_BETA_ROUND,
    );
    expect(prepared).not.toBe(STALE_CONTENT_HISTORY_REPLAY);
    expect(
      (prepared as Map<string, { nextContent: string }>).get("screen-1")
        ?.nextContent,
    ).toBe(BETA_ROUND);
  });

  it("redoes only this user's edit on top of a collaborator's later edit", () => {
    const prepared = replay(
      "redo",
      { before: ORIGINAL, after: ALPHA_RED },
      BETA_ROUND,
    );
    expect(
      (prepared as Map<string, { nextContent: string }>).get("screen-1")
        ?.nextContent,
    ).toBe(ALPHA_RED_BETA_ROUND);
  });

  it("replays the recorded snapshot unchanged when nobody else touched the screen", () => {
    const prepared = replay(
      "undo",
      { before: ORIGINAL, after: ALPHA_RED },
      ALPHA_RED,
    );
    expect(
      (prepared as Map<string, { nextContent: string }>).get("screen-1")
        ?.nextContent,
    ).toBe(ORIGINAL);
  });

  it("refuses to guess when a collaborator changed the same spot", () => {
    const theirs = page("color:purple", "color:green");
    expect(replay("undo", { before: ORIGINAL, after: ALPHA_RED }, theirs)).toBe(
      STALE_CONTENT_HISTORY_REPLAY,
    );
  });
});
