import { describe, expect, it, vi } from "vitest";

vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const { conciseToolResultText, textRetrievalInputs } =
  await import("./build-server.js");

describe("conciseToolResultText truncation notice", () => {
  const none = { paging: [], narrowing: [] };

  it("returns text at the limit untouched", () => {
    const text = "x".repeat(2000);
    expect(conciseToolResultText("read", text, { inputs: none })).toBe(text);
  });

  it("reports the exact shown and original lengths one character past the limit", () => {
    const text = conciseToolResultText("read", "x".repeat(2001), {
      inputs: none,
    });
    expect(text).toBe(
      `${"x".repeat(2000)}\n[Truncated: showing the first 2000 of 2001 characters. This result is incomplete, and this tool has no paging or narrowing input to get the rest.]`,
    );
  });

  it("names the action's paging and narrowing inputs", () => {
    const result = { rows: "x".repeat(9000) };
    const text = conciseToolResultText("list-rows", result, {
      inputs: textRetrievalInputs({
        type: "object",
        properties: { cursor: {}, limit: {}, query: {}, title: {} },
      }),
    });
    const total = JSON.stringify(result).length;
    expect(text).toContain(
      `[Truncated: showing the first 2000 of ${total} characters. To get the rest, call this tool again and page with cursor, or narrow with limit, query.]`,
    );
    expect(text).not.toContain("incomplete");
  });

  it("offers only narrowing when the action has no paging input", () => {
    const text = conciseToolResultText("search", "x".repeat(3000), {
      inputs: textRetrievalInputs({ properties: { search: {} } }),
    });
    expect(text).toContain("call this tool again and narrow with search.]");
    expect(text).not.toContain("page with");
  });

  it("says the result is incomplete when no inputs are known", () => {
    const text = conciseToolResultText("read", "x".repeat(3000));
    expect(text).toContain("of 3000 characters. This result is incomplete");
  });

  it("keeps the notice ahead of the link and Next marker of a long message", () => {
    const text = conciseToolResultText("create-deck", {
      message: "x".repeat(50_000),
      url: "/deck/d1",
      nextRequiredAction: "update-slide",
    });
    expect(text).toMatch(
      /of 50000 characters\..*\] \/deck\/d1 Next: update-slide$/s,
    );
  });
});

describe("textRetrievalInputs", () => {
  it("lists only recognized inputs the schema declares", () => {
    expect(
      textRetrievalInputs({
        properties: { offset: {}, pageToken: {}, fields: {}, other: {} },
      }),
    ).toEqual({ paging: ["pageToken", "offset"], narrowing: ["fields"] });
  });

  it("returns nothing for a missing or property-less schema", () => {
    const empty = { paging: [], narrowing: [] };
    expect(textRetrievalInputs(undefined)).toEqual(empty);
    expect(textRetrievalInputs({ type: "object" })).toEqual(empty);
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
