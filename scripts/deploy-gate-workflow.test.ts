import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

type Workflow = Record<string, unknown>;

const publish = parse(
  readFileSync(".github/workflows/auto-publish.yml", "utf8"),
) as Workflow;
const jobs = publish.jobs as Record<string, Workflow>;

interface Scenario {
  event: "push" | "workflow_dispatch" | "schedule";
  verifier: "success" | "skipped" | "failure";
  verified?: "true" | "false";
  gate: "success" | "skipped" | "failure" | "cancelled";
  devTag?: string;
  redispatchDownstream?: boolean;
}

// Evaluates the `release` condition for one trigger. The condition uses only
// comparisons, `!`, `&&`, `||`, and `!cancelled()`, so it translates to the
// same JavaScript expression; GitHub treats an empty or absent input as false.
function releaseRuns(scenario: Scenario): boolean {
  const expression = String(jobs.release!.if)
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/!cancelled\(\)/g, "true")
    .replace(/needs\.verify-stable-merge\.outputs\.verified/g, "ctx.verified")
    .replace(/needs\.verify-stable-merge\.result/g, "ctx.verifier")
    .replace(/needs\.deploy-gate\.result/g, "ctx.gate")
    .replace(/github\.event_name/g, "ctx.event")
    .replace(/inputs\.redispatchDownstream/g, "ctx.redispatchDownstream")
    .replace(/inputs\.devTag/g, "ctx.devTag");
  assert.doesNotMatch(
    expression,
    /\b(needs|github|inputs)\./,
    `The release condition uses something this test does not model: ${expression}`,
  );
  const ctx = {
    verified: "true",
    redispatchDownstream: false,
    devTag: "",
    ...scenario,
  };
  return Boolean(new Function("ctx", `return ${expression};`)(ctx));
}

describe("the release gate in the publish workflow", () => {
  const gate = jobs["deploy-gate"]!;
  const release = jobs.release!;

  it("runs the documented deploy paths on the checkout being published", () => {
    assert.equal(gate.uses, "./.github/workflows/deploy-paths.yml");
    assert.deepEqual(gate.with, { source: "local" });
    assert.deepEqual(gate.needs, ["verify-stable-merge"]);
  });

  it("gates only the publishing push, never the dispatch that opens the Version Packages PR", () => {
    assert.match(String(gate.if), /github\.event_name == 'push'/);
    assert.match(
      String(gate.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
  });

  it("makes the stable upload wait for the gate", () => {
    assert.deepEqual(release.needs, ["verify-stable-merge", "deploy-gate"]);
  });

  // GitHub skips a job whose need was skipped unless its condition has a status
  // function. The scenarios below cannot model that implicit success(), so
  // without this the dispatch that opens the Version Packages PR would pass
  // here and be skipped for real.
  it("opts out of the implicit success() so a skipped gate cannot skip the dispatch", () => {
    assert.match(String(release.if), /!cancelled\(\)/);
  });

  describe("publishing a stable release (a verified push)", () => {
    const push: Scenario = {
      event: "push",
      verifier: "success",
      gate: "success",
    };

    it("uploads when the gate passed", () => {
      assert.equal(releaseRuns(push), true);
    });

    it("uploads nothing when the gate failed, was cancelled, or never ran", () => {
      for (const gate of ["failure", "cancelled", "skipped"] as const) {
        assert.equal(releaseRuns({ ...push, gate }), false, `gate ${gate}`);
      }
    });

    it("uploads nothing when the merge could not be verified", () => {
      assert.equal(releaseRuns({ ...push, verified: "false" }), false);
      assert.equal(releaseRuns({ ...push, verifier: "failure" }), false);
    });
  });

  describe("everything that is not a publishing push", () => {
    it("still opens the Version Packages PR on a manual dispatch, though the gate is skipped", () => {
      assert.equal(
        releaseRuns({
          event: "workflow_dispatch",
          verifier: "success",
          gate: "skipped",
        }),
        true,
      );
    });

    it("stays skipped for an ordinary push, where the verifier is skipped", () => {
      assert.equal(
        releaseRuns({ event: "push", verifier: "skipped", gate: "skipped" }),
        false,
      );
    });

    it("stays skipped for the nightly schedule", () => {
      assert.equal(
        releaseRuns({
          event: "schedule",
          verifier: "skipped",
          gate: "skipped",
        }),
        false,
      );
    });

    it("stays skipped for a dev snapshot or a downstream-only redispatch", () => {
      const dispatch: Scenario = {
        event: "workflow_dispatch",
        verifier: "success",
        gate: "skipped",
      };
      assert.equal(releaseRuns({ ...dispatch, devTag: "try-it" }), false);
      assert.equal(
        releaseRuns({ ...dispatch, redispatchDownstream: true }),
        false,
      );
    });
  });
});
