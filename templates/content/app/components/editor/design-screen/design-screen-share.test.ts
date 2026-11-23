import type { EmbedVisibility } from "@agent-native/core/shared";
import type { DesignScreenData } from "@shared/design-screen-block";
import { describe, expect, it } from "vitest";

import {
  designShareAsks,
  designShareCheck,
  designShareDetail,
  subPageScreensRead,
} from "./design-screen-share";

function screen(
  design: EmbedVisibility,
  title = `${design} design`,
): Pick<DesignScreenData, "screen" | "design"> {
  return {
    design: {
      id: `${design}-design`,
      title,
      url: "https://design.example.test/design/checkout",
      visibility: design,
    },
    screen: {
      id: "pay",
      name: "Pay",
      width: 390,
      fingerprint: "0123456789ab",
      url: "https://design.example.test/design/checkout?screen=pay",
    },
  };
}

const NONE = { screens: [], unread: false };

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

describe("designShareCheck", () => {
  it("asks before sharing a page wider than a design it pins a screen from", () => {
    const check = designShareCheck(
      "org",
      { screens: [screen("private")], unread: false },
      NONE,
    );
    expect(check.page.wider).toHaveLength(1);
    expect(check.subPages).toBeNull();
    expect(designShareAsks(check)).toBe(true);
    expect(designShareDetail(check, t)).toBe(
      'designScreen.shareDetailOne {"designs":"private design"}',
    );
  });

  it("asks before making a page public when a sub-page pins a screen from a narrower design", () => {
    const check = designShareCheck("public", NONE, {
      screens: [screen("org", "Checkout"), screen("private", "Checkout")],
      unread: false,
    });
    expect(check.page.wider).toEqual([]);
    expect(check.subPages?.wider).toHaveLength(2);
    expect(designShareAsks(check)).toBe(true);
    expect(designShareDetail(check, t)).toBe(
      'designScreen.shareDetailSubPages {"count":2,"designs":"Checkout"}',
    );
  });

  it("asks while the page or its sub-pages haven't been read", () => {
    const check = designShareCheck(
      "public",
      { screens: [], unread: true },
      { screens: [], unread: true },
    );
    expect(designShareAsks(check)).toBe(true);
    expect(designShareDetail(check, t)).toBe(
      "designScreen.shareDetailUnread designScreen.shareDetailSubPagesUnread",
    );
  });

  it("doesn't ask when every screen's design is open as widely", () => {
    const check = designShareCheck(
      "public",
      { screens: [screen("public")], unread: false },
      { screens: [screen("public")], unread: false },
    );
    expect(designShareAsks(check)).toBe(false);
    expect(designShareDetail(check, t)).toBeNull();
  });

  it("leaves sub-pages out of a change that doesn't make the page public", () => {
    const check = designShareCheck("org", NONE, {
      screens: [screen("private")],
      unread: true,
    });
    expect(check.subPages).toBeNull();
    expect(designShareAsks(check)).toBe(false);
  });
});

describe("subPageScreensRead", () => {
  const whole = { screens: [screen("org")], unreadable: 0, more: false };
  const settled = { isError: false, isFetching: false };

  it("weighs a whole answer", () => {
    expect(subPageScreensRead({ data: whole, ...settled })).toEqual({
      screens: whole.screens,
      unread: false,
    });
  });

  it("keeps the sub-pages unread until there's a whole answer to weigh", () => {
    for (const query of [
      { data: undefined, ...settled },
      { data: {}, ...settled },
      { data: whole, isError: false, isFetching: true },
      { data: whole, isError: true, isFetching: false },
      { data: { ...whole, unreadable: 1 }, ...settled },
      { data: { ...whole, more: true }, ...settled },
    ]) {
      expect(subPageScreensRead(query)).toEqual({ screens: [], unread: true });
    }
  });
});
