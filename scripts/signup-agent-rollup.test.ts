import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSignupAgentRollup,
  parseSignupAgentFindings,
} from "./signup-agent-rollup.ts";

const markdown = `### beta chat

The page stalled after returning from email.

| Severity | Step | Issue | Evidence |
| --- | --- | --- | --- |
| high | After email link | The app stays on a spinner | Spinner remains after 15 seconds |
| medium | Reload | Welcome text says a\\|b | Unexpected literal copy |
`;

test("signup agent rollup preserves each finding title, signature, and evidence", () => {
  const findings = parseSignupAgentFindings(markdown);
  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.target, "beta chat");
  assert.equal(findings[0]?.title, "The app stays on a spinner");
  assert.equal(findings[1]?.title, "Welcome text says a|b");
  assert.match(findings[0]?.signature ?? "", /^[0-9a-f]{12}$/);

  const rollup = buildSignupAgentRollup({
    markdown,
    status: "reported high findings",
    targets: "chat",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    artifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/456",
  });
  assert.match(rollup.slackText, /Findings: 2 total; showing 2; 0 omitted/);
  assert.match(rollup.slackText, /The app stays on a spinner/);
  assert.match(rollup.slackText, /signup-agent-[0-9a-f]{12}/);
  assert.match(rollup.slackText, /Spinner remains after 15 seconds/);
});

test("signup agent rollup reports the exact overflow count and keeps the full report", () => {
  const rows = Array.from(
    { length: 180 },
    (_, index) =>
      `| high | Step ${index} | ${"Stalled state ".repeat(8)}${index} | ${"Visible evidence ".repeat(10)}${index} |`,
  ).join("\n");
  const longMarkdown = `### beta chat\n\n| Severity | Step | Issue | Evidence |\n| --- | --- | --- | --- |\n${rows}`;
  const rollup = buildSignupAgentRollup({
    markdown: longMarkdown,
    status: "reported high findings",
    targets: "chat",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    artifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/456",
  });
  assert.equal(rollup.findingCount, 180);
  assert.ok(rollup.omittedFindingCount > 0);
  assert.match(
    rollup.slackText,
    new RegExp(
      `Findings: 180 total; showing ${rollup.visibleFindingCount}; ${rollup.omittedFindingCount} omitted`,
    ),
  );
  assert.ok(rollup.reportMarkdown.includes("Stalled state"));
  assert.match(
    rollup.slackText,
    /complete report artifact \(retained 90 days\)/,
  );
});

test("an incomplete signup agent run surfaces a missing findings report", () => {
  const rollup = buildSignupAgentRollup({
    markdown: "",
    status: "did not complete successfully",
    targets: "chat",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    reportIncomplete: true,
  });

  assert.equal(rollup.findingCount, 1);
  assert.match(rollup.slackText, /Findings: 1 total; showing 1; 0 omitted/);
  assert.match(rollup.slackText, /did not produce a findings report/);
  assert.match(rollup.slackText, /report artifact is unavailable/);
});

test("signup agent report text cannot create Slack mentions or links", () => {
  const maliciousMarkdown = [
    "### <@U123> <!channel> https://evil.test",
    "",
    "| Severity | Step | Issue | Evidence |",
    "| --- | --- | --- | --- |",
    "| high | step @here | title <@U456> <!channel> https://evil.test | evidence www.evil.test @everyone |",
  ].join("\n");
  const rollup = buildSignupAgentRollup({
    markdown: maliciousMarkdown,
    status: "review <!channel> @here",
    targets: "app @here",
    environments: "beta",
    runUrl: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    artifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/456",
  });

  assert.doesNotMatch(rollup.slackText, /<@U123>|<!channel>/);
  assert.ok(!rollup.slackText.includes("<https://evil.test"));
  assert.ok(rollup.slackText.includes("evil.\u200btest"));
  assert.doesNotMatch(rollup.slackText, /@(?:here|everyone|U123|U456)/);
  assert.ok(rollup.slackText.includes("https://\u200b"));
  assert.ok(
    rollup.slackText.includes(
      "<https://github.com/BuilderIO/agent-native/actions/runs/123|workflow run>",
    ),
  );
});
