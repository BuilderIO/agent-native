import { strict as assert } from "node:assert";
import { test } from "node:test";

import { recordFlowEvidence } from "./flow-evidence.js";

void test("records the asserted view after cleanup and uses the current page on failure", async () => {
  let page = "Agent";
  const evidence = { screenshot: Buffer.from(page) };
  page = "Home";
  const saved: string[] = [];
  const hook = async ({ capture }: { capture?: () => Promise<Buffer> }) => {
    saved.push(
      (
        await (capture ? capture() : Promise.resolve(Buffer.from(page)))
      ).toString(),
    );
    return { kind: "saved" };
  };
  await recordFlowEvidence(hook, { status: "PASS" }, evidence);
  await recordFlowEvidence(hook, { status: "FAIL" }, evidence);
  assert.deepEqual(saved, ["Agent", "Home"]);
});

void test("does not report a successful capture when the hook cannot save it", async () => {
  await assert.rejects(
    recordFlowEvidence(
      async () => ({ kind: "could-not-run" }),
      { status: "PASS" },
      { screenshot: Buffer.from("Agent") },
    ),
    /could not be saved/,
  );
});
