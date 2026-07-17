import { describe, expect, it } from "vitest";

import { authorizeWorkflowDrain } from "./drain-auth.js";

describe("workflow drain authorization", () => {
  it("trusts the generated scheduled-function runtime marker", async () => {
    await expect(
      authorizeWorkflowDrain({ scheduledRuntime: true }),
    ).resolves.toBe("authorized");
  });

  it("fails closed when a portable scheduler secret is not configured", async () => {
    await expect(
      authorizeWorkflowDrain({ scheduledRuntime: false }),
    ).resolves.toBe("unconfigured");
  });

  it("accepts only the exact configured bearer value", async () => {
    await expect(
      authorizeWorkflowDrain({
        scheduledRuntime: false,
        configuredSecret: "drain-secret",
        authorization: "Bearer drain-secret",
      }),
    ).resolves.toBe("authorized");
    await expect(
      authorizeWorkflowDrain({
        scheduledRuntime: false,
        configuredSecret: "drain-secret",
        authorization: "Bearer wrong",
      }),
    ).resolves.toBe("unauthorized");
  });
});
