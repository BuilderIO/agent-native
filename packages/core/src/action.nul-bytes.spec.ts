import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ActionInputValidationError,
  actionCallIntent,
  defineAction,
  validateActionArgs,
} from "./action.js";

describe("action NUL-byte input validation", () => {
  it("rejects NUL bytes in top-level string arguments", async () => {
    const schema = z.object({ title: z.string(), body: z.string().optional() });
    await expect(
      validateActionArgs(schema, { title: "hello\u0000world" }),
    ).rejects.toThrow(ActionInputValidationError);
    await expect(
      validateActionArgs(schema, { title: "hello\u0000world" }),
    ).rejects.toThrow("title: String cannot contain NUL bytes");
  });

  it("rejects NUL bytes inside nested objects, arrays, and masks undeclared record keys", async () => {
    const schema = z.object({
      items: z.array(z.object({ body: z.string() })),
      metadata: z.record(z.string(), z.string()).optional(),
    });
    const nestedErr = await validateActionArgs(schema, {
      items: [{ body: "ok" }, { body: "bad\u0000text" }],
    }).catch((e) => e);
    expect(nestedErr).toBeInstanceOf(ActionInputValidationError);
    expect(nestedErr.paths).toEqual(["items.1.body"]);

    const keyErr = await validateActionArgs(schema, {
      items: [],
      metadata: { "secret\u0000key": "value" },
    }).catch((e) => e);
    expect(keyErr).toBeInstanceOf(ActionInputValidationError);
    expect(keyErr.paths).toEqual(["metadata.*"]);
    expect(keyErr.message).not.toContain("secret");
  });

  it("masks private action details and validates schema-less inputs via assertNoNulByteActionArgs", async () => {
    const privateAction = defineAction({
      description: "Private action",
      persistInChatHistory: false,
      schema: z.object({ secret: z.string() }),
      run: async () => ({ ok: true }),
    });
    const privateIntent = await actionCallIntent(privateAction, {
      secret: "top\u0000secret",
    });
    expect(privateIntent.valid).toBe(false);
    const privateError = privateIntent.valid ? undefined : privateIntent.error;
    expect(privateError).toBeInstanceOf(ActionInputValidationError);
    expect((privateError as Error).message).toBe("Invalid action parameters");
  });

  it("preserves custom schema validation errors and permits normal Unicode, RTL, HTML, SQL, and literal \\u0000 text", async () => {
    const customSchema = z.object({
      title: z
        .string()
        .refine((v) => !v.includes("\u0000"), "Custom no-nul message"),
    });
    await expect(
      validateActionArgs(customSchema, { title: "a\u0000b" }),
    ).rejects.toThrow("Custom no-nul message");

    const openSchema = z.object({ text: z.string() });
    const safeInputs = [
      "RTL \u202Eoverride\u202C 日本語 العربية 👨‍👩‍👧‍👦",
      `<img src=x onerror="alert(1)">'; DROP TABLE x; --`,
      "literal escaped \\u0000 six chars",
    ];
    for (const text of safeInputs) {
      await expect(validateActionArgs(openSchema, { text })).resolves.toEqual({
        text,
      });
    }
  });
});
