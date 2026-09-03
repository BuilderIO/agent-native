import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  renderReviewMarkdown,
  reviewSignupJourney,
  type JourneyStep,
} from "./agent-review";

const originalFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

function step(): JourneyStep {
  return {
    label: "sign-in page",
    url: "https://beta.clips.agent-native.com/sign-in",
    visibleText: "Sign in",
    screenshot: Buffer.from("not-a-real-png"),
    consoleErrors: [],
    networkEvents: [],
  };
}

function respondWith(text: string, ok = true, status = 200) {
  respondWithSequence([text], ok, status);
}

function respondWithSequence(texts: string[], ok = true, status = 200) {
  let index = 0;
  globalThis.fetch = (async () => {
    const text = texts[Math.min(index++, texts.length - 1)] ?? "";
    return {
      ok,
      status,
      json: async () => ({ content: [{ type: "text", text }] }),
      text: async () => text,
    } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

test("a missing key fails loudly instead of reporting a clean flow", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(
    () => reviewSignupJourney("clips", "beta", [step()]),
    /ANTHROPIC_API_KEY is required/,
  );
});

test("an API error is never reported as zero findings", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWith("upstream exploded", false, 500);
  await assert.rejects(
    () => reviewSignupJourney("clips", "beta", [step()]),
    /HTTP 500/,
  );
});

test("an unparseable response is never reported as zero findings", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWith("I had a look and everything seemed fine!");
  await assert.rejects(
    () => reviewSignupJourney("clips", "beta", [step()]),
    /no JSON object/,
  );
});

test("an unknown severity fails rather than being silently downgraded", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWith('{"summary":"x","findings":[{"severity":"catastrophic"}]}');
  await assert.rejects(
    () => reviewSignupJourney("clips", "beta", [step()]),
    /unrecognised severity/,
  );
});

test("a malformed model response gets one format-only retry", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWithSequence([
    '{"summary":"x","findings":[{"severity":"catastrophic"}]}',
    '{"summary":"ok","findings":[]}',
  ]);
  const review = await reviewSignupJourney("clips", "beta", [step()]);
  assert.equal(review.summary, "ok");
  assert.deepEqual(review.findings, []);
});

test("a fenced JSON reply parses into findings", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWith(
    '```json\n{"summary":"stuck","findings":[{"severity":"high","step":"after requesting the link","issue":"nothing happened","evidence":"button still spinning"}]}\n```',
  );
  const review = await reviewSignupJourney("clips", "beta", [step()]);
  assert.equal(review.summary, "stuck");
  assert.equal(review.findings.length, 1);
  assert.equal(review.findings[0]?.severity, "high");
});

test("an empty findings array is a real clean result", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  respondWith('{"summary":"looked correct","findings":[]}');
  const review = await reviewSignupJourney("clips", "beta", [step()]);
  assert.deepEqual(review.findings, []);
  assert.match(
    renderReviewMarkdown("clips", "beta", review),
    /No issues reported/,
  );
});

test("pipes in model text cannot break the markdown table", () => {
  const markdown = renderReviewMarkdown("clips", "beta", {
    summary: "s",
    findings: [
      {
        severity: "medium",
        step: "a|b",
        issue: "c|d",
        evidence: "e\nf",
      },
    ],
  });
  const row = markdown.split("\n").at(-1) ?? "";
  assert.match(row, /a\\\|b/);
  assert.ok(!row.includes("\n"));
});

test("no captured steps is an error, not an empty review", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  await assert.rejects(
    () => reviewSignupJourney("clips", "beta", []),
    /at least one captured step/,
  );
});
