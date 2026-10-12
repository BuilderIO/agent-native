import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { classifySave } from "../../../templates/content/e2e/helpers";
import {
  SaveLineageCapture,
  type SaveLineageBucket,
} from "../../../templates/content/e2e/save-lineage";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("save diagnostics preserve rejection of a successful JSON null payload", async () => {
  const response = {
    text: async () => "null",
    ok: () => true,
    status: () => 200,
  } as unknown as Parameters<typeof classifySave>[0];
  await assert.rejects(classifySave(response), TypeError);
});

test("save diagnostics preserve empty successful response classification", async () => {
  const response = {
    text: async () => "",
    ok: () => true,
    status: () => 204,
  } as unknown as Parameters<typeof classifySave>[0];
  const result = await classifySave(response);
  assert.equal(result.outcome, "written");
  assert.equal(result.bodyState, "absent");
});

function bucket(): SaveLineageBucket {
  return { saveLineage: [], saveLineageDropped: 0 };
}

function saveRequest(attemptId = "save-attempt-secret") {
  const baseContent = "private authored base";
  const candidateContent = "private authored candidate marker B8";
  const editorSnapshot = "private editor snapshot";
  return JSON.stringify({
    id: "private-document-id",
    title: "private document title",
    content: candidateContent,
    authoredBaseContent: baseContent,
    authoredCandidateContent: candidateContent,
    editorSnapshotContent: editorSnapshot,
    editorSessionId: "private-editor-session",
    historySessionId: "private-history-session",
    browserSaveAttemptId: attemptId,
    editorEditGeneration: 7,
    baseRevision: `body:11:${sha256(baseContent)}`,
    authoredBaseRevision: `body:11:${sha256(baseContent)}`,
  });
}

test("save lineage hashes request identity and content without retaining raw fields", () => {
  const capture = new SaveLineageCapture({ now: () => 1_000 });
  const record = bucket();
  const entry = capture.captureRequest(record, saveRequest());

  assert.ok(entry);
  assert.equal(entry.bodyState, "valid");
  assert.equal(entry.documentIdHash.state, "valid");
  assert.equal(entry.browserSaveAttemptIdHash.state, "valid");
  assert.equal(entry.editorSessionIdHash.state, "valid");
  assert.equal(entry.historySessionIdHash.state, "valid");
  assert.deepEqual(entry.editorEditGeneration, { state: "valid", value: 7 });
  assert.deepEqual(entry.baseRevision, {
    state: "valid",
    value: { revision: 11, contentHash: sha256("private authored base") },
  });
  assert.deepEqual(entry.authoredBaseRevision, entry.baseRevision);

  const serialized = JSON.stringify(record);
  for (const raw of [
    "private-document-id",
    "private document title",
    "private authored base",
    "private authored candidate marker B8",
    "private editor snapshot",
    "private-editor-session",
    "private-history-session",
    "save-attempt-secret",
  ])
    assert.equal(serialized.includes(raw), false, `retained raw value: ${raw}`);
  assert.equal(entry.contentSha256.state, "valid");
  if (entry.contentSha256.state === "valid")
    assert.equal(
      entry.contentSha256.value,
      sha256("private authored candidate marker B8"),
    );
});

test("absent, malformed, and invalid request fields remain distinguishable", () => {
  const capture = new SaveLineageCapture({ now: () => 1_000 });
  const record = bucket();
  const absent = capture.captureRequest(record, null);
  const malformed = capture.captureRequest(record, "{");
  const invalidFields = capture.captureRequest(
    record,
    JSON.stringify({ id: 42, content: null, editorEditGeneration: -1 }),
  );

  assert.equal(absent?.bodyState, "absent");
  assert.deepEqual(absent?.documentIdHash, { state: "absent" });
  assert.equal(malformed?.bodyState, "invalid");
  assert.deepEqual(malformed?.documentIdHash, { state: "invalid" });
  assert.equal(invalidFields?.bodyState, "valid");
  assert.deepEqual(invalidFields?.documentIdHash, { state: "invalid" });
  assert.deepEqual(invalidFields?.contentSha256, { state: "invalid" });
  assert.deepEqual(invalidFields?.editorEditGeneration, { state: "invalid" });
  assert.deepEqual(invalidFields?.browserSaveAttemptIdHash, {
    state: "absent",
  });
});

test("response lineage correlates a matching retry receipt and readbacks in order", () => {
  let now = 5_000;
  const capture = new SaveLineageCapture({ now: () => now });
  const record = bucket();
  const request = capture.captureRequest(record, saveRequest());
  assert.ok(request);

  now += 10;
  const response = capture.beginResponse(request, 200);
  assert.equal(response.bodyState, "pending");
  const responseContent = "private canonical response body";
  const responseHash = sha256(responseContent);
  capture.finishResponse(request, response, "valid", {
    id: "private-document-id",
    content: responseContent,
    contentHash: responseHash,
    bodyRevision: 12,
    revision: `body:12:${responseHash}`,
    browserSaveAttempt: {
      attemptId: "save-attempt-secret",
      result: "replayed",
      revision: `body:12:${responseHash}`,
    },
    bodyIntentOutcome: { status: "applied" },
  });

  now += 10;
  const readback = capture.captureReadback(record, {
    checkpoint: "before-refresh",
    documentId: "private-document-id",
    content: responseContent,
    contentHash: responseHash,
    bodyRevision: 12,
    revision: `body:12:${responseHash}`,
    savesInFlight: 0,
    pendingRequestOrders: [],
  });

  assert.equal(response.bodyState, "valid");
  assert.deepEqual(response.status, 200);
  assert.deepEqual(response.bodyRevision, { state: "valid", value: 12 });
  assert.deepEqual(response.contentSha256, {
    state: "valid",
    value: responseHash,
  });
  assert.deepEqual(response.declaredContentHash, {
    state: "valid",
    value: responseHash,
  });
  assert.deepEqual(response.attemptResult, {
    state: "valid",
    value: "replayed",
  });
  assert.deepEqual(response.correlatedRequestGeneration, {
    state: "valid",
    value: 7,
  });
  assert.equal(readback?.kind, "readback");
  assert.ok(readback);
  assert.ok(request.order < response.order);
  assert.ok(response.order < readback.order);
  assert.ok(request.atMs <= response.atMs && response.atMs <= readback.atMs);

  const retry = capture.captureRequest(record, saveRequest());
  assert.equal(retry?.browserSaveAttemptIdHash.state, "valid");
  if (
    retry?.browserSaveAttemptIdHash.state === "valid" &&
    request.browserSaveAttemptIdHash.state === "valid"
  )
    assert.equal(
      retry.browserSaveAttemptIdHash.value,
      request.browserSaveAttemptIdHash.value,
    );

  const serialized = JSON.stringify(record);
  for (const raw of [
    "private-document-id",
    "private document title",
    "private canonical response body",
    "private-editor-session",
    "private-history-session",
    "save-attempt-secret",
  ])
    assert.equal(serialized.includes(raw), false, `retained raw value: ${raw}`);
});

test("unconfirmed and mismatched receipts do not correlate a request generation", () => {
  const capture = new SaveLineageCapture({ now: () => 1_000 });
  const record = bucket();
  const absentBodyRequest = capture.captureRequest(record, saveRequest());
  assert.ok(absentBodyRequest);
  const absentResponse = capture.beginResponse(absentBodyRequest, 204);
  capture.finishResponse(
    absentBodyRequest,
    absentResponse,
    "absent",
    undefined,
  );
  assert.deepEqual(absentResponse.correlatedRequestGeneration, {
    state: "absent",
  });

  const mismatchRequest = capture.captureRequest(record, saveRequest());
  assert.ok(mismatchRequest);
  const mismatchResponse = capture.beginResponse(mismatchRequest, 200);
  capture.finishResponse(mismatchRequest, mismatchResponse, "valid", {
    browserSaveAttempt: { attemptId: "different-attempt", result: "applied" },
  });
  assert.deepEqual(mismatchResponse.correlatedRequestGeneration, {
    state: "invalid",
  });

  const invalidRequest = capture.captureRequest(record, saveRequest());
  assert.ok(invalidRequest);
  const invalidResponse = capture.beginResponse(invalidRequest, 200);
  capture.finishResponse(invalidRequest, invalidResponse, "invalid", undefined);
  assert.equal(invalidResponse.bodyState, "invalid");
  assert.deepEqual(invalidResponse.correlatedRequestGeneration, {
    state: "invalid",
  });
});

test("capture is bounded across requests and readbacks", () => {
  const capture = new SaveLineageCapture({ limit: 2, now: () => 1_000 });
  const record = bucket();
  capture.captureRequest(record, saveRequest());
  capture.captureReadback(record, {
    checkpoint: "deadline",
    documentId: "private-document-id",
    content: "body",
    contentHash: sha256("body"),
    bodyRevision: 1,
    revision: `body:1:${sha256("body")}`,
    savesInFlight: 1,
    pendingRequestOrders: [1],
  });
  capture.captureRequest(record, saveRequest("third-attempt"));

  assert.equal(record.saveLineage.length, 2);
  assert.equal(record.saveLineageDropped, 1);
});

test("the 64-entry aggregate reserves slots for readback checkpoints", () => {
  const capture = new SaveLineageCapture({ limit: 100, now: () => 1_000 });
  const record = bucket();
  for (let index = 0; index < 60; index++)
    capture.captureRequest(record, saveRequest(`attempt-${index}`));
  for (let index = 0; index < 9; index++)
    capture.captureReadback(record, {
      checkpoint: "before-refresh",
      documentId: "private-document-id",
      content: "body",
      contentHash: sha256("body"),
      bodyRevision: 1,
      revision: `body:1:${sha256("body")}`,
      savesInFlight: 0,
      pendingRequestOrders: [],
    });

  assert.equal(record.saveLineage.length, 57);
  assert.equal(
    record.saveLineage.filter((event) => event.kind === "readback").length,
    1,
  );
  assert.equal(record.saveLineageDropped, 4);
});

test("repeated SQL reads replace their checkpoint with the actual latest read order", () => {
  let now = 1_000;
  const capture = new SaveLineageCapture({ now: () => now });
  const record = bucket();
  const input = {
    checkpoint: "deadline" as const,
    documentId: "fixture-document",
    content: "before",
    contentHash: sha256("before"),
    bodyRevision: 1,
    revision: `body:1:${sha256("before")}`,
    savesInFlight: 0,
    pendingRequestOrders: [],
  };
  const first = capture.captureReadback(record, input);
  now += 50;
  const request = capture.captureRequest(record, saveRequest());
  now += 50;
  const latest = capture.captureReadback(record, {
    ...input,
    content: "after",
  });
  assert.ok(first && request && latest);
  assert.ok(first.order < request.order && request.order < latest.order);
  assert.equal(
    record.saveLineage.filter((entry) => entry.kind === "readback").length,
    1,
  );
  assert.equal(record.saveLineage[0], latest);
  assert.equal(latest.atMs, 100);
  assert.deepEqual(latest.contentSha256, {
    state: "valid",
    value: sha256("after"),
  });
});
