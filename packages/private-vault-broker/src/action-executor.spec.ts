import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultActionExecutorError,
  PrivateVaultContentActionExecutor,
  decodePrivateVaultActionRequest,
  encodePrivateVaultActionRequest,
} from "./action-executor.js";

const decoder = new TextDecoder();

describe("private-vault Content action executor", () => {
  it("round-trips one canonical named Content action request", () => {
    const encoded = encodePrivateVaultActionRequest({
      actionName: "get-document",
      args: { z: 2, id: "document_12345678" },
    });
    expect(decoder.decode(encoded)).toBe(
      '{"version":1,"type":"content-action","actionName":"get-document","args":{"id":"document_12345678","z":2}}',
    );
    expect(decodePrivateVaultActionRequest(encoded)).toEqual({
      version: 1,
      type: "content-action",
      actionName: "get-document",
      args: { id: "document_12345678", z: 2 },
    });
  });

  it("rejects noncanonical, extra-field, dangerous-key, and invalid action bodies", () => {
    for (const value of [
      '{"type":"content-action","version":1,"actionName":"get-document","args":{}}',
      '{"version":1,"type":"content-action","actionName":"get-document","args":{},"url":"https://evil.test"}',
      '{"version":1,"type":"content-action","actionName":"GetDocument","args":{}}',
      '{"version":1,"type":"content-action","actionName":"get-document","args":{"__proto__":{}}}',
    ]) {
      expect(() =>
        decodePrivateVaultActionRequest(new TextEncoder().encode(value)),
      ).toThrow(PrivateVaultActionExecutorError);
    }
  });

  it("runs only a registered action matching the native-authenticated operation", async () => {
    const run = vi.fn(async (args) => ({ args }));
    const executor = new PrivateVaultContentActionExecutor({
      "get-document": { run },
    });
    const input = {
      payload: encodePrivateVaultActionRequest({
        actionName: "get-document",
        args: { id: "document_12345678" },
      }),
      jobId: "job_12345678",
      resourceId: new Uint8Array(16).fill(7),
      operation: "get-document",
    };
    const completed = await executor.execute(input);
    expect(completed.state).toBe("completed");
    expect(JSON.parse(decoder.decode(completed.payload))).toMatchObject({
      version: 1,
      type: "content-action-result",
      ok: true,
      result: { args: { id: "document_12345678" } },
    });
    expect(run).toHaveBeenCalledOnce();

    const denied = await executor.execute({
      ...input,
      operation: "delete-document",
    });
    expect(denied.state).toBe("failed");
    expect(JSON.parse(decoder.decode(denied.payload))).toEqual({
      version: 1,
      type: "content-action-result",
      ok: false,
      error: "action_failed",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("never treats a URL, SQL string, or module name as executable authority", async () => {
    const executor = new PrivateVaultContentActionExecutor({});
    for (const actionName of [
      "https://evil.test",
      "select * from users",
      "../actions/delete",
    ]) {
      const result = await executor.execute({
        payload: new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            type: "content-action",
            actionName,
            args: {},
          }),
        ),
        jobId: "job_12345678",
        resourceId: new Uint8Array(16),
        operation: actionName,
      });
      expect(result.state).toBe("failed");
    }
  });
});
