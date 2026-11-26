import { describe, expect, it } from "vitest";

import {
  keepParentRevealAsToggled,
  settleParentReveal,
  startParentReveal,
  type ParentReveals,
} from "./parent-reveals";

describe("parent reveals", () => {
  it("opens a closed folder for a write and closes it again when the write fails", () => {
    const reveals: ParentReveals = new Map();
    expect(startParentReveal(reveals, "folder", false)).toBe(true);
    expect(settleParentReveal(reveals, "folder", false)).toBe(true);
    expect(reveals.size).toBe(0);
  });

  it("leaves a folder open when the write succeeds, and never touches one that was open", () => {
    const reveals: ParentReveals = new Map();
    expect(startParentReveal(reveals, "closed", false)).toBe(true);
    expect(settleParentReveal(reveals, "closed", true)).toBe(false);
    expect(startParentReveal(reveals, "open", true)).toBe(false);
    expect(settleParentReveal(reveals, "open", false)).toBe(false);
  });

  it("closes a folder only after its last write settles, and keeps it open if any succeeded", () => {
    const reveals: ParentReveals = new Map();
    expect(startParentReveal(reveals, "folder", false)).toBe(true);
    expect(startParentReveal(reveals, "folder", true)).toBe(false);
    expect(settleParentReveal(reveals, "folder", false)).toBe(false);
    expect(settleParentReveal(reveals, "folder", false)).toBe(true);

    expect(startParentReveal(reveals, "folder", false)).toBe(true);
    expect(startParentReveal(reveals, "folder", true)).toBe(false);
    expect(settleParentReveal(reveals, "folder", true)).toBe(false);
    expect(settleParentReveal(reveals, "folder", false)).toBe(false);
  });

  it("leaves a folder as the person set it while its write was pending, even if the write fails", () => {
    const reveals: ParentReveals = new Map();
    expect(startParentReveal(reveals, "folder", false)).toBe(true);
    // Closed and opened again by hand while the move waits on the server.
    keepParentRevealAsToggled(reveals, "folder");
    keepParentRevealAsToggled(reveals, "folder");
    expect(settleParentReveal(reveals, "folder", false)).toBe(false);
  });

  it("ignores toggles of folders no write revealed", () => {
    const reveals: ParentReveals = new Map();
    keepParentRevealAsToggled(reveals, "folder");
    expect(reveals.size).toBe(0);
    expect(startParentReveal(reveals, "folder", false)).toBe(true);
    expect(settleParentReveal(reveals, "folder", false)).toBe(true);
  });
});
