import { describe, expect, it, vi } from "vitest";

import { createTripwireRecorder } from "./recorder.js";
import {
  DETAILS_MAX_BYTES,
  REDACT_INPUT_MAX_CHARS,
  SCRUB_MAX_CHARS,
  UNREADABLE,
  describeShape,
  errorDetails,
  redactDeep,
  redactSecrets,
  sanitizeDetails,
  scrub,
  scrubId,
} from "./redact.js";
import type { TripwireRow, TripwireStore } from "./store.js";

// Credential-shaped fixtures are put together at run time, so no secret
// scanner mistakes this file for a leak. Every one is made of filler.
const fake = (...parts: string[]) => parts.join("");
const FILLER = "0123456789abcdefghijklmnop";
const SECRETS = {
  slackBot: fake("xox", "b-", "1111111111-", "2222222222-", FILLER),
  slackUser: fake("xox", "p-", "1111111111-", FILLER),
  slackApp: fake("xa", "pp-", "1-A0123456789-", FILLER),
  githubClassic: fake("gh", "p_", "A".repeat(36)),
  githubFine: fake("github", "_pat_", "B".repeat(30), "_", "C".repeat(20)),
  openAiStyle: fake("s", "k-", "proj-", FILLER),
  anthropicStyle: fake("s", "k-", "ant-", "api03-", FILLER),
  stripeLive: fake("s", "k_live_", FILLER),
  awsAccess: fake("AK", "IA", "ABCDEFGHIJKLMNOP"),
  googleKey: fake("AI", "za", "SyA-0123456789abcdefghijklmnop"),
  builderKey: fake("bp", "k-", "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"),
  jwt: fake(
    "ey",
    "JhbGciOiJIUzI1NiJ9",
    ".",
    "eyJzdWIiOiJ0ZXN0In0",
    ".",
    "c2lnbmF0dXJlLWZpbGxlcg",
  ),
  hex32: "0123456789abcdef0123456789abcdef",
  hex64: "0123456789abcdef".repeat(4),
  base64: "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRg",
  base64WithSlash: "Zm9vYmFy/YmF6cXV4MTIz/NDU2Nzg5MEFCQ0RF",
  noDigits: "aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJ",
  email: "ana.customer@example.test",
} as const;
const PASSWORD = "hunter2";

function leaks(text: string): string[] {
  return Object.entries(SECRETS)
    .filter(([, secret]) => text.includes(secret))
    .map(([name]) => name);
}

describe("scrub", () => {
  it.each(Object.entries(SECRETS))("removes %s", (name, secret) => {
    const out = scrub(`call failed with ${secret} in the middle`);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[(redacted|email)\]/);
    expect(out).toContain("call failed with");
    expect(name).toBeTruthy();
  });

  it("removes Bearer and Basic values and authorization headers", () => {
    const bearer = scrub(`header Bearer ${SECRETS.base64} sent`);
    expect(bearer).not.toContain(SECRETS.base64);
    const basic = scrub("Authorization: Basic dXNlcjpwYXNzd29yZA==");
    expect(basic).not.toContain("dXNlcjpwYXNzd29yZA");
    const bare = scrub("authorization=abc123");
    expect(bare).not.toContain("abc123");
  });

  it("removes key=value secrets, quoted or not", () => {
    for (const text of [
      `password=${PASSWORD}`,
      `"password": "${PASSWORD}"`,
      `api_key: ${PASSWORD}`,
      `client_secret=${PASSWORD}`,
      `token=abc12345`,
      `{"access_token":"abc12345"}`,
    ]) {
      const out = scrub(text);
      expect(out, text).not.toContain(PASSWORD);
      expect(out, text).not.toContain("abc12345");
      expect(out, text).toContain("[redacted]");
    }
  });

  it("removes a private key block", () => {
    const pem = fake(
      "-----BEGIN RSA PRIV",
      "ATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END RSA PRIV",
      "ATE KEY-----",
    );
    const out = scrub(`key was ${pem} done`);
    expect(out).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
    expect(out).not.toContain("BEGIN");
  });

  it("removes the query string and the credentials of a URL, and keeps its path", () => {
    const out = scrub(
      `GET https://user:${PASSWORD}@api.example.test/v1/projects/branches?token=abc123&x=1#frag failed`,
    );
    expect(out).toContain("https://api.example.test/v1/projects/branches");
    expect(out).toContain("?[redacted]");
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("frag");
    expect(scrub("see /v1/search?q=billing&limit=5 for it")).toBe(
      "see /v1/search?[redacted] for it",
    );
  });

  it("removes a secret in a URL path", () => {
    const out = scrub(
      `POST https://hooks.example.test/services/T0123/B0456/${SECRETS.base64}`,
    );
    expect(out).not.toContain(SECRETS.base64);
  });

  it("cannot be slipped past with invisible characters", () => {
    const split = SECRETS.slackBot.replace("xoxb", "x​o­x﻿b");
    expect(scrub(`token ${split} end`)).not.toContain("1111111111");
    const control = scrub(`line one\nline two\u0000${SECRETS.hex32}`);
    expect(control).not.toContain(SECRETS.hex32);
    expect(control).not.toMatch(/[\n\u0000]/);
  });

  it("clips to 200 characters, after redacting", () => {
    const long = `${"word ".repeat(80)}${SECRETS.slackBot}`;
    const out = scrub(long);
    expect(out.length).toBeLessThanOrEqual(SCRUB_MAX_CHARS);
    expect(out).not.toContain("xoxb");
    const wide = scrub("é".repeat(500));
    expect(wide.length).toBeLessThanOrEqual(SCRUB_MAX_CHARS);
    const emoji = scrub("😀".repeat(300));
    expect(emoji.length).toBeLessThanOrEqual(SCRUB_MAX_CHARS);
    expect(emoji).not.toMatch(/[\ud800-\udbff]…$/);
  });

  it("is a fixed point: scrubbing scrubbed text changes nothing", () => {
    const messy = [
      `${SECRETS.slackBot} ${SECRETS.email} ${SECRETS.jwt}`,
      `https://x.example.test/p?a=b password=${PASSWORD}`,
      `Bearer ${SECRETS.base64} token=abc12345`,
      "ordinary words only",
    ];
    for (const text of messy) {
      const once = scrub(text);
      expect(scrub(once)).toBe(once);
    }
  });

  it("keeps what a person needs to read: codes, names, paths, times", () => {
    for (const text of [
      "workflow_automation_unresolved: the job names no workflow",
      "operation describe-workflow-node-catalog returned 404",
      "GET /api/v1/projects/branches/status returned 502 after 1204 ms",
      "ran at 2026-10-19T12:00:00.000Z in 3 steps",
      "expected key results but found data",
      "listFactoryWorkflowRunsForFactory threw before the page loaded",
      "/Users/example/Documents/Github/agent-native/templates/factory/server/x.ts:44",
    ]) {
      expect(scrub(text)).toBe(text);
    }
  });
});

describe("scrubId", () => {
  it("keeps an id with digits and 24 or more characters", () => {
    expect(scrubId("wf-3f2a9c1e-77d1-4b6a-9d0e-5a1c2b3d4e5f")).toBe(
      "wf-3f2a9c1e-77d1-4b6a-9d0e-5a1c2b3d4e5f",
    );
  });

  it("still erases a credential or an email posing as an id", () => {
    expect(scrubId(SECRETS.slackBot)).not.toContain("1111111111");
    expect(scrubId(SECRETS.email)).not.toContain("ana.customer");
    expect(scrubId(`a b\nc`)).toBe("a_b_c");
    expect(scrubId(`op ${SECRETS.base64}`)).not.toContain(SECRETS.base64);
    expect(scrubId(`run for ${SECRETS.email}`)).toBe("run_for_[email]");
    expect(scrubId("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("redactDeep", () => {
  it("applies the strict rules to every string and key, at any depth", () => {
    const out = redactDeep({
      id: "wf-3f2a9c1e-77d1-4b6a-9d0e-5a1c2b3d4e5f",
      nested: [{ note: `sent ${SECRETS.slackBot}` }, SECRETS.email],
      [SECRETS.githubClassic]: { deep: { deeper: SECRETS.jwt } },
    });
    const text = JSON.stringify(out);
    expect(leaks(text)).toEqual([]);
    expect(text).toContain("wf-3f2a9c1e-77d1-4b6a-9d0e-5a1c2b3d4e5f");
  });
});

describe("describeShape", () => {
  it("names keys and types and never a value", () => {
    const body = {
      id: "ticket-123",
      owner: { email: SECRETS.email, token: SECRETS.slackBot },
      labels: ["billing", "urgent"],
      count: 3,
      done: false,
      missing: null,
    };
    const shape = describeShape(body);
    const text = JSON.stringify(shape);
    expect(shape).toEqual({
      type: "object",
      keyCount: 6,
      keys: {
        id: "string",
        owner: {
          type: "object",
          keyCount: 2,
          keys: { email: "string", token: "string" },
        },
        labels: { type: "array", length: 2, of: "string" },
        count: "number",
        done: "boolean",
        missing: "null",
      },
    });
    expect(text).not.toContain("ticket-123");
    expect(leaks(text)).toEqual([]);
  });

  it("describes a root that is not an object", () => {
    expect(describeShape("a secret string")).toBe("string");
    expect(describeShape(null)).toBe("null");
    expect(describeShape([])).toEqual({ type: "array", length: 0 });
    expect(describeShape([1, "a"])).toEqual({
      type: "array",
      length: 2,
      of: "mixed",
    });
    expect(describeShape(new Date())).toBe("date");
    expect(describeShape(new Map([["a", 1]]))).toEqual({
      type: "map",
      size: 1,
    });
    expect(describeShape(new Uint8Array(4))).toEqual({
      type: "bytes",
      length: 4,
    });
  });

  it("stops at three levels", () => {
    const shape = describeShape({ a: { b: { c: { d: "deep value" } } } });
    expect(shape).toEqual({
      type: "object",
      keyCount: 1,
      keys: {
        a: {
          type: "object",
          keyCount: 1,
          keys: {
            b: { type: "object", keyCount: 1 },
          },
        },
      },
    });
    expect(JSON.stringify(shape)).not.toContain("deep value");
  });

  it("lists at most 40 keys in all, and says how many there were", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key${index}`, index]),
    );
    const shape = describeShape(wide) as {
      keyCount: number;
      keys: Record<string, string>;
    };
    expect(shape.keyCount).toBe(100);
    expect(Object.keys(shape.keys)).toHaveLength(40);
    const nested = describeShape({
      first: Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`k${index}`, "x"]),
      ),
      second: { late: true },
    }) as { keys: Record<string, { keys?: Record<string, unknown> }> };
    const total =
      Object.keys(nested.keys).length +
      Object.keys(nested.keys.first?.keys ?? {}).length +
      Object.keys(nested.keys.second?.keys ?? {}).length;
    expect(total).toBeLessThanOrEqual(40);
  });

  it("scrubs and clips the key names themselves", () => {
    const shape = describeShape({
      [SECRETS.email]: 1,
      [SECRETS.slackBot]: 2,
      [SECRETS.hex64]: 3,
      ["long".repeat(40)]: 4,
    }) as { keys: Record<string, unknown> };
    const text = JSON.stringify(shape);
    expect(leaks(text)).toEqual([]);
    expect(Object.keys(shape.keys)).toHaveLength(4);
    for (const key of Object.keys(shape.keys)) {
      expect(key.length).toBeLessThanOrEqual(40);
    }
  });

  it("survives a cycle, a throwing getter, and exotic values", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(() => describeShape(cyclic)).not.toThrow();
    const trap = {
      get boom() {
        throw new Error("no");
      },
      fine: 1,
    };
    expect(describeShape(trap)).toMatchObject({
      keys: { boom: "unreadable", fine: "number" },
    });
    expect(
      describeShape({ f() {}, s: Symbol("x"), b: 10n, u: undefined }),
    ).toMatchObject({
      keys: { f: "function", s: "symbol", b: "bigint", u: "undefined" },
    });
  });
});

describe("sanitizeDetails", () => {
  it("keeps numbers, booleans, null and short strings, and counts what it cannot", () => {
    const { fields, droppedFields } = sanitizeDetails({
      status: 502,
      retryable: false,
      parent: null,
      note: "upstream said no",
      callback: () => 1,
      marker: Symbol("x"),
      big: 10n,
      ratio: Number.NaN,
      nothing: undefined,
    });
    expect(fields).toEqual({
      status: 502,
      retryable: false,
      parent: null,
      note: "upstream said no",
    });
    expect(droppedFields).toBe(5);
  });

  it("scrubs every string, including the text of an error", () => {
    const { fields } = sanitizeDetails({
      message: `failed for ${SECRETS.email} with ${SECRETS.slackBot}`,
      cause: new Error(`Bearer ${SECRETS.base64} rejected`),
      when: new Date("2026-10-19T12:00:00.000Z"),
    });
    expect(leaks(JSON.stringify(fields))).toEqual([]);
    expect(fields.when).toBe("2026-10-19T12:00:00.000Z");
  });

  it("stores a nested object as its structure, never its values", () => {
    const { fields } = sanitizeDetails({
      response: {
        data: [{ id: "a", notes: `${SECRETS.slackBot} ${SECRETS.email}` }],
        auth: { token: SECRETS.githubClassic, password: PASSWORD },
        [SECRETS.jwt]: true,
      },
    });
    const text = JSON.stringify(fields);
    expect(leaks(text)).toEqual([]);
    expect(text).not.toContain('"a"');
    expect(fields.response).toMatchObject({ type: "object", keyCount: 3 });
  });

  it("keeps a shape built by describeShape and reduces one that only claims to be", () => {
    const real = describeShape({ results: [1, 2] });
    const forged = {
      type: "object",
      keyCount: 1,
      keys: { note: SECRETS.hex64 },
    };
    const { fields } = sanitizeDetails({ real, forged });
    expect(fields.real).toBe(real);
    expect(JSON.stringify(fields.forged)).not.toContain(SECRETS.hex64);
    expect(fields.forged).toMatchObject({
      type: "object",
      keys: { type: "string", keyCount: "number", keys: { type: "object" } },
    });
  });

  it("refuses field names that are not plain words", () => {
    const { fields, droppedFields } = sanitizeDetails({
      ok_name: 1,
      "has space": 2,
      "9starts": 3,
      [SECRETS.slackBot]: 4,
      [SECRETS.githubClassic]: 5,
      [SECRETS.hex32]: 6,
      droppedFields: 99,
      operationId: "spoofed",
      invariant: "spoofed",
      suppressed: 12,
    });
    expect(fields).toEqual({ ok_name: 1 });
    expect(droppedFields).toBe(9);
  });

  it("drops text under a secret-sounding name but keeps a flag or a count", () => {
    const { fields, droppedFields } = sanitizeDetails({
      token: "short",
      apiKey: "short",
      authorizationHeader: "short",
      tokenPresent: true,
      tokenLength: 40,
      credentialSource: "vault",
    });
    expect(fields).toEqual({ tokenPresent: true, tokenLength: 40 });
    expect(droppedFields).toBe(4);
  });

  it("holds the serialized details to 4 KB and reports what it cut", () => {
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `field${index}`,
        "a plain sentence of a fair length, ".repeat(5).slice(0, 190),
      ]),
    );
    const { fields, droppedFields } = sanitizeDetails(many);
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...fields, droppedFields }),
    ).length;
    expect(bytes).toBeLessThanOrEqual(DETAILS_MAX_BYTES);
    expect(droppedFields).toBeGreaterThan(0);
    expect(Object.keys(fields).length + droppedFields).toBe(60);
    const unbounded = sanitizeDetails({
      items: Array.from({ length: 5000 }, () => "x"),
    });
    expect(JSON.stringify(unbounded.fields).length).toBeLessThanOrEqual(
      DETAILS_MAX_BYTES,
    );
  });

  it("counts fields past the 64th, and anything that is not an object", () => {
    const huge = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`f${index}`, 1]),
    );
    expect(sanitizeDetails(huge).droppedFields).toBe(16);
    expect(sanitizeDetails("a string")).toEqual({
      fields: {},
      droppedFields: 1,
    });
    expect(sanitizeDetails([1, 2])).toEqual({ fields: {}, droppedFields: 1 });
    expect(sanitizeDetails(undefined)).toEqual({
      fields: {},
      droppedFields: 0,
    });
  });

  it("drops a field whose getter throws instead of failing", () => {
    const trap = {
      get boom() {
        throw new Error("no");
      },
      fine: 1,
    };
    expect(sanitizeDetails(trap)).toEqual({
      fields: { fine: 1 },
      droppedFields: 1,
    });
  });
});

describe("errorDetails", () => {
  it("keeps the name, a scrubbed message, a short code, and a status", () => {
    const error = Object.assign(
      new Error(`request to ${SECRETS.email} failed: Bearer ${SECRETS.base64}`),
      { code: "ECONNRESET", status: 502 },
    );
    const details = errorDetails(error);
    expect(details).toMatchObject({
      errorName: "Error",
      errorCode: "ECONNRESET",
      errorStatus: 502,
    });
    expect(leaks(JSON.stringify(details))).toEqual([]);
  });

  it("does not trust a code that is a sentence", () => {
    const error = Object.assign(new Error("x"), {
      code: `${SECRETS.slackBot}!`,
    });
    expect(errorDetails(error)).not.toHaveProperty("errorCode");
  });

  it("describes a thrown value that is not an error", () => {
    expect(
      errorDetails(`plain ${SECRETS.slackBot}`).errorMessage,
    ).not.toContain("1111111111");
    expect(errorDetails({ secret: SECRETS.slackBot })).toEqual({
      errorName: "object",
      errorMessage: "",
    });
  });
});

// Shapes a secret takes in logs and provider bodies that the first rules missed.
describe("scrub, secrets in the shapes real logs have", () => {
  it.each([
    "DB_PASSWORD=hunter2",
    "X_API_KEY=hunter2",
    "GITHUB_TOKEN=abcdefghij",
    "AWS_SECRET_ACCESS_KEY=hunter2hunter2",
    "SECRET_KEY: hunter2",
    "dbpassword=hunter2",
    "HTTP_AUTHORIZATION=Bearer hunter2hunter2",
    '{"DB_PASSWORD":"hunter2"}',
  ])("removes the value of a prefixed name: %s", (text) => {
    const out = scrub(`env ${text} ok`);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("abcdefghij");
    expect(out).toContain("[redacted]");
    expect(out).toMatch(/^env .*ok$/);
  });

  it("keeps the name and the prefix, so a reader can tell what was removed", () => {
    expect(scrub("DB_PASSWORD=hunter2")).toBe("DB_PASSWORD=[redacted]");
    expect(scrub("GITHUB_TOKEN=abcdefghij")).toBe("GITHUB_TOKEN=[redacted]");
  });

  it("removes a value in JSON, quoted, spaced, and escaped once, twice or three times", () => {
    for (const text of [
      '{"password":"hunter2"}',
      '{"password" : "hunter2", "user": "ana"}',
      String.raw`{\"password\":\"hunter2\"}`,
      String.raw`"{\"password\": \"hunter2\", \"user\": \"ana\"}"`,
      String.raw`{\\\"password\\\":\\\"hunter2\\\"}`,
      String.raw`{\"client_secret\":\"hunter2\"}`,
    ]) {
      const out = scrub(`body was ${text}`);
      expect(out, text).not.toContain("hunter2");
      expect(out, text).toContain("[redacted]");
    }
  });

  it("keeps the rest of an escaped JSON body, quotes and all", () => {
    expect(scrub(String.raw`{\"password\":\"hunter2\",\"user\":\"ana\"}`)).toBe(
      String.raw`{\"password\":\"[redacted]\",\"user\":\"ana\"}`,
    );
  });

  it("removes every cookie of a Cookie header, not only the first", () => {
    const out = scrub(
      "sent Cookie: a=b; sessionid=hunter2zzz; theme=dark failed",
    );
    expect(out).toBe("sent Cookie: [redacted] failed");
    expect(scrub("cookie=a=b; sessionid=hunter2zzz")).not.toContain("hunter2");
  });

  it("removes the cookie of a Set-Cookie header and every one joined after it", () => {
    const out = scrub(
      "Set-Cookie: sessionid=hunter2zzz; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly, csrf=hunter3yyy; Path=/",
    );
    expect(out).toBe("Set-Cookie: [redacted]");
    expect(scrub("Set-Cookie: sid=hunter2zzz; Secure; HttpOnly")).not.toContain(
      "hunter2",
    );
  });

  it("removes a cookie whose first pair was already redacted, and one in JSON", () => {
    const ghp = fake("gh", "p_", "A".repeat(36));
    expect(scrub(`Cookie: ${ghp}; sid=hunter2zzz`)).toBe("Cookie: [redacted]");
    expect(scrub('{"cookie":"a=b; sid=hunter2zzz","next":"ok"}')).toBe(
      '{"cookie":"[redacted]","next":"ok"}',
    );
    expect(scrub('cookie: sid="hunter 2 zzz"; theme=dark')).not.toContain(
      "zzz",
    );
  });

  it("removes a whole Authorization value: a scheme, a token, or several parameters", () => {
    for (const text of [
      'Authorization: Digest username="ana", realm="x y", nonce="hunter2", response="hunter3"',
      "Authorization: AWS4-HMAC-SHA256 Credential=hunter2/20240101/us/s3, SignedHeaders=host, Signature=hunter3",
      "Proxy-Authorization: Basic aHVudGVyMjpodW50ZXIz",
      "authorization=hunter2hunter3",
      "Authorization: Negotiate hunter2hunter3",
    ]) {
      const out = scrub(`${text} then`);
      expect(out, text).not.toMatch(/hunter|aHVudGVy/);
      expect(out, text).toMatch(/\[redacted\] then$/);
    }
  });

  it("removes an email in any script, decomposed or not", () => {
    for (const address of [
      "anna@bücher.de",
      "anna@bu\u0308cher.de",
      "почта@пример.рф",
      "用户@例子.广告",
      "ana.o'brien+tag@example.test",
      "ANA@EXAMPLE.TEST",
    ]) {
      expect(scrub(`mail from ${address} failed`), address).toBe(
        "mail from [email] failed",
      );
    }
  });

  it("removes an email whose @ and dots are percent-encoded, once or twice", () => {
    for (const address of [
      "ana%40example.test",
      "ana%2540example.test",
      "ana%252540example.test",
      "ana%2Ebest%40example%2Etest",
      "ana%40EXAMPLE.TEST",
    ]) {
      const out = scrub(`GET /users/${address}/profile`);
      expect(out, address).toBe("GET /users/[email]/profile");
    }
  });

  it("leaves text that only looks close alone", () => {
    for (const text of [
      "the cookie jar is full and cookies: 3 items remain",
      "max_tokens=1024 exceeded",
      "session=active for the user",
      "token expired at 12:00",
      "wrote 100%40 of the file",
      "version 2.4.1@latest and foo@bar",
      "see @here and @channel mentions",
      "price is 5%25 off",
      "password reset sent",
      "Authorization header missing",
      "The secret ingredient",
      "cwd=/Users/example",
    ]) {
      expect(scrub(text), text).toBe(text);
    }
  });

  it("is a fixed point on every new shape", () => {
    for (const text of [
      "DB_PASSWORD=hunter2 GITHUB_TOKEN=abcdefghij",
      String.raw`{\"password\":\"hunter2\"}`,
      "Cookie: a=b; sessionid=hunter2zzz; theme=dark",
      "Set-Cookie: a=b; Expires=Wed, 21 Oct 2026 07:28:00 GMT, c=d",
      'Authorization: Digest a="b", c="d"',
      "anna@bücher.de ana%40example.test",
    ]) {
      const once = scrub(text);
      expect(scrub(once), text).toBe(once);
    }
  });
});

describe("redaction cost", () => {
  const MB = 1_000_000;
  const timed = (run: () => unknown) => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it("reads a 1 MB string in under 200 ms", () => {
    const text = "a".repeat(MB);
    expect(timed(() => scrub(text))).toBeLessThan(200);
    expect(timed(() => redactSecrets(text))).toBeLessThan(200);
    expect(timed(() => scrubId(text))).toBeLessThan(200);
  });

  it("does not read an address-shaped run once per letter (it took seconds at 100 KB)", () => {
    expect(timed(() => redactSecrets("a".repeat(100_000)))).toBeLessThan(200);
    expect(timed(() => redactSecrets("a.".repeat(50_000)))).toBeLessThan(200);
  });

  it.each([
    ["a run of percent signs", "%".repeat(MB)],
    ["encoded at-signs", "%2540".repeat(MB / 5)],
    ["at-signs", "@".repeat(MB)],
    [
      "a failing address after another",
      ("a@" + "b".repeat(1000) + " ").repeat(MB / 1002),
    ],
    ["JWT openers", "eyJ-".repeat(MB / 4)],
    ["Bearer openers", "Bearer ".repeat(MB / 7)],
    ["header names", "authorization:".repeat(MB / 14)],
    ["cookie names", "cookie:".repeat(MB / 7)],
    ["cookie parts", "cookie: " + "a=b; ".repeat(MB / 5)],
    ["escaped JSON keys", String.raw`\"password\":\"`.repeat(MB / 16)],
    ["question marks", "?a".repeat(MB / 2)],
    [
      "private key openers",
      ("-----BEGIN " + "PRIVATE KEY-----").repeat(MB / 27),
    ],
    ["combining marks", "a" + "\u0301".repeat(MB)],
  ])("stays linear on %s", (_name, text) => {
    expect(timed(() => scrub(text))).toBeLessThan(1000);
    expect(timed(() => redactSecrets(text))).toBeLessThan(1000);
    expect(
      timed(() => redactDeep({ text, [text.slice(0, 5000)]: [text] })),
    ).toBeLessThan(1000);
  });

  it("cuts a text past the cap before any rule reads it, and says so", () => {
    const out = redactSecrets(`${"x ".repeat(REDACT_INPUT_MAX_CHARS)}tail`);
    expect(out.length).toBeLessThan(REDACT_INPUT_MAX_CHARS + 20);
    expect(out.endsWith("…[truncated]")).toBe(true);
    expect(out).not.toContain("tail");
    expect(redactSecrets("short text")).toBe("short text");
  });
});

describe("redactDeep, on values built to hurt", () => {
  it("names a cycle once and finishes, however many ways lead back", () => {
    const node: Record<string, unknown> = { id: "n1" };
    for (let index = 0; index < 12; index += 1) node[`back${index}`] = node;
    node.list = [node, node, { again: node }];
    const out = redactDeep(node) as Record<string, unknown>;
    expect(out.id).toBe("n1");
    expect(out.back0).toBe("[cycle]");
    expect(out.list).toEqual(["[cycle]", "[cycle]", { again: "[cycle]" }]);
  });

  it("stops at a node budget on a wide value, and marks the cut", () => {
    const wide = Array.from({ length: 200_000 }, (_, index) => `item ${index}`);
    const out = redactDeep(wide) as string[];
    expect(out.length).toBe(wide.length);
    expect(
      out.filter((entry) => entry.endsWith("…[truncated]")).length,
    ).toBeGreaterThan(0);
    expect(out[0]).toBe("item 0");
  });

  it("marks a property that throws when read, and keeps the rest", () => {
    const trap = {
      fine: `sent ${fake("gh", "p_", "A".repeat(36))}`,
      get boom(): string {
        throw new Error("no");
      },
    };
    const out = redactDeep(trap) as Record<string, string>;
    expect(out.boom).toBe(UNREADABLE);
    expect(out.fine).toBe("sent [redacted]");
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no");
        },
      },
    );
    expect(redactDeep({ proxy })).toEqual({ proxy: UNREADABLE });
  });

  it("keeps a key named __proto__ as a key", () => {
    const out = redactDeep(JSON.parse('{"__proto__":{"polluted":true},"a":1}'));
    expect(Object.keys(out)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("a field that cannot be read costs the field, never the event", () => {
  function hostileError(): Error {
    const error = new Error("fine");
    Object.defineProperty(error, "message", {
      get() {
        throw new Error("unreadable message");
      },
    });
    return error;
  }

  it("drops an error whose message getter throws from the details, and counts it", () => {
    expect(sanitizeDetails({ failure: hostileError(), status: 502 })).toEqual({
      fields: { status: 502 },
      droppedFields: 1,
    });
  });

  it("counts details whose keys cannot be listed as one refusal", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no");
        },
      },
    );
    expect(sanitizeDetails(proxy)).toEqual({ fields: {}, droppedFields: 1 });
  });

  it("says [unreadable] for the message of such an error, and keeps its name and code", () => {
    const error = hostileError();
    Object.assign(error, { code: "ECONNRESET" });
    expect(errorDetails(error)).toEqual({
      errorName: "Error",
      errorMessage: UNREADABLE,
      errorCode: "ECONNRESET",
    });
  });

  it("counts an optional property that throws, so absent and unreadable differ", () => {
    const error = new Error("boom");
    Object.defineProperty(error, "code", {
      get() {
        throw new Error("no");
      },
    });
    Object.assign(error, { status: 503 });
    expect(errorDetails(error)).toEqual({
      errorName: "Error",
      errorMessage: "boom",
      errorStatus: 503,
      errorUnreadable: 1,
    });
    expect(errorDetails(new Error("boom"))).not.toHaveProperty(
      "errorUnreadable",
    );
  });

  it("describes a proxy whose traps throw as unreadable", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no");
        },
      },
    );
    expect(describeShape(proxy)).toBe("unreadable");
    expect(describeShape({ nested: proxy })).toMatchObject({
      keys: { nested: "unreadable" },
    });
  });

  it("records the event with the field dropped and counted, where it was lost before", async () => {
    const inserted: TripwireRow[] = [];
    const store = {
      insert: vi.fn(async (row: TripwireRow) => void inserted.push(row)),
      prune: vi.fn(async () => 0),
    } as unknown as TripwireStore;
    const failures: string[] = [];
    const recorder = createTripwireRecorder({
      store,
      logLine: () => {},
      logFailure: (line) => failures.push(line),
    });

    recorder.record({
      area: "provider",
      code: "provider_status_unexpected",
      severity: "warn",
      scope: { orgId: "org-1", factoryId: "factory-1" },
      details: { failure: hostileError(), status: 502 },
    });
    await recorder.flush();

    expect(failures).toEqual([]);
    expect(inserted).toHaveLength(1);
    expect(JSON.parse(inserted[0].detailsJson)).toEqual({
      status: 502,
      droppedFields: 1,
    });
  });
});
