import { describe, expect, it } from "vitest";

import { redactBrowserDiagnosticString } from "../../../../templates/clips/shared/browser-diagnostics.js";
import { redactLogString } from "../../../desktop-app/src/main/log-redaction.js";
import { sanitizeToolErrorText } from "../agent/tool-error-redaction.js";
import { redactTextToSummary } from "../audit/redact.js";
import { redactSecrets } from "../client/error-capture.js";
import { sanitizeToolErrorMessage } from "../observability/trace-error.js";
import { redactCapturedString } from "../observability/trace-redaction.js";
import { measureCpuMs } from "../testing/cpu-time.js";
import { redact } from "../tracking/redaction.js";
import { SIGNED_LINK_PARAMS } from "./agent-access.js";
import { redactSecretsInText } from "./secret-redaction.js";

// Every place secret-bearing text leaves the process has a wrapper over the one
// primitive. Adding a sink means adding it here: a secret that gets through any
// of them fails this file.
const sinks: Array<[name: string, placeholder: string, run: Redactor]> = [
  [
    "shared redactSecretsInText",
    "<redacted>",
    (text) => redactSecretsInText(text, { placeholder: "<redacted>" }),
  ],
  [
    "shared redactSecretsInText (named)",
    "<redacted>",
    (text) =>
      redactSecretsInText(text, { placeholder: "<redacted>", names: "named" }),
  ],
  ["tracking redact", "<redacted>", redact],
  ["client error-capture redactSecrets", "<redacted>", redactSecrets],
  [
    "clips redactBrowserDiagnosticString",
    "<redacted>",
    (text) => redactBrowserDiagnosticString(text),
  ],
  [
    "trace redactCapturedString",
    "[REDACTED]",
    (text) => redactCapturedString(text),
  ],
  ["trace sanitizeToolErrorMessage", "[REDACTED]", sanitizeToolErrorMessage],
  ["tool sanitizeToolErrorText", "[REDACTED]", sanitizeToolErrorText],
  ["desktop redactLogString", "[REDACTED]", redactLogString],
  [
    "audit redactTextToSummary",
    "[redacted]",
    (text) => redactTextToSummary(text) ?? "",
  ],
];

type Redactor = (text: string) => string;

// Assembled at runtime so no credential-shaped literal sits in the source.
const join = (...parts: string[]) => parts.join("");

interface Shape {
  label: string;
  text: string;
  // The part of the text that must not survive.
  secret: string;
}

function shape(label: string, template: string, secret: string): Shape {
  return { label, text: template.replace("{}", secret), secret };
}

// The 19 shapes the secret-emission audit ran through each redactor.
const auditShapes: Shape[] = [
  shape("JSON apiKey", '{"apiKey":"{}"}', "CANARYJSONKEY0123456789"),
  shape(
    "?key= parameter",
    "GET https://api.example.com/v1/models?key={}&alt=json",
    "CANARYKEYPARAM0123456789",
  ),
  shape(
    "postgres URL password",
    join(
      "connect failed: postgres://appuser:",
      "{}",
      "@db.example.com:5432/app",
    ),
    "CANARYDBPASS01",
  ),
  shape(
    "bare sk-ant key",
    "provider said key {} was rejected",
    join("sk-ant-api03-", "CANARYANTKEY0123456789abcdefgh"),
  ),
  shape(
    "bare ghp_ token",
    "clone failed for {}",
    join("ghp_", "CANARYGHPTOKEN0123456789abcdefghij"),
  ),
  shape(
    "bare xoxb- token",
    "slack auth {}",
    join("xoxb-000000000000-000000000000-", "CANARYSLACKBOTTOKENABCDEFGH"),
  ),
  shape(
    "bare AKIA key",
    "aws error for {} denied",
    join("AKIA", "CANARYAWSKEY12345"),
  ),
  shape(
    "bare AIza key",
    "google key {} invalid",
    join("AIza", "SyCANARYGOOGLEKEY0123456789abcdefg"),
  ),
  shape(
    "bare ya29. token",
    "token {} expired",
    join("ya29.", "a0CANARYGOOGLEACCESS0123456789abcdefghijklmn"),
  ),
  shape(
    "bare JWT",
    "session {} rejected",
    join(
      "eyJhbGciOiJIUzI1NiJ9.",
      "eyJzdWIiOiJjYW5hcnktdXNlciJ9.",
      "CANARYJWTSIGNATURE0123456789",
    ),
  ),
  shape(
    "PEM block",
    join("-----BEGIN PRIVATE KEY-----\n", "{}", "\n-----END PRIVATE KEY-----"),
    "MIICANARYPEMBODY0123456789abcdef",
  ),
  shape(
    "Authorization: Bearer",
    "Authorization: Bearer {}",
    "CANARYBEARERTOKEN0123456789abcdef",
  ),
  shape(
    "URL access_token",
    "redirect https://app.example.com/cb?access_token={}&x=1",
    "CANARYURLACCESSTOKEN0123456789",
  ),
  shape(
    "client_secret JSON",
    '{"client_id":"123","client_secret":"{}"}',
    "CANARYCLIENTSECRET0123456789",
  ),
  shape(
    "URL ?code=&state=",
    "returned https://app.example.com/cb?code={}&state=CANARYSTATEVALUE0123",
    "4/0ACANARYAUTHCODE0123456789",
  ),
  shape(
    "Slack webhook URL",
    join("post to https://hooks.slack.com/services/T00000000/B00000000/", "{}"),
    "CANARYWEBHOOKSECRET0123456789",
  ),
  shape(
    "Cookie header",
    "Cookie: better-auth.session_token={}; theme=dark",
    "CANARYSESSIONCOOKIE0123456789",
  ),
  shape(
    "password= assignment",
    "login failed password={} user=bob",
    "CANARYPLAINPASSW0RD",
  ),
  shape(
    "x-webhook-secret header",
    "x-webhook-secret: {}",
    "CANARYWEBHOOKHDRSECRET0123456789",
  ),
];

// The strings the audit ran through tool-error redaction, beyond the 19.
const toolErrorShapes: Shape[] = [
  shape(
    "tool sk- key",
    "provider said {}",
    join("sk-", "CANARYTOOLKEYCANARYTOOLKEY"),
  ),
  shape(
    "tool sk_live_ key",
    "stripe said {}",
    join("sk_live_", "CANARYSTRIPEKEY01234567"),
  ),
  shape(
    "tool ?api_key=",
    "GET https://x.example.com/?api_key={}",
    "CANARYAPIKEYQUERY0123456",
  ),
  shape("tool token: quoted", 'token: "{}"', "CANARYTOKENQUOTED0123456"),
  shape(
    "tool long AKIA key",
    "aws {} denied",
    join("AKIA", "CANARYAWSKEY1234567890"),
  ),
];

// Names the URL scrubber redacts, and the signed-link names Core already lists.
const urlParameterNames = [
  ...SIGNED_LINK_PARAMS,
  "__an_embed_token",
  "clip_intake",
  "agent_access",
  "p-key",
  "api-key",
  "mcp_token",
  "nstoken",
  "x-sig-sso",
  "access_token",
];
const urlParameterShapes: Shape[] = [
  ...urlParameterNames.map((name) =>
    shape(
      `?${name}=`,
      `https://app.example.com/x?a=1&${name}={}&b=2`,
      "CANARYURLPARAM0123456789",
    ),
  ),
  shape(
    "#access_token=",
    "https://app.example.com/x#access_token={}&b=2",
    "CANARYHASHTOKEN0123456789",
  ),
  shape(
    "&amp;code=",
    "https://app.example.com/x?a=1&amp;code={}",
    "CANARYAMPCODE0123456789",
  ),
  shape(
    "code=&state= with no question mark",
    "failed: code={}&state=CANARYBARESTATE0123",
    "CANARYBARECODE0123456789",
  ),
];

const allShapes = [...auditShapes, ...toolErrorShapes, ...urlParameterShapes];

describe("secret redaction sinks", () => {
  it("has the audit's 19 shapes", () => {
    expect(auditShapes).toHaveLength(19);
  });

  describe.each(sinks)("%s", (_name, placeholder, run) => {
    it.each(allShapes)("redacts $label", ({ text, secret }) => {
      const out = run(text);
      expect(out).not.toContain(secret);
      expect(out).toContain(placeholder);
    });

    it("leaves ordinary text alone", () => {
      const text =
        "Error: Request failed with status code 404 at https://app.example.com/a?page=2&utm_source=x";
      expect(run(text)).toBe(text);
    });
  });

  it("keeps the tool name in a tool error readable", () => {
    expect(sanitizeToolErrorText("Error running create_token: Forbidden")).toBe(
      "Error running create_token: Forbidden",
    );
    expect(sanitizeToolErrorText("Error running create_token: token=abc")).toBe(
      "Error running create_token: token=[REDACTED]",
    );
  });

  it("keeps a cursor readable in tool-error text", () => {
    const text =
      'GET /files?pageToken=abc&nextPageToken=def {"nextPageToken":"ghi"}';
    expect(sanitizeToolErrorText(text)).toBe(text);
    expect(sanitizeToolErrorText("GET /files?access_token=abc")).toBe(
      "GET /files?access_token=[REDACTED]",
    );
  });

  describe("time", () => {
    // Repeats of what each pattern starts on: a pattern that restarts inside a
    // run of its own start text goes quadratic.
    const units = [
      "token_",
      "sk-",
      "key=",
      "a=",
      "?key=",
      "&code=",
      "code=",
      "Bearer ",
      "eyJ-",
      "eyJaaaa.",
      "postgres://",
      "a.a",
      "a:b@",
      "-----BEGIN ",
      "AKIA",
      "xoxb-",
      '"token":"',
      "authorization: ",
      "webhookUrl: ",
      "x.webhook url",
      "a ",
    ];
    const run = (unit: string, length: number) =>
      unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

    describe.each(sinks)("%s", (_name, _placeholder, redactor) => {
      it.each(units)("stays linear on repeated %j", (unit) => {
        for (const length of [8_192, 65_536]) {
          const text = run(unit, length);
          expect(measureCpuMs(() => redactor(text))).toBeLessThan(250);
        }
      });
    });
  });
});
