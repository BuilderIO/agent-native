import { getUserSettingEntry, putSetting } from "@agent-native/core/settings";
import { expect, it, vi } from "vitest";

import read from "./get-editor-preferences";
import write from "./set-editor-preferences";
const m = vi.hoisted(() => {
  process.env.DATABASE_URL = "pglite::memory:";
  return { email: "one@example.test" as string | undefined };
});
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => m.email,
}));
it("report 455/456: settings persist per user and patches preserve the other choice", async () => {
  m.email = "one@example.test";
  expect(await read.run({}, {} as never)).toEqual({
    lineNumbers: true,
    fullWidthCells: true,
  });
  await write.run({ agentOpen: true }, {} as never);
  await write.run({ lineNumbers: true }, {} as never);
  await write.run({ fullWidthCells: false }, {} as never);
  expect(await read.run({}, {} as never)).toEqual({
    lineNumbers: true,
    fullWidthCells: false,
    agentOpen: true,
  });
  expect(
    await getUserSettingEntry(
      "one@example.test",
      "analytics-2:editor-preferences",
      { bypassCache: true },
    ),
  ).toEqual({
    found: true,
    value: { lineNumbers: true, fullWidthCells: false, agentOpen: true },
  });
  m.email = "two@example.test";
  expect(await read.run({}, {} as never)).toEqual({
    lineNumbers: true,
    fullWidthCells: true,
  });
  await write.run({ lineNumbers: true }, {} as never);
  m.email = "one@example.test";
  expect(await read.run({}, {} as never)).toEqual({
    lineNumbers: true,
    fullWidthCells: false,
    agentOpen: true,
  });
  await write.run({ agentOpen: false }, {} as never);
  expect(await read.run({}, {} as never)).toEqual({
    lineNumbers: true,
    fullWidthCells: false,
    agentOpen: false,
  });
  m.email = undefined;
  await expect(read.run({}, {} as never)).rejects.toThrow("Not authenticated");
  expect(write.schema.safeParse({ bogus: true }).success).toBe(false);
});

it("rejects corrupted preferences rather than treating them as missing", async () => {
  m.email = "corrupt@example.test";
  await putSetting(
    "u:corrupt@example.test:analytics-2:editor-preferences",
    null,
  );
  await expect(read.run({}, {} as never)).rejects.toThrow();
  await expect(write.run({ lineNumbers: true }, {} as never)).rejects.toThrow();
  expect(
    await getUserSettingEntry(m.email, "analytics-2:editor-preferences", {
      bypassCache: true,
    }),
  ).toEqual({ found: true, value: null });
});
