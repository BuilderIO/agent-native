import { describe, expect, it } from "vitest";

import {
  redactBreadcrumb,
  redactLogString,
  redactLogValue,
} from "./log-redaction";

// Assembled at runtime so no credential-shaped literal sits in the source.
const join = (...parts: string[]) => parts.join("");

describe("redactLogString", () => {
  it("takes the credential after a Bearer scheme, not the scheme", () => {
    expect(redactLogString("Authorization: Bearer CANARYBEARER0123")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("redacts a URL query credential and a quoted JSON key", () => {
    const out = redactLogString(
      'fetch https://api.example.com/x?api_key=CANARYQUERY01&n=1 failed {"access_token":"CANARYJSON01"}',
    );
    expect(out).toBe(
      'fetch https://api.example.com/x?api_key=[REDACTED]&n=1 failed {"access_token":"[REDACTED]"}',
    );
  });

  it("redacts a bare provider key and a JWT", () => {
    const key = join("sk-ant-api03-", "CANARYLOGKEY0123456789");
    const jwt = join(
      "eyJhbGciOiJIUzI1NiJ9.",
      "eyJzdWIiOiJjYW5hcnkifQ.",
      "CANARYSIGNATURE0123",
    );
    expect(redactLogString(`key ${key} token ${jwt}`)).toBe(
      "key [REDACTED] token [REDACTED]",
    );
  });

  it("redacts a credential cut off where a long line is truncated", () => {
    const line = `${"x ".repeat(9_998)}${join("sk-ant-api03-", "CANARYCUTKEY0123456789")}`;
    expect(redactLogString(line).endsWith("[REDACTED][TRUNCATED]")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(redactLogString("window ready in 120ms")).toBe(
      "window ready in 120ms",
    );
  });
});

describe("redactLogValue", () => {
  it("redacts a credential-named field and the strings of an error", () => {
    const error = new Error("failed Authorization: Bearer CANARYERROR0123");
    const out = redactLogValue({
      apiKey: "CANARYFIELD",
      dsn: "https://CANARYDSN@o1.ingest.example.com/1",
      error,
      attempt: 2,
    }) as { error: { message: string } };
    expect(JSON.stringify(out)).not.toContain("CANARY");
    expect(out).toMatchObject({ apiKey: "[REDACTED]", attempt: 2 });
  });
});

describe("redactBreadcrumb", () => {
  it("redacts a console breadcrumb's message and data", () => {
    const crumb = redactBreadcrumb({
      category: "console",
      level: "log",
      message: "sign-in failed token=CANARYMESSAGE01",
      data: { url: "https://x.example.com/?code=CANARYDATA01", ok: false },
    });
    expect(JSON.stringify(crumb)).not.toContain("CANARY");
    expect(crumb).toMatchObject({ category: "console", level: "log" });
    expect(crumb.data).toMatchObject({ ok: false });
  });

  it("leaves a breadcrumb with no text alone", () => {
    expect(redactBreadcrumb({ category: "navigation" })).toEqual({
      category: "navigation",
    });
  });
});
