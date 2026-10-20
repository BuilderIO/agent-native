import { isActionContractError } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractGoogleDocId,
  extractGoogleDocUrls,
  normalizeGoogleDocText,
} from "../shared/google-docs";

const mockGetGoogleDocsAccessToken = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/google-docs-oauth.js", () => ({
  getGoogleDocsAccessToken: mockGetGoogleDocsAccessToken,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

import action from "./import-google-doc";

const DOC_ID = "1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk";

describe("import-google-doc failures", () => {
  beforeEach(() => {
    mockGetGoogleDocsAccessToken.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function googleAnswers(status: number, body = "") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status })),
    );
  }

  it("rethrows a token-store failure as a server error, never inside the user's 422", async () => {
    const storeError = new Error(
      'Failed query: select "tokens" from "oauth_tokens" where "owner" = $1\nparams: owner@example.com',
    );
    mockGetGoogleDocsAccessToken.mockRejectedValue(storeError);
    googleAnswers(403);

    let thrown: unknown;
    try {
      await action.run({ url: DOC_ID }, { caller: "http" } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(storeError);
    expect(isActionContractError(thrown)).toBe(false);
    expect((thrown as { statusCode?: unknown }).statusCode).toBeUndefined();
  });

  it("still imports a public document when the token store fails", async () => {
    mockGetGoogleDocsAccessToken.mockRejectedValue(new Error("vault down"));
    googleAnswers(200, "Hello deck");

    const result = await action.run({ url: DOC_ID }, {
      caller: "http",
    } as never);

    expect(result).toMatchObject({
      source: "public-export",
      text: "Hello deck",
    });
  });

  it("rejects an oversized export while streaming its body", async () => {
    mockGetGoogleDocsAccessToken.mockResolvedValue(null);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_000_001));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );

    await expect(
      action.run({ url: DOC_ID }, { caller: "http" } as never),
    ).rejects.toMatchObject({
      errorCode: "google_doc_unreadable",
      statusCode: 422,
      message: expect.stringContaining("exceeds the import size limit"),
    });
  });

  it("keeps the export timeout active until the response body is consumed", async () => {
    mockGetGoogleDocsAccessToken.mockResolvedValue(null);
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener("abort", () =>
              controller.error(new Error("aborted")),
            );
          },
        });
        return new Response(body);
      }),
    );

    const pending = action.run({ url: DOC_ID }, { caller: "http" } as never);
    const rejection = expect(pending).rejects.toMatchObject({
      errorCode: "google_doc_unreadable",
      statusCode: 422,
      message: expect.stringContaining("timed out"),
    });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejection;
  });

  it("types a document Google refuses as a 422 that names only Google's answer", async () => {
    mockGetGoogleDocsAccessToken.mockResolvedValue(null);
    googleAnswers(403);

    let thrown: unknown;
    try {
      await action.run({ url: DOC_ID }, { caller: "http" } as never);
    } catch (error) {
      thrown = error;
    }

    expect(isActionContractError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      errorCode: "google_doc_unreadable",
      statusCode: 422,
    });
    expect((thrown as Error).message).toContain("Google returned HTTP 403");
    expect((thrown as Error).message).not.toMatch(/Failed query|@example\.com/);
  });
});

describe("import-google-doc helpers", () => {
  it("extracts document IDs from standard Google Docs URLs", () => {
    expect(
      extractGoogleDocId(
        "https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?pli=1&tab=t.0",
      ),
    ).toBe("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk");
  });

  it("accepts raw document IDs", () => {
    expect(
      extractGoogleDocId("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk"),
    ).toBe("1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk");
  });

  it("rejects non-Google URLs", () => {
    expect(
      extractGoogleDocId("https://example.com/document/d/not-a-doc"),
    ).toBeNull();
  });

  it("extracts Google Docs URLs from pasted prose", () => {
    expect(
      extractGoogleDocUrls(
        "Please use https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?tab=t.0.",
      ),
    ).toEqual([
      "https://docs.google.com/document/d/1SnfJv9xjLG558fcfDG6Hj-WhWaOxo7bImMJGmIvWvSk/edit?tab=t.0",
    ]);
  });

  it("normalizes exported document text", () => {
    expect(normalizeGoogleDocText("A\r\nB\t \n\n\u0000C\n")).toBe("A\nB\n\nC");
  });
});
