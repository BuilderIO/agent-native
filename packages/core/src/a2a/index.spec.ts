import { afterEach, describe, expect, it } from "vitest";

import { clearA2AActionCallHooksForTests } from "./call-hooks.js";
import { runAsA2AForegroundCall } from "./foreground-call-scope.js";
import {
  A2A_CALL_REFUSED_KIND,
  A2ACallHookError,
  A2ACallRefusedError,
  isA2AForegroundCall,
  listA2AActionCallHooks,
  registerA2AActionCallHook,
} from "./index.js";

describe("a2a entry point call hooks", () => {
  afterEach(() => clearA2AActionCallHooksForTests());

  it("registers and removes action call hooks", () => {
    const hook = { id: "entry-point-hook" };
    const unregister = registerA2AActionCallHook(hook);
    expect(listA2AActionCallHooks()).toEqual([hook]);
    unregister();
    expect(listA2AActionCallHooks()).toEqual([]);
  });

  it("exposes the refusal kind and typed call errors", () => {
    expect(A2A_CALL_REFUSED_KIND).toBe("agent-native/a2a-call-refused");
    const refused = new A2ACallRefusedError("no", {
      code: 403,
      hookId: "gate",
      reason: "quota",
    });
    expect(refused).toMatchObject({
      name: "A2ACallRefusedError",
      code: 403,
      hookId: "gate",
      reason: "quota",
    });
    const hookError = new A2ACallHookError("gate", "threw");
    expect(hookError.message).toBe('A2A call hook "gate": threw');
    expect(hookError.hookId).toBe("gate");
  });

  it("reports foreground admission only inside an admitted call", async () => {
    expect(isA2AForegroundCall()).toBe(false);
    const inside = await runAsA2AForegroundCall(Date.now() + 60_000, async () =>
      isA2AForegroundCall(),
    );
    expect(inside).toBe(true);
    expect(isA2AForegroundCall()).toBe(false);
  });
});
