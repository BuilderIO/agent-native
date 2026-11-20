import { describe, expect, it } from "vitest";

import { reviewActorKindFromContext, reviewReactionActor } from "./identity.js";

const EMAIL = "person@example.com";

describe("reviewActorKindFromContext", () => {
  it("counts the agent and its tools as the agent", () => {
    expect(
      reviewActorKindFromContext({ caller: "agent", userEmail: EMAIL }),
    ).toBe("agent");
    expect(reviewActorKindFromContext({ caller: "tool" })).toBe("agent");
    expect(
      reviewActorKindFromContext({ caller: "mcp", userEmail: EMAIL }),
    ).toBe("agent");
    expect(
      reviewActorKindFromContext({ caller: "webmcp", userEmail: EMAIL }),
    ).toBe("agent");
    expect(
      reviewActorKindFromContext({ caller: "a2a", userEmail: EMAIL }),
    ).toBe("agent");
  });

  it("counts any other signed-in caller as a person", () => {
    expect(
      reviewActorKindFromContext({ caller: "frontend", userEmail: EMAIL }),
    ).toBe("human");
    expect(reviewActorKindFromContext({ userEmail: EMAIL })).toBe("human");
    expect(
      reviewActorKindFromContext({ caller: 7 as never, userEmail: EMAIL }),
    ).toBe("human");
  });

  it("counts a caller with no one signed in as the system", () => {
    expect(reviewActorKindFromContext({ caller: "frontend" })).toBe("system");
    expect(reviewActorKindFromContext({ userEmail: "" })).toBe("system");
    expect(reviewActorKindFromContext(undefined)).toBe("system");
  });
});

describe("reviewReactionActor", () => {
  it("is the person's email, trimmed and in lower case", () => {
    expect(
      reviewReactionActor({
        caller: "frontend",
        userEmail: " Person@Example.COM ",
      }),
    ).toBe(EMAIL);
    expect(reviewReactionActor({ userEmail: EMAIL })).toBe(EMAIL);
  });

  it("keeps the agent's reactions apart from the person it works for", () => {
    expect(
      reviewReactionActor({ caller: "tool", userEmail: "Person@Example.com" }),
    ).toBe(`agent:${EMAIL}`);
    expect(reviewReactionActor({ caller: "agent", userEmail: EMAIL })).toBe(
      `agent:${EMAIL}`,
    );
    expect(reviewReactionActor({ caller: "mcp", userEmail: EMAIL })).toBe(
      `agent:${EMAIL}`,
    );
    expect(reviewReactionActor({ caller: "a2a", userEmail: EMAIL })).toBe(
      `agent:${EMAIL}`,
    );
  });

  it("is no one without a signed-in email", () => {
    expect(reviewReactionActor({ caller: "frontend" })).toBeNull();
    expect(
      reviewReactionActor({ caller: "tool", userEmail: "   " }),
    ).toBeNull();
    expect(reviewReactionActor({ userEmail: null })).toBeNull();
    expect(reviewReactionActor(undefined)).toBeNull();
  });
});
