import { describe, expect, it } from "vitest";

import { redact } from "./redaction";

describe("redact", () => {
  it("redacts the value of a credential-named assignment", () => {
    expect(redact("api_key=abc123 token: def")).toBe(
      "api_key=<redacted> token: <redacted>",
    );
    expect(redact("user.password=hunter2, name=bob")).toBe(
      "user.password=<redacted>, name=bob",
    );
    expect(redact("a=token=xyz")).toBe("a=token=<redacted>");
    expect(redact("connect failed password=p@ss}")).toBe(
      "connect failed password=<redacted>}",
    );
  });

  it("leaves text without a credential assignment alone", () => {
    expect(redact("tokenization is fine")).toBe("tokenization is fine");
    expect(redact('{"token":"abc"}')).toBe('{"token":"abc"}');
  });

  it("stays linear on 8 KB of repeated key-looking text", () => {
    const run = "token_".repeat(1400);
    const timed = (value: string) => {
      const start = performance.now();
      const result = redact(value);
      return { result, ms: performance.now() - start };
    };

    const plain = timed(run);
    const assigned = timed(`${run}=abc`);

    expect(plain.result).toBe(run);
    expect(assigned.result).toBe(`${run}=<redacted>`);
    expect(plain.ms).toBeLessThan(250);
    expect(assigned.ms).toBeLessThan(250);
  });
});
