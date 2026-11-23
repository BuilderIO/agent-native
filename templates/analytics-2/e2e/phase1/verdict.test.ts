import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

import type { BuildObservation } from "../build-boundary.js";
import { Evidence, evaluateFlow, MissingCapability } from "./verdict.js";

const candidate = "a".repeat(40);
const different = "b".repeat(40);
const fixture = await readFile(
  new URL("./fixtures/negative-control.html", import.meta.url),
  "utf8",
);

function surface({ omitTransition = false, suppressWrite = false } = {}) {
  let storedTitle = "Original title";
  const status = { textContent: "" };
  const title = {
    value: fixture.match(/<input id="title" value="([^"]+)"/)?.[1],
  };
  const save: { onclick?: () => Promise<void> } = {};
  const elements = { title, status, save };
  const script = fixture.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);
  runInNewContext(script, {
    URLSearchParams,
    location: { search: omitTransition ? "?omitTransition=1" : "" },
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    fetch: async (path: string, options: { body: string }) => {
      assert.equal(path, "/_agent-native/actions/fixture-write");
      if (!suppressWrite) storedTitle = JSON.parse(options.body).title;
      return Response.json({ status: "accepted" });
    },
  });
  const read = () =>
    Response.json({ project: { id: "fixture-1", title: storedTitle } });
  return { save, title, status, read };
}

function observeSequence(...shas: string[]) {
  const observed: string[] = [];
  return {
    observed,
    observe: async (): Promise<BuildObservation> => {
      const sha = shas[observed.length];
      assert.ok(sha, "exactly two build probes");
      observed.push(sha);
      return { kind: "read", sha };
    },
  };
}

async function runFixture(
  options: Parameters<typeof surface>[0] = {},
  before = candidate,
  after = candidate,
) {
  const state = surface(options);
  const evidence = new Evidence();
  const boundary = observeSequence(before, after);
  let started = false;
  const row = await evaluateFlow({
    expectedSha: candidate,
    observe: boundary.observe,
    evidence,
    run: async () => {
      started = true;
      await evidence.step(
        "Save acknowledges the edit",
        async () => {
          assert.ok(state.save.onclick);
          await state.save.onclick();
          assert.equal(state.status.textContent, "Saved");
        },
        "transition",
      );
      await evidence.step(
        "Exact default and Save copy",
        async () => {
          assert.equal(state.title.value, "Phase 1 fixture");
          assert.match(fixture, />Save<\/button>/);
        },
        "oracle",
      );
      await evidence.step(
        "Independent stored project read",
        async () => {
          const response = state.read();
          evidence.actions.push({
            name: "fixture-read",
            actor: "owner",
            method: "GET",
            status: response.status,
            elapsedMs: 0,
          });
          assert.deepEqual(await response.json(), {
            project: { id: "fixture-1", title: "Phase 1 fixture" },
          });
        },
        "readback",
      );
      await evidence.step(
        "A wrong title is rejected by the checker",
        async () => {
          assert.notEqual(
            (await state.read().json()).project.title,
            "Wrong title",
          );
        },
        "rejecting",
      );
      await evidence.step(
        "Cold page takes the title from storage",
        async () => {
          const cold = surface();
          cold.title.value = (await state.read().json()).project.title;
          assert.equal(cold.title.value, "Phase 1 fixture");
        },
        "cold",
      );
      evidence.ids.projectId = "fixture-1";
      evidence.screenshots.push("fixture.png");
    },
  });
  return { row, started, state, observed: boundary.observed };
}

it("accepts the complete positive control on the pinned build", async () => {
  const { row } = await runFixture();
  assert.equal(row.verdict, "PASS");
});

it("fails a suppressed database write after optimistic success", async () => {
  const { row, state } = await runFixture({ suppressWrite: true });
  assert.equal(state.status.textContent, "Saved");
  assert.equal(row.verdict, "FAIL");
  assert.ok(
    row.steps.some(
      (step) => step.proof === "readback" && step.status === "failed",
    ),
  );
});

it("fails a missing mounted transition", async () => {
  const { row } = await runFixture({ omitTransition: true });
  assert.equal(row.verdict, "FAIL");
  assert.ok(
    row.steps.some(
      (step) => step.proof === "transition" && step.status === "failed",
    ),
  );
});

it("does not start a flow on a stable wrong SHA and still records both probes", async () => {
  const { row, started, observed } = await runFixture({}, different, different);
  assert.equal(started, false);
  assert.deepEqual(observed, [different, different]);
  assert.equal(row.verdict, "COULD-NOT-RUN");
  assert.match(row.reason, /^Before flow: build SHA mismatch/);
});

it("marks mid-flow drift inconclusive and retains the original outcome", async () => {
  const positive = await runFixture({}, candidate, different);
  assert.equal(positive.row.verdict, "COULD-NOT-RUN");
  assert.equal(positive.row.observed.verdict, "PASS");
  const negative = await runFixture(
    { suppressWrite: true },
    candidate,
    different,
  );
  assert.equal(negative.row.verdict, "COULD-NOT-RUN");
  assert.equal(negative.row.observed.verdict, "FAIL");
  assert.match(negative.row.reason, /^After flow: build SHA mismatch/);
});

it("fails incomplete evidence and records the exact missing capability reason", async () => {
  const before = observeSequence(candidate, candidate);
  const incomplete = await evaluateFlow({
    expectedSha: candidate,
    observe: before.observe,
    run: async () => undefined,
    evidence: new Evidence(),
  });
  assert.equal(incomplete.verdict, "FAIL");
  assert.match(incomplete.reason, /Incomplete evidence.*cold/);
  const missing = await evaluateFlow({
    expectedSha: candidate,
    observe: observeSequence(candidate, candidate).observe,
    evidence: new Evidence(),
    run: async () => {
      throw new MissingCapability("published scheduler");
    },
  });
  assert.equal(missing.verdict, "FAIL");
  assert.equal(missing.reason, "not implemented");
  assert.equal(missing.observed.capability, "published scheduler");
});
