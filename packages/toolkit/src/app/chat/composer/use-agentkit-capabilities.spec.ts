import { describe, expect, it } from "vitest";

import { agentKitCapabilityQueryKey } from "./use-agentkit-capabilities.js";

describe("AgentKit capability cache scope", () => {
  const session = { email: "member@example.test", orgId: "team-1" };

  it("separates app, account, and organization caches", () => {
    const key = agentKitCapabilityQueryKey("/design", session);
    expect(agentKitCapabilityQueryKey("/slides", session)).not.toEqual(key);
    expect(
      agentKitCapabilityQueryKey("/design", { ...session, orgId: "team-2" }),
    ).not.toEqual(key);
    expect(
      agentKitCapabilityQueryKey("/design", {
        ...session,
        email: "other@example.test",
      }),
    ).not.toEqual(key);
    expect(agentKitCapabilityQueryKey("/design", null)).not.toEqual(key);
  });

  it("normalizes email without merging personal and organization scope", () => {
    expect(
      agentKitCapabilityQueryKey("/design", {
        ...session,
        email: " MEMBER@example.test ",
      }),
    ).toEqual(agentKitCapabilityQueryKey("/design", session));
    expect(
      agentKitCapabilityQueryKey("/design", { email: session.email }),
    ).not.toEqual(agentKitCapabilityQueryKey("/design", session));
  });

  it("separates canonical accounts even when they share an email", () => {
    expect(
      agentKitCapabilityQueryKey("/design", { ...session, authUserId: "one" }),
    ).not.toEqual(
      agentKitCapabilityQueryKey("/design", { ...session, authUserId: "two" }),
    );
  });
});
