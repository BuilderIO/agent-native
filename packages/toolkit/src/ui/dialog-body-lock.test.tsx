// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { releaseStaleBodyLock } from "./dialog.js";

/**
 * The page-dead bug: a menu item opens a dialog, the dialog closes, and the
 * menu's cleanup writes `pointer-events: none` back onto the body. Nothing in
 * Radix clears it, so the page looks normal and ignores every click.
 */
describe("dialog body lock restore", () => {
  afterEach(() => {
    document.body.style.pointerEvents = "";
    document.body.innerHTML = "";
    document.body.removeAttribute("data-scroll-locked");
  });

  it("clears a stale pointer-events lock once no layer is open", () => {
    document.body.style.pointerEvents = "none";
    releaseStaleBodyLock();
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("clears a stale scroll lock, including the padding it added", () => {
    document.body.setAttribute("data-scroll-locked", "1");
    document.body.style.paddingRight = "15px";
    document.body.style.overflow = "hidden";
    releaseStaleBodyLock();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(document.body.style.paddingRight).toBe("");
    expect(document.body.style.overflow).toBe("");
  });

  it("leaves the lock alone while a dialog is still open", () => {
    document.body.style.pointerEvents = "none";
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.append(dialog);
    releaseStaleBodyLock();
    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("leaves the lock alone while a menu is still open", () => {
    document.body.style.pointerEvents = "none";
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-state", "open");
    document.body.append(menu);
    releaseStaleBodyLock();
    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("does not touch a lock a menu is still animating out of", () => {
    // A closing menu is exactly what writes the stale lock, so it must not count
    // as an open layer or the restore would never run.
    document.body.style.pointerEvents = "none";
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-state", "closed");
    document.body.append(menu);
    releaseStaleBodyLock();
    expect(document.body.style.pointerEvents).toBe("");
  });
});

/**
 * The focus half of the same bug. Radix returns focus to the trigger when a dialog
 * closes; when the dialog was opened from a menu item, that trigger lives inside a
 * menu that has already closed, so focus lands in a `data-state="closed"` subtree and
 * the menu trigger stops responding. Measured on the served build in two apps.
 */
describe("dialog stale focus release", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("blurs an element left focused inside a closed layer", async () => {
    const { releaseStaleFocus } = await import("./dialog.js");
    const closed = document.createElement("div");
    closed.setAttribute("data-state", "closed");
    const input = document.createElement("input");
    closed.append(input);
    document.body.append(closed);
    input.focus();
    expect(document.activeElement).toBe(input);
    releaseStaleFocus();
    expect(document.activeElement).not.toBe(input);
  });

  it("leaves focus alone while a dialog is still open", async () => {
    const { releaseStaleFocus } = await import("./dialog.js");
    const open = document.createElement("div");
    open.setAttribute("role", "dialog");
    open.setAttribute("data-state", "open");
    const input = document.createElement("input");
    open.append(input);
    document.body.append(open);
    input.focus();
    releaseStaleFocus();
    expect(document.activeElement).toBe(input);
  });

  it("leaves focus alone when it is not inside a closed layer", async () => {
    const { releaseStaleFocus } = await import("./dialog.js");
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    releaseStaleFocus();
    expect(document.activeElement).toBe(input);
  });
});
