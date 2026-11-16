import { describe, expect, it } from "vitest";

import { measureCpuMs } from "../testing/cpu-time.js";
import { SIGNED_LINK_PARAMS } from "./agent-access.js";
import { isSecretName, redactSecretsInText } from "./secret-redaction.js";

const P = "<r>";
const redact = (text: string, names: "contains" | "named" = "contains") =>
  redactSecretsInText(text, { placeholder: P, names });
// Assembled at runtime so no credential-shaped literal sits in the source.
const join = (...parts: string[]) => parts.join("");

describe("redactSecretsInText names", () => {
  it("redacts the value of a credential-named assignment, keeping the key and quotes", () => {
    expect(redact("api_key=abc token: def")).toBe(`api_key=${P} token: ${P}`);
    expect(redact('{"accessToken":"abc","safe":"visible"}')).toBe(
      `{"accessToken":"${P}","safe":"visible"}`,
    );
    expect(redact("secret='quoted value' next=visible")).toBe(
      `secret='${P}' next=visible`,
    );
    expect(redact("a=token=xyz")).toBe(`a=token=${P}`);
  });

  it("leaves a plain word and an assignment of another name alone", () => {
    expect(redact("tokenization is fine")).toBe("tokenization is fine");
    expect(redact("name=bob retry=3")).toBe("name=bob retry=3");
  });

  it("redacts a quoted value that has no closing quote, and one with an escaped quote", () => {
    expect(redact('{"client_secret": "partial value')).toBe(
      `{"client_secret": "${P}"`,
    );
    expect(redact(String.raw`password="a \"quoted\" word" next=1`)).toBe(
      `password="${P}" next=1`,
    );
  });

  it("redacts a list value and leaves an empty value", () => {
    expect(redact('{"authorization":["Bearer abc"]}')).toBe(
      `{"authorization":["${P}"]}`,
    );
    expect(redact("token=\nnext: line")).toBe("token=\nnext: line");
  });

  it("takes the scheme with its credential, and a cookie to the end of the line", () => {
    expect(redact("Authorization: Bearer abc.def next=1")).toBe(
      `Authorization: ${P} next=1`,
    );
    expect(redact("token=Bearer abc next=1")).toBe(`token=${P} next=1`);
    expect(redact("Cookie: sid=abc; other=def\nnext: line")).toBe(
      `Cookie: ${P}\nnext: line`,
    );
    expect(redact("a Bearer abc and Basic dXNlcjpwYXNz")).toBe(
      `a Bearer ${P} and Basic ${P}`,
    );
    expect(redact("Basic authentication failed")).toBe(
      "Basic authentication failed",
    );
  });

  it("matches compound names by their credential word, or only whole names when asked", () => {
    const text = '{"stripe_secret_key":"a","mySecret":"b","tokenizer":"c"}';
    expect(redact(text)).toBe(
      `{"stripe_secret_key":"${P}","mySecret":"${P}","tokenizer":"${P}"}`,
    );
    expect(redact(text, "named")).toBe(
      `{"stripe_secret_key":"${P}","mySecret":"b","tokenizer":"c"}`,
    );
    expect(redact("x-webhook-secret: abc", "named")).toBe(
      `x-webhook-secret: ${P}`,
    );
    expect(redact("write-secret: failed", "named")).toBe(
      "write-secret: failed",
    );
  });

  it("keeps a cursor readable when asked for whole names, in a field and a URL", () => {
    const text =
      '/files?pageToken=abc&nextPageToken=def {"next_page_token":"ghi","$skiptoken":"jkl"}';
    expect(redact(text, "named")).toBe(text);
    expect(redact(text)).not.toContain("abc");
    expect(redact("/x?access_token=abc&page_token=def", "named")).toBe(
      `/x?access_token=${P}&page_token=def`,
    );
  });

  it("exposes the name test for a walker that holds an object key", () => {
    expect(isSecretName("x-api-key")).toBe(true);
    expect(isSecretName("databaseUrl")).toBe(true);
    expect(isSecretName("session_id")).toBe(false);
    expect(isSecretName("session_id", { session: true })).toBe(true);
    expect(isSecretName("title")).toBe(false);
  });
});

describe("redactSecretsInText URLs", () => {
  it.each([
    ...SIGNED_LINK_PARAMS,
    "__an_embed_token",
    "clip_intake",
    "p-key",
    "api-key",
    "mcp_token",
    "nstoken",
    "x-sig-sso",
    "access_token",
    "key",
    "code",
    "state",
    "sig",
  ])("redacts a %s query value in both name modes", (name) => {
    const url = `https://app.example.com/cb?a=1&${name}=CANARY01&b=2`;
    for (const mode of ["contains", "named"] as const) {
      expect(redact(url, mode)).toBe(
        `https://app.example.com/cb?a=1&${name}=${P}&b=2`,
      );
    }
  });

  it("redacts a value after a hash, an HTML-escaped ampersand, and a nested URL", () => {
    expect(redact("https://app.example.com/#access_token=CANARY01&x=1")).toBe(
      `https://app.example.com/#access_token=${P}&x=1`,
    );
    expect(redact("https://app.example.com/a?x=1&amp;code=CANARY01")).toBe(
      `https://app.example.com/a?x=1&amp;code=${P}`,
    );
    expect(redact("https://app.example.com/a?next=/b?token=CANARY01")).toBe(
      `https://app.example.com/a?next=/b?token=${P}`,
    );
  });

  it("keeps benign parameters and a trailing sentence mark", () => {
    expect(
      redact("https://app.example.com/a?utm_source=x&per_page=100&page=2"),
    ).toBe("https://app.example.com/a?utm_source=x&per_page=100&page=2");
    expect(redact("see https://app.example.com/a?sig=CANARY01, then")).toBe(
      `see https://app.example.com/a?sig=${P}, then`,
    );
  });

  it("redacts userinfo, keeping the scheme and host", () => {
    expect(redact("postgres://user:pa@ss@db.example.com:5432/app")).toBe(
      `postgres://${P}@db.example.com:5432/app`,
    );
    expect(redact("https://example.com:8443/a https://example.com/b")).toBe(
      "https://example.com:8443/a https://example.com/b",
    );
  });

  it("redacts a webhook URL whole", () => {
    const slack = join("https://hooks.slack.com/services/T0/B0/", "CANARY01");
    const discord = join("https://discord.com/api/webhooks/123/", "CANARY01");
    expect(redact(`post to ${slack} and ${discord}.`)).toBe(
      `post to ${P} and ${P}.`,
    );
  });
});

describe("redactSecretsInText shapes", () => {
  it("redacts provider keys, a JWT and a PEM block by shape", () => {
    const keys = [
      join("sk-ant-api03-", "CANARYKEY0123456789"),
      join("ghp_", "CANARYKEY0123456789abcdef"),
      join("AKIA", "CANARYKEY0123456"),
      join("xoxb-", "123456-CANARYKEY0123"),
      join("sk_live_", "CANARYKEY0123"),
      join("AIza", "SyCANARYKEY0123456789"),
      join("ya29.", "a0CANARYKEY0123"),
      join(
        "eyJhbGciOiJIUzI1NiJ9.",
        "eyJzdWIiOiJjYW5hcnkifQ.",
        "CANARYSIGNATURE",
      ),
    ];
    const pem = join(
      "-----BEGIN PRIVATE KEY-----\n",
      "CANARYPEMBODY\n",
      "-----END PRIVATE KEY-----",
    );
    expect(redact(`keys ${keys.join(" ")} then ${pem}`)).toBe(
      `keys ${keys.map(() => P).join(" ")} then ${P}`,
    );
  });

  it("leaves a short placeholder that is not a key", () => {
    expect(redact("use sk-example as a placeholder")).toBe(
      "use sk-example as a placeholder",
    );
  });
});

describe("redactSecretsInText tails", () => {
  it("redacts a credential cut off at the end only when asked", () => {
    const tail = (text: string, tail: true | "truncated") =>
      redactSecretsInText(text, { placeholder: P, tail });
    expect(redact("ended at sk-ant-")).toBe("ended at sk-ant-");
    expect(tail("ended at sk-ant-", true)).toBe(`ended at ${P}`);
    expect(tail("ended at eyJhbG.eyJzdW", true)).toBe(`ended at ${P}`);
    expect(tail("postgres://alice:partial", true)).toBe(`postgres://${P}`);
    expect(tail("https://example.com:8443", true)).toBe(
      "https://example.com:8443",
    );
    expect(tail("https://example.com:8443", "truncated")).toBe(`https://${P}`);
  });
});

describe("redactSecretsInText repeats", () => {
  it("is idempotent on its own output for each placeholder", () => {
    const text = [
      `Authorization: Bearer ${join("sk-", "CANARYKEY0123")}`,
      '{"token":"abc","list":["x"],"password":["y"]}',
      "https://u:p@h.example.com/a?code=1&state=2 token=Bearer abc",
    ].join("\n");
    for (const placeholder of ["<redacted>", "[REDACTED]", "[redacted]"]) {
      const once = redactSecretsInText(text, { placeholder });
      expect(redactSecretsInText(once, { placeholder })).toBe(once);
    }
  });
});

describe("redactSecretsInText time", () => {
  const units = [
    "token_",
    "sk-",
    "key=",
    "a=",
    "?key=",
    "&code=",
    "Bearer ",
    "eyJ-",
    "eyJaaaa.",
    "postgres://",
    "a.a",
    "://",
    "a:b@",
    "-----BEGIN ",
    "AKIA",
    "xoxb-",
    '"token":"',
    "authorization: ",
    "a ",
    "[",
  ];
  const run = (unit: string, length: number) =>
    unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

  it.each(units)("stays linear on repeated %j", (unit) => {
    for (const options of [
      { placeholder: P, tail: "truncated" as const },
      { placeholder: P, names: "named" as const, tail: true as const },
    ]) {
      const small = run(unit, 32_768);
      const large = run(unit, 131_072);
      const smallCpuMs = measureCpuMs(() =>
        redactSecretsInText(small, options),
      );
      const largeCpuMs = measureCpuMs(() =>
        redactSecretsInText(large, options),
      );
      // A quadratic pass takes 16 times as long on 4 times the text.
      expect(largeCpuMs).toBeLessThan(Math.max(250, smallCpuMs * 8));
    }
  });
});
