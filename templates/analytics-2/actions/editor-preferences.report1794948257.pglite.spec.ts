import { expect, it, vi } from "vitest";

import read from "./get-editor-preferences";
import write from "./set-editor-preferences";

vi.hoisted(() => {
  process.env.DATABASE_URL = "pglite::memory:";
});
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => "line-numbers-report@example.test",
}));

it("report 1794948257: defaults line numbers on while preserving an explicit off choice", async () => {
  expect((await read.run({}, {} as never)).lineNumbers).toBe(true);
  await write.run({ lineNumbers: false }, {} as never);
  expect((await read.run({}, {} as never)).lineNumbers).toBe(false);
});
