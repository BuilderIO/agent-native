import { describe, expect, it, vi } from "vitest";

// Stub the heavy MCP SDK + builtin-tools so importing build-server.ts is
// cheap — this spec only exercises `conciseToolResultText`.
vi.mock("./builtin-tools.js", () => ({ getBuiltinCrossAppTools: () => ({}) }));

const { conciseToolResultText } = await import("./build-server.js");

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
});
