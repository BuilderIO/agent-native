import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devTagFromEmail, dispatchArgs, resolveDevTag } from "./release-dev.ts";

describe("devTagFromEmail", () => {
  it("uses the local part of the address", () => {
    assert.equal(devTagFromEmail("sami@builder.io"), "sami");
    assert.equal(devTagFromEmail("Sami@Builder.io"), "sami");
  });

  it("replaces characters npm dist-tags cannot carry", () => {
    assert.equal(devTagFromEmail("sami.jaber@builder.io"), "sami-jaber");
    assert.equal(devTagFromEmail("sami+test@builder.io"), "sami-test");
    assert.equal(devTagFromEmail("_sami_@builder.io"), "sami");
  });

  it("returns null when nothing usable remains", () => {
    assert.equal(devTagFromEmail(""), null);
    assert.equal(devTagFromEmail("___@builder.io"), null);
  });
});

describe("resolveDevTag", () => {
  it("prefers an explicit tag over the git email", () => {
    assert.equal(resolveDevTag("feature-42", "sami@builder.io"), "feature-42");
  });

  it("falls back to the git email when no tag is passed", () => {
    assert.equal(resolveDevTag(undefined, "sami@builder.io"), "sami");
    assert.equal(resolveDevTag("  ", "sami@builder.io"), "sami");
  });

  it("rejects a reserved tag from either source", () => {
    assert.throws(() => resolveDevTag("latest", "sami@builder.io"), /reserved/);
    assert.throws(
      () => resolveDevTag(undefined, "beta@builder.io"),
      /reserved/,
    );
  });

  it("explains itself when no tag can be derived", () => {
    assert.throws(
      () => resolveDevTag(undefined, ""),
      /Pass one explicitly: pnpm release-dev <tag>/,
    );
  });
});

describe("dispatchArgs", () => {
  it("targets the pushed branch with the dev tag input", () => {
    assert.deepEqual(dispatchArgs("my-branch", "sami"), [
      "workflow",
      "run",
      "auto-publish.yml",
      "--ref",
      "my-branch",
      "-f",
      "devTag=sami",
    ]);
  });
});
