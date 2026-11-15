import { describe, expect, it, vi } from "vitest";

import { retryOnDdlRace } from "./runtime-facts.js";

describe("retryOnDdlRace", () => {
  it.each([
    ["duplicate relation", { code: "42P07" }],
    ["duplicate type routine", { code: "42710", routine: "TypeCreate" }],
    [
      "duplicate type message",
      { code: "42710", message: 'type "foo" already exists' },
    ],
    [
      "type catalog constraint",
      { code: "23505", constraint_name: "pg_type_typname_nsp_index" },
    ],
    [
      "class catalog constraint",
      { code: "23505", constraint: "pg_class_relname_nsp_index" },
    ],
    ["type catalog detail", { code: "23505", detail: "pg_type conflict" }],
    ["class catalog detail", { code: "23505", detail: "pg_class conflict" }],
    [
      "relation message",
      { code: "23505", message: 'relation "foo" already exists' },
    ],
  ])("retries a %s once", async (_label, error) => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");
    await expect(retryOnDdlRace(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "unrelated duplicate object",
      {
        code: "42710",
        routine: "NamespaceCreate",
        message: 'schema "public" already exists',
      },
    ],
    [
      "unrelated unique constraint",
      { code: "23505", constraint: "users_email_key" },
    ],
    ["uncoded error", new Error("permission denied")],
    ["null", null],
    ["primitive", "42P07"],
  ])("propagates %s without retrying", async (_label, error) => {
    const operation = vi.fn().mockRejectedValueOnce(error);
    await expect(retryOnDdlRace(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("propagates a second failure rather than retrying indefinitely", async () => {
    const first = { code: "42P07" };
    const second = new Error("still failed");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);
    await expect(retryOnDdlRace(operation)).rejects.toBe(second);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
