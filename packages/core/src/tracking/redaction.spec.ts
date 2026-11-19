import { describe, expect, it } from "vitest";

import { measureCpuMs } from "../testing/cpu-time";
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
  });

  it("redacts the value of a quoted credential key", () => {
    expect(redact('{"token":"abc"}')).toBe('{"token":"<redacted>"}');
  });

  it("stays linear on 8 KB of repeated key-looking text", () => {
    const run = "token_".repeat(1400);
    let plain = "";
    let assigned = "";

    const plainCpuMs = measureCpuMs(() => {
      plain = redact(run);
    });
    const assignedCpuMs = measureCpuMs(() => {
      assigned = redact(`${run}=abc`);
    });

    expect(plain).toBe(run);
    expect(assigned).toBe(`${run}=<redacted>`);
    expect(plainCpuMs).toBeLessThan(250);
    expect(assignedCpuMs).toBeLessThan(250);
  });
});
