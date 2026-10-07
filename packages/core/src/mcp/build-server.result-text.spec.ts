import { describe, expect, it, vi } from "vitest";

vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const { conciseToolResultText, textPagingInputs } =
  await import("./build-server.js");

describe("conciseToolResultText truncation notice", () => {
  it("returns text at the limit untouched", () => {
    const text = "x".repeat(2000);
    expect(conciseToolResultText("read", text)).toBe(text);
  });

  it("reports exact shown and original lengths and says the result is incomplete", () => {
    const text = conciseToolResultText("read", "x".repeat(2001));
    expect(text).toBe(
      `${"x".repeat(2000)}\n[Truncated: showing the first 2000 of 2001 characters. This result is incomplete.]`,
    );
  });

  it("names paging inputs without promising the rest", () => {
    const result = { rows: "x".repeat(9000) };
    const text = conciseToolResultText("list-rows", result, {
      paging: ["cursor", "offset"],
    });
    const total = JSON.stringify(result).length;
    expect(text).toContain(
      `[Truncated: showing the first 2000 of ${total} characters. This result is incomplete. This tool pages with cursor, offset.]`,
    );
    expect(text).not.toContain("get the rest");
  });

  it("keeps the notice ahead of the link and Next marker of a long message", () => {
    const text = conciseToolResultText("create-deck", {
      message: "x".repeat(50_000),
      url: "/deck/d1",
      nextRequiredAction: "update-slide",
    });
    expect(text).toMatch(
      /of 50000 characters\. This result is incomplete\.\] \/deck\/d1 Next: update-slide$/,
    );
  });

  it("cuts at a code point and counts code points at the 2,000 limit", () => {
    const text = conciseToolResultText("read", `${"x".repeat(1999)}😀y`);
    expect(text.isWellFormed()).toBe(true);
    expect(text).toBe(
      `${"x".repeat(1999)}😀\n[Truncated: showing the first 2000 of 2001 characters. This result is incomplete.]`,
    );
  });

  it("leaves text of exactly 2,000 code points alone even when it has astral characters", () => {
    const text = `${"x".repeat(1999)}😀`;
    expect(text.length).toBe(2001);
    expect(conciseToolResultText("read", text)).toBe(text);
  });

  it("shortens a long link with its own notice, making no claim about inputs", () => {
    const link = `${"u".repeat(499)}😀y`;
    const text = conciseToolResultText(
      "create-deck",
      {
        title: "Deck",
        id: "d1",
        url: link,
        nextRequiredAction: "update-slide",
      },
      { paging: ["cursor"] },
    );
    expect(text.isWellFormed()).toBe(true);
    expect(text).toBe(
      `Deck (d1) is ready. ${"u".repeat(499)}😀… [URL shortened: showing the first 500 of 501 characters.] Next: update-slide`,
    );
    expect(text).not.toContain("incomplete");
    expect(text).not.toContain("pages with");
  });
});

describe("textPagingInputs", () => {
  const properties = {
    cursor: {},
    offset: {},
    fields: {},
    query: {},
    filter: {},
    limit: {},
    other: {},
  };

  it("names declared paging inputs of a read-only action", () => {
    expect(textPagingInputs({ properties }, true)).toEqual([
      "cursor",
      "offset",
    ]);
  });

  it("names nothing for a search-only action", () => {
    expect(
      textPagingInputs({ properties: { query: {}, filter: {} } }, true),
    ).toEqual([]);
  });

  it("names nothing for a mutating action even when it declares paging-like inputs", () => {
    expect(textPagingInputs({ properties }, false)).toEqual([]);
    expect(
      textPagingInputs({ properties: { fields: {}, cursor: {} } }, false),
    ).toEqual([]);
  });

  it("returns nothing for a missing or property-less schema", () => {
    expect(textPagingInputs(undefined, true)).toEqual([]);
    expect(textPagingInputs({ type: "object" }, true)).toEqual([]);
  });
});

describe("conciseToolResultText", () => {
  it("keeps the deep link and surfaces nextRequiredAction as 'Next: …'", () => {
    const text = conciseToolResultText("update-deck", {
      id: "d1",
      title: "Deck",
      url: "/deck/d1",
      nextRequiredAction: "update-slide",
    });
    expect(text).toContain("(d1)");
    expect(text).toContain("/deck/d1");
    expect(text).toContain("Next: update-slide");
  });

  it("appends the link and next action to a message-based result", () => {
    const text = conciseToolResultText("create-form", {
      message: "Form created.",
      url: "/forms/f1",
      nextRequiredAction: "publish-form",
    });
    expect(text).toContain("Form created.");
    expect(text).toContain("/forms/f1");
    expect(text).toContain("Next: publish-form");
  });

  it("falls back to urlPath when url is absent", () => {
    const text = conciseToolResultText("create-plan", {
      id: "p1",
      urlPath: "/plan/p1",
    });
    expect(text).toContain("/plan/p1");
  });

  it("omits the Next line when nextRequiredAction is blank", () => {
    const text = conciseToolResultText("update-deck", {
      id: "d1",
      title: "Deck",
      nextRequiredAction: "   ",
    });
    expect(text).not.toContain("Next:");
  });

  it("keeps the link and Next marker when a long message is truncated", () => {
    const text = conciseToolResultText("create-deck", {
      message: "x".repeat(50_000),
      url: "/deck/d1",
      nextRequiredAction: "update-slide",
    });
    expect(text).toContain("/deck/d1");
    expect(text).toContain("Next: update-slide");
  });
});
