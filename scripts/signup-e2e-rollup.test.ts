import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSignupE2ERollup,
  parseSignupE2EFindings,
  type SignupE2EJobLog,
} from "./signup-e2e-rollup.ts";

const jobs: SignupE2EJobLog[] = [
  {
    id: 7,
    name: "Full signup flow (chat, beta)",
    url: "https://github.com/BuilderIO/agent-native/actions/runs/123/job/7",
    conclusion: "failure",
    log: [
      "  1) [chromium] › e2e/signup/specs/signup.spec.ts:101:7 › email link opens the signed-in app",
      "     Error: expect(page).toHaveURL(expected) failed",
      "     Expected: /chat/",
      "  2) [chromium] › e2e/signup/specs/signup.spec.ts:201:7 › reload retains the new session",
      "     Test timeout of 360000ms exceeded.",
    ].join("\n"),
  },
];

test("signup E2E rollup names every failed test with a stable signature and summary", () => {
  const findings = parseSignupE2EFindings(jobs);
  assert.equal(findings.length, 2);
  assert.equal(
    findings[0]?.title,
    "e2e/signup/specs/signup.spec.ts:101:7 › email link opens the signed-in app",
  );
  assert.match(findings[0]?.signature ?? "", /^[0-9a-f]{12}$/);
  assert.match(findings[0]?.summary ?? "", /toHaveURL/);
  assert.match(findings[1]?.summary ?? "", /Test timeout/);

  const rollup = buildSignupE2ERollup({
    jobs,
    workflowResult: "failure",
    apps: "chat",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    evidenceUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/456",
    reportArtifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/789",
  });
  assert.match(rollup.slackText, /2 findings total; showing 2; 0 omitted/);
  assert.match(rollup.slackText, /email link opens the signed-in app/);
  assert.match(rollup.slackText, /signup-e2e-[0-9a-f]{12}/);
  assert.match(rollup.slackText, /toHaveURL/);
  assert.match(rollup.slackText, /90-day report artifact/);
});

test("signup E2E rollup retains all details and reports exact Slack overflow", () => {
  const largeJob = {
    ...jobs[0]!,
    log: Array.from(
      { length: 100 },
      (_, index) =>
        `  ${index + 1}) [chromium] › e2e/signup/specs/signup.spec.ts:${index + 1}:7 › ${"signup failure ".repeat(15)}${index}\n     Error: ${"expected visible state ".repeat(8)}${index}`,
    ).join("\n"),
  };
  const rollup = buildSignupE2ERollup({
    jobs: [largeJob],
    workflowResult: "failure",
    apps: "all",
    environments: "beta,production",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    reportArtifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/789",
  });
  assert.equal(rollup.findingCount, 100);
  assert.ok(rollup.omittedFindingCount > 0);
  assert.match(
    rollup.slackText,
    new RegExp(
      `100 findings total; showing ${rollup.visibleFindingCount}; ${rollup.omittedFindingCount} omitted`,
    ),
  );
  assert.match(rollup.reportMarkdown, /Error: expected visible state/);
  assert.match(
    rollup.slackText,
    /additional findings are in the complete report artifact \(retained 90 days\)/,
  );
});

test("signup E2E reports a failed job when its log has no test titles", () => {
  const findings = parseSignupE2EFindings([
    { ...jobs[0]!, log: "Type error: e2e/signup/specs/signup.spec.ts:1" },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Full signup flow (chat, beta)");
  assert.match(findings[0]?.summary ?? "", /Type error/);
});

test("signup E2E recognizes test titles and annotations in timestamped logs", () => {
  const timestampedJob = {
    ...jobs[0]!,
    log: [
      "Full signup flow (chat, beta)\t2026-10-10T10:11:12.1234567Z\t  1) [chromium] › e2e/signup/specs/signup.spec.ts:101:7 › email link opens the signed-in app",
      "Full signup flow (chat, beta)\t2026-10-10T10:11:13.1234567Z\t     Error: expect(page).toHaveURL(expected) failed",
      "Full signup flow (chat, beta)\t2026-10-10T10:11:14.1234567Z\t::error title=Test failed: verification link keeps the session::Error: expected session cookie",
    ].join("\n"),
  };

  const findings = parseSignupE2EFindings([timestampedJob]);
  assert.equal(findings.length, 2);
  assert.equal(
    findings[0]?.title,
    "e2e/signup/specs/signup.spec.ts:101:7 › email link opens the signed-in app",
  );
  assert.match(findings[0]?.summary ?? "", /toHaveURL/);
  assert.equal(findings[1]?.title, "verification link keeps the session");
  assert.match(findings[1]?.summary ?? "", /expected session cookie/);
});

test("signup E2E report text cannot create Slack mentions or links", () => {
  const maliciousJob = {
    ...jobs[0]!,
    name: "Signup <@U123> <!channel>",
    url: "https://evil.test/actions/runs/123/job/456",
    log: "  1) [chromium] › e2e/signup/spec.ts:1:1 › failure <@U123> <!channel> https://evil.test\n     Error: <https://evil.test|click> @here",
  };
  const rollup = buildSignupE2ERollup({
    jobs: [maliciousJob],
    workflowResult: "failure <!channel>",
    apps: "chat @here",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    collectionErrors: [
      "Could not read @here <https://evil.test|click> www.evil.test",
    ],
  });

  assert.doesNotMatch(rollup.slackText, /<@U123>|<!channel>/);
  assert.ok(!rollup.slackText.includes("<https://evil.test"));
  assert.ok(rollup.slackText.includes("evil.\u200btest"));
  assert.doesNotMatch(rollup.slackText, /@(?:here|U123)/);
  assert.ok(rollup.slackText.includes("https://\u200b"));
  assert.ok(
    rollup.slackText.includes(
      "<https://github.com/BuilderIO/agent-native/actions/runs/123|workflow run>",
    ),
  );
});

test("signup E2E includes collection warnings and preserves all warnings in the full report", () => {
  const collectionErrors = Array.from(
    { length: 40 },
    (_, index) =>
      `Could not read job ${index}: ${"metadata unavailable ".repeat(12)}`,
  );
  const rollup = buildSignupE2ERollup({
    jobs,
    workflowResult: "failure",
    apps: "chat",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    collectionErrors,
  });

  assert.match(rollup.slackText, /Collection warnings: 40 total; showing \d+;/);
  assert.match(
    rollup.slackText,
    /40 total; showing \d+; \d+ omitted from this Slack message/,
  );
  assert.match(rollup.reportMarkdown, /Could not read job 39/);
});
