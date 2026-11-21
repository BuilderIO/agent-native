import { expect, it, vi } from "vitest";

const { recordChange, serverless, userEmail } = vi.hoisted(() => ({
  recordChange: vi.fn(),
  serverless: vi.fn<() => boolean>(),
  userEmail: vi.fn<() => string | undefined>(),
}));

vi.mock("./poll.js", () => ({ recordChange }));
vi.mock("../db/migration-runtime.js", () => ({
  isProductionServerlessFunctionRuntime: serverless,
}));
vi.mock("./request-context.js", () => ({ getRequestUserEmail: userEmail }));

import { markActiveTurn } from "./active-turn.js";

it("keeps an authenticated serverless turn warm for 30 seconds", () => {
  serverless.mockReturnValue(true);
  userEmail.mockReturnValue("member@example.test");
  const now = vi.spyOn(Date, "now").mockReturnValue(1234);
  try {
    markActiveTurn();
    expect(recordChange).toHaveBeenCalledExactlyOnceWith({
      source: "active_turn",
      type: "change",
      owner: "member@example.test",
      activeUntil: 31234,
    });
  } finally {
    now.mockRestore();
  }
});

it("skips turns outside serverless and without an owner", () => {
  recordChange.mockClear();
  serverless.mockReturnValue(false);
  markActiveTurn("member@example.test");
  serverless.mockReturnValue(true);
  userEmail.mockReturnValue(undefined);
  markActiveTurn();
  expect(recordChange).not.toHaveBeenCalled();
});
