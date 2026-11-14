import { describe, expect, it, afterEach } from "vitest";

import { clientBuildId } from "./build-compatibility.js";

/**
 * The per-app upload-reuse contract (hosting/per-app-build-id-plan-0355.md): a client
 * bundle no longer bakes the commit, so `clientBuildId()` must answer from the document's
 * runtime stamp. Vitest compiles this file without the app build's `define`, which is
 * exactly the shape a client chunk now has — so these cases exercise the shipped path.
 */
const KEY = "__AGENT_NATIVE_BUILD_ID__";
const globals = globalThis as typeof globalThis & { [KEY]?: string };

afterEach(() => {
  delete globals[KEY];
});

describe("clientBuildId without a baked build id", () => {
  it("answers from the document stamp the server writes into <head>", () => {
    globals[KEY] = "a".repeat(40);
    expect(clientBuildId()).toBe("a".repeat(40));
  });

  it("answers empty — never the string 'undefined' — when no stamp ran", () => {
    expect(clientBuildId()).toBe("");
  });
});
