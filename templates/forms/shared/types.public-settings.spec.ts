/**
 * Security regression test for the forms public-config leak.
 *
 * The unauthenticated public form endpoints — the JSON handler
 * `getPublicForm` (server/handlers/forms.ts) and the SSR path
 * `getFormBySlugOrId` (server/lib/public-form-ssr.ts) — both project the
 * owner's full `FormSettings` down through `toPublicFormSettings` before the
 * payload reaches an anonymous visitor. This test pins that projection: owner-
 * private `settings.integrations[]` (Slack/Discord/generic webhook URLs) and
 * `settings.allowedOrigins[]` must NEVER appear in the public payload, while
 * the legitimate render/submit fields must survive.
 *
 * Runs as a dependency-free tsx script (vitest is not wired into this template).
 * Command:
 *   cd /Users/steve/Projects/builder/agent-native/framework && \
 *     node_modules/.bin/tsx templates/forms/shared/types.public-settings.spec.ts
 */

import { toPublicFormSettings, type FormSettings } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal zero-dependency assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  FAIL ${name}: ${msg}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Fixture: a full owner FormSettings carrying secrets + legit public fields
// ---------------------------------------------------------------------------

const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B11111111/SECRETxxxxxxxxxxxxxxxx";
const DISCORD_WEBHOOK =
  "https://discord.com/api/webhooks/2222222222/SECRETdiscordTokenZZZZ";
const GENERIC_WEBHOOK =
  "https://internal.example.com/hooks/forms?token=SECRETgenericTokenABC";
const SECRET_ORIGIN = "https://owner-internal-admin.example.com";

const SECRET_STRINGS = [
  SLACK_WEBHOOK,
  DISCORD_WEBHOOK,
  GENERIC_WEBHOOK,
  SECRET_ORIGIN,
];

const ownerSettings: FormSettings = {
  // legitimate public-facing fields
  submitText: "Send it",
  successMessage: "Thanks, we got your response!",
  redirectUrl: "https://example.com/thanks",
  showProgressBar: true,
  anonymous: true,
  // owner-private secrets that must NOT leak
  integrations: [
    {
      id: "int-slack",
      type: "slack",
      name: "Team Slack",
      enabled: true,
      url: SLACK_WEBHOOK,
    },
    {
      id: "int-discord",
      type: "discord",
      name: "Community Discord",
      enabled: true,
      url: DISCORD_WEBHOOK,
    },
    {
      id: "int-webhook",
      type: "webhook",
      name: "Generic Webhook",
      enabled: false,
      url: GENERIC_WEBHOOK,
    },
  ],
  allowedOrigins: ["https://app.example.com", SECRET_ORIGIN],
};

// ---------------------------------------------------------------------------
// 1. toPublicFormSettings projection
// ---------------------------------------------------------------------------

console.log("toPublicFormSettings projection");

const projected = toPublicFormSettings(ownerSettings);
const projectedJson = JSON.stringify(projected);

check("omits the `integrations` key entirely", () => {
  assert(
    !("integrations" in projected),
    "projected object still has an `integrations` key",
  );
});

check("omits the `allowedOrigins` key entirely", () => {
  assert(
    !("allowedOrigins" in projected),
    "projected object still has an `allowedOrigins` key",
  );
});

check("omits the owner-only `anonymous` privacy setting", () => {
  assert(
    !("anonymous" in projected),
    "projected object still has the `anonymous` key",
  );
});

check(
  "no integration webhook URL or secret origin appears anywhere in the projection",
  () => {
    for (const secret of SECRET_STRINGS) {
      assert(
        !projectedJson.includes(secret),
        `secret leaked into projection: ${secret}`,
      );
    }
    // Also guard against partial leaks of the obvious secret tokens.
    for (const token of [
      "hooks.slack.com",
      "discord.com/api/webhooks",
      "SECRET",
    ]) {
      assert(
        !projectedJson.includes(token),
        `secret token leaked into projection: ${token}`,
      );
    }
  },
);

check("keeps the legitimate public render/submit fields", () => {
  assert(projected.submitText === "Send it", "submitText was dropped");
  assert(
    projected.successMessage === "Thanks, we got your response!",
    "successMessage was dropped",
  );
  assert(
    projected.redirectUrl === "https://example.com/thanks",
    "redirectUrl was dropped",
  );
  assert(projected.showProgressBar === true, "showProgressBar was dropped");
});

check(
  "the allowlist is exactly the four public fields (no extras leak)",
  () => {
    const keys = Object.keys(projected).sort();
    assert(
      JSON.stringify(keys) ===
        JSON.stringify(
          [
            "redirectUrl",
            "showProgressBar",
            "submitText",
            "successMessage",
          ].sort(),
        ),
      `unexpected keys in projection: ${keys.join(", ")}`,
    );
  },
);

check("handles null/undefined settings without throwing or leaking", () => {
  assert(
    JSON.stringify(toPublicFormSettings(null)) === "{}",
    "null settings should project to {}",
  );
  assert(
    JSON.stringify(toPublicFormSettings(undefined)) === "{}",
    "undefined settings should project to {}",
  );
});

// ---------------------------------------------------------------------------
// 2. Public payload shape — mirrors what getPublicForm / getFormBySlugOrId
//    build from a stored DB row. We reproduce the exact `result` object both
//    public handlers serialize (settings projected through the allowlist) from
//    a stubbed row, and assert no integration/webhook data survives.
// ---------------------------------------------------------------------------

console.log("public handler payload (stubbed DB row)");

// A stored forms row keeps `settings` and `fields` as JSON strings (see
// JSON.parse(row.settings) in both public handlers).
const stubbedRow = {
  id: "form_abc123",
  title: "Customer Feedback",
  description: "Tell us what you think",
  status: "published" as const,
  deletedAt: null,
  fields: JSON.stringify([
    { id: "name", type: "text", label: "Name", required: true },
  ]),
  settings: JSON.stringify(ownerSettings),
};

// This is byte-for-byte the projection logic both public handlers run after the
// row passes the published/not-deleted gate.
const settings = JSON.parse(stubbedRow.settings) as FormSettings;
const publicResult = {
  id: stubbedRow.id,
  title: stubbedRow.title,
  description: stubbedRow.description,
  fields: JSON.parse(stubbedRow.fields),
  settings: toPublicFormSettings(settings),
};

const publicResultJson = JSON.stringify(publicResult);

check("public payload carries no secret webhook URLs or origins", () => {
  for (const secret of SECRET_STRINGS) {
    assert(
      !publicResultJson.includes(secret),
      `secret leaked into public payload: ${secret}`,
    );
  }
});

check(
  "public payload has no `integrations` or `allowedOrigins` under settings",
  () => {
    assert(
      !("integrations" in publicResult.settings),
      "public payload settings leaked `integrations`",
    );
    assert(
      !("allowedOrigins" in publicResult.settings),
      "public payload settings leaked `allowedOrigins`",
    );
  },
);

check("public payload still exposes what the renderer needs", () => {
  assert(publicResult.settings.submitText === "Send it", "submitText missing");
  assert(
    publicResult.settings.redirectUrl === "https://example.com/thanks",
    "redirectUrl missing",
  );
  assert(publicResult.title === "Customer Feedback", "title missing");
  assert(Array.isArray(publicResult.fields), "fields missing");
});

// ---------------------------------------------------------------------------
// Summary / exit code
// ---------------------------------------------------------------------------

const total = passed + failures.length;
console.log("");
if (failures.length === 0) {
  console.log(`PASS  ${passed}/${total} assertions passed`);
  process.exit(0);
} else {
  console.log(`FAIL  ${failures.length}/${total} assertions failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
