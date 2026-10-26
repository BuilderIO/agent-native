import { afterEach, describe, expect, it, vi } from "vitest";

import { fingerprintAgentSubmissionAttachment } from "./submission-fingerprint.js";

describe("submission attachment fingerprints without Web Crypto", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the synchronous SHA-256 fallback when crypto.subtle is unavailable", () => {
    vi.stubGlobal("crypto", { subtle: undefined } as unknown as Crypto);
    expect(globalThis.crypto.subtle).toBeUndefined();

    expect(
      fingerprintAgentSubmissionAttachment({
        type: "file",
        name: "attachment.txt",
        mediaType: "text/plain",
        data: "data:text/plain;base64,SGVsbG8=",
      }),
    ).toBe("eae52e7cab497202362cb0c7097930217309bfe27456fdcac89691ff9e9a9289");
  });
});
