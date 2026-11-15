import { afterEach, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { bindActionBatch, runActionBatch } from "./action-batch.js";
import { captureError } from "./capture-error.js";
import { runWithRequestContext } from "./request-context.js";

vi.mock("./capture-error.js", () => ({ captureError: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it.each(["fetch", "body"] as const)(
  "never coerces or retains private thrown properties from %s",
  async (stage) => {
    vi.mocked(captureError).mockClear();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const toString = vi.fn(() => {
      throw new Error("private coercion must not run");
    });
    const failure = Object.assign(new Error("private transport body"), {
      body: "private own property",
      cause: new Error("private cause"),
      toString,
    });
    const reject = vi.fn(async () => {
      throw failure;
    });
    bindActionBatch({
      actions: {
        record: { persistInChatHistory: false } as ActionEntry,
      },
      fetch:
        stage === "fetch"
          ? reject
          : async () => ({ text: reject }) as unknown as Response,
    });
    const result = await runWithRequestContext(
      { requestOrigin: "https://app.example.com" },
      () =>
        runActionBatch(
          { requests: [{ action: "record", query: "" }] },
          undefined,
        ),
    );
    expect(reject).toHaveBeenCalledOnce();
    expect(result.results[0].status).toBe(500);
    expect(toString).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledOnce();
    const captured = vi.mocked(captureError).mock.calls[0][0] as Error;
    expect(captured).not.toBe(failure);
    expect(captured.message).toBe("Private content omitted");
    expect(Reflect.ownKeys(captured).sort()).toEqual(["message", "stack"]);
    expect(log.mock.calls[0][1]).toEqual({ error: "Private content omitted" });
  },
);

it("keeps privacy isolated when a public fault completes before a private fault", async () => {
  vi.mocked(captureError).mockClear();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  let rejectPrivate!: (error: Error) => void;
  const held = new Promise<Response>((_, reject) => {
    rejectPrivate = reject;
  });
  const publicError = new Error("public diagnostic");
  bindActionBatch({
    actions: {
      private: { persistInChatHistory: false } as ActionEntry,
      public: {} as ActionEntry,
    },
    fetch: async (request) => {
      if (request.url.endsWith("/private")) return held;
      throw publicError;
    },
  });
  const pending = runWithRequestContext(
    { requestOrigin: "https://app.example.com" },
    () =>
      runActionBatch(
        {
          requests: [
            { action: "private", query: "" },
            { action: "public", query: "" },
          ],
        },
        undefined,
      ),
  );
  await vi.waitFor(() => expect(captureError).toHaveBeenCalledOnce());
  expect(vi.mocked(captureError).mock.calls[0][0]).toBe(publicError);
  rejectPrivate(new Error("private delayed body"));
  expect((await pending).results.map((item) => item.status)).toEqual([
    500, 500,
  ]);
  expect(vi.mocked(captureError).mock.calls[1][1]?.errorMessagePolicy).toBe(
    "omit",
  );
  expect(log.mock.calls[1][1]).toEqual({ error: "Private content omitted" });
});
