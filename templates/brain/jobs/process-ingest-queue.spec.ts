import { describe, expect, it } from "vitest";

import {
  DISTILLATION_ACTION_ALLOWLIST,
  pickDistillationActions,
} from "./process-ingest-queue.js";

describe("distillation action allowlist", () => {
  it("does not offer provider, settings or source-deletion actions", () => {
    const all: Record<string, { name: string }> = {};
    for (const name of [
      ...DISTILLATION_ACTION_ALLOWLIST,
      "provider-api-request",
      "set-settings",
      "delete-source",
    ]) {
      all[name] = { name };
    }
    const picked = pickDistillationActions(all);
    expect(Object.keys(picked).sort()).toEqual(
      [...DISTILLATION_ACTION_ALLOWLIST].sort(),
    );
    expect(picked).not.toHaveProperty("provider-api-request");
    expect(picked).not.toHaveProperty("set-settings");
    expect(picked).not.toHaveProperty("delete-source");
  });

  it("keeps the actions the distiller prompt relies on", () => {
    const picked = pickDistillationActions({
      "get-capture": 1,
      "write-intelligence": 1,
      "mark-capture-distilled": 1,
    });
    expect(Object.keys(picked).sort()).toEqual([
      "get-capture",
      "mark-capture-distilled",
      "write-intelligence",
    ]);
  });
});
