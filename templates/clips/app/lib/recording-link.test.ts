// @vitest-environment happy-dom

/**
 * Regression coverage for the referral-attribution loss traced to this repo's
 * production data: `referral_source` shows up on ~2%/14d of clip signups but
 * `referrer_user` (the `via` query param) never does. Root cause — every
 * surface that auto-copies a fresh recording's share link right after it's
 * created (record.tsx's post-stop toast, the stitched-clip toast) called the
 * bare `copyRecordingShareLink(recordingId)` with no owner id, even though
 * the signed-in recorder always owns the recording they just made. `ref=` (and
 * therefore `referral_source`) still landed because `withShareAttribution`
 * sets it unconditionally; `via=` (and `referrer_user`) never did.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

const writeClipboardText = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/clipboard", () => ({ writeClipboardText }));

import {
  copyFreshRecordingShareLink,
  freshRecordingShareUrl,
} from "./recording-link";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("freshRecordingShareUrl", () => {
  it("tags the link with the signed-in recorder's id — they always own what they just recorded", () => {
    const url = freshRecordingShareUrl("rec_1", { userId: "user_42" });
    expect(new URL(url).searchParams.get("via")).toBe("user_42");
    expect(new URL(url).searchParams.get("ref")).toBe("clip_share");
  });

  it("omits via (never referrer_user) when there is no session", () => {
    const url = freshRecordingShareUrl("rec_1", null);
    expect(new URL(url).searchParams.has("via")).toBe(false);
    expect(new URL(url).searchParams.get("ref")).toBe("clip_share");
  });
});

describe("copyFreshRecordingShareLink", () => {
  beforeEach(() => {
    writeClipboardText.mockReset();
    writeClipboardText.mockResolvedValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it("copies a via-tagged link for the signed-in recorder", async () => {
    await copyFreshRecordingShareLink("rec_1", { userId: "user_42" });
    expect(writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("via=user_42"),
    );
  });
});

describe("auto-copy call sites route through the attributed helper", () => {
  it("record.tsx's post-stop/post-upload copies are all attributed", () => {
    const source = readSource("../routes/record.tsx");
    expect(source).toContain(
      'import { copyFreshRecordingShareLink } from "@/lib/recording-link"',
    );
    expect(source).not.toContain("copyRecordingShareLink(");
    const calls = source.match(/copyFreshRecordingShareLink\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it("the stitch-manager toast copy is attributed", () => {
    const source = readSource("../components/editor/stitch-manager.tsx");
    expect(source).toContain(
      'import { copyFreshRecordingShareLink } from "@/lib/recording-link"',
    );
    expect(source).not.toContain("copyRecordingShareLink(");
  });
});
