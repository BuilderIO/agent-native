import { checkActionProperties } from "@agent-native/core/action-properties";
import {
  resourceGetByPath,
  resourcePut,
} from "@agent-native/core/resources/store";
import { beforeAll, expect, it, vi } from "vitest";

import {
  readPersonalPreferences,
  savePersonalPreferences,
} from "./_personal-preferences";
import readAction from "./get-personal-preferences";
import writeAction from "./set-personal-preferences";
const m = vi.hoisted(() => {
  process.env.DATABASE_URL = "pglite::memory:";
  return { email: "owner@example.test" as string | undefined };
});
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => m.email,
}));
beforeAll(async () => {
  await resourcePut(
    "other@example.test",
    "AGENTS.md",
    "Other person's instructions",
  );
});
it("saves and reads the actual personal instruction resource used by the agent without changing another owner", async () => {
  m.email = "owner@example.test";
  const before = await readPersonalPreferences();
  const saved = await savePersonalPreferences({
    content: "QA test: prefer numbered steps.",
    expectedOwner: before.owner,
    expectedRevision: before.revision,
  });
  expect(saved.content).toBe("QA test: prefer numbered steps.");
  expect(await readPersonalPreferences()).toEqual(saved);
  expect(
    (await resourceGetByPath("owner@example.test", "AGENTS.md"))?.content,
  ).toBe("QA test: prefer numbered steps.");
  expect(
    (await resourceGetByPath("other@example.test", "AGENTS.md"))?.content,
  ).toBe("Other person's instructions");
  const again = await savePersonalPreferences({
    content: "QA test: second edit",
    expectedOwner: saved.owner,
    expectedRevision: saved.revision,
  });
  expect((await readPersonalPreferences()).content).toBe(
    "QA test: second edit",
  );
  await expect(
    savePersonalPreferences({
      content: "stale edit",
      expectedOwner: saved.owner,
      expectedRevision: saved.revision,
    }),
  ).rejects.toThrow("Preferences changed");
  expect(await readPersonalPreferences()).toEqual(again);
});
it("rejects a stale empty state when personal defaults were created after the page loaded", async () => {
  m.email = "fresh@example.test";
  const before = await readPersonalPreferences();
  expect(before.revision).toBeNull();
  await resourcePut(
    "fresh@example.test",
    "AGENTS.md",
    "Created by another reader",
  );
  await expect(
    savePersonalPreferences({
      content: "overwrite",
      expectedOwner: before.owner,
      expectedRevision: null,
    }),
  ).rejects.toThrow("Preferences changed");
  expect((await readPersonalPreferences()).content).toBe(
    "Created by another reader",
  );
});
it("refuses changed accounts and anonymous reads and writes", async () => {
  m.email = "other@example.test";
  await expect(
    savePersonalPreferences({
      content: "wrong account",
      expectedOwner: "owner@example.test",
      expectedRevision: null,
    }),
  ).rejects.toThrow("active account changed");
  expect((await readPersonalPreferences()).content).toBe(
    "Other person's instructions",
  );
  m.email = undefined;
  await expect(readPersonalPreferences()).rejects.toThrow("Not authenticated");
  await expect(
    savePersonalPreferences({
      content: "anonymous",
      expectedOwner: "owner@example.test",
      expectedRevision: null,
    }),
  ).rejects.toThrow("Not authenticated");
  m.email = "owner@example.test";
});
it("validates generated action inputs and output shapes", async () => {
  await checkActionProperties(readAction, {
    context: { caller: "tool" },
    runs: 15,
    seed: 126,
  });
  await checkActionProperties(writeAction, {
    context: { caller: "tool" },
    runs: 15,
    seed: 127,
  });
});
