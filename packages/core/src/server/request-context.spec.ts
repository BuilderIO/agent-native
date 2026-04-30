import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runWithRequestContext,
  getRequestUserEmail,
  getRequestOrgId,
  getRequestTimezone,
  getRequestContext,
  hasRequestContext,
} from "./request-context.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("server/request-context", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getRequestUserEmail", () => {
    it("returns the per-request userEmail when a context is set", () => {
      runWithRequestContext({ userEmail: "alice@example.com" }, () => {
        expect(getRequestUserEmail()).toBe("alice@example.com");
      });
    });

    it("falls back to AGENT_USER_EMAIL env only when NO request context is active (CLI scripts)", () => {
      vi.stubEnv("AGENT_USER_EMAIL", "cli@example.com");
      expect(getRequestUserEmail()).toBe("cli@example.com");
    });

    it("does NOT leak AGENT_USER_EMAIL into a request context that explicitly has no userEmail", () => {
      // Reproduces the A2A unsigned/api-key path: the request context is set
      // (so we're inside an HTTP request), but the caller is not user-
      // authenticated. Returning the env var here would let a previous
      // request's identity leak into the unauthenticated call on a warm
      // serverless instance.
      vi.stubEnv("AGENT_USER_EMAIL", "leaked@previous-request.com");
      runWithRequestContext({}, () => {
        expect(getRequestUserEmail()).toBeUndefined();
      });
    });

    it("returns undefined when context.userEmail is explicitly undefined, even with env set", () => {
      vi.stubEnv("AGENT_USER_EMAIL", "leaked@example.com");
      runWithRequestContext({ userEmail: undefined }, () => {
        expect(getRequestUserEmail()).toBeUndefined();
      });
    });
  });

  describe("getRequestOrgId", () => {
    it("returns the per-request orgId when a context is set", () => {
      runWithRequestContext({ orgId: "org-123" }, () => {
        expect(getRequestOrgId()).toBe("org-123");
      });
    });

    it("falls back to AGENT_ORG_ID only when no request context is active", () => {
      vi.stubEnv("AGENT_ORG_ID", "cli-org");
      expect(getRequestOrgId()).toBe("cli-org");
    });

    it("does NOT leak AGENT_ORG_ID into a request context that explicitly has no orgId", () => {
      vi.stubEnv("AGENT_ORG_ID", "leaked-org");
      runWithRequestContext({ userEmail: "alice@example.com" }, () => {
        expect(getRequestOrgId()).toBeUndefined();
      });
    });
  });

  describe("getRequestTimezone", () => {
    it("returns the per-request timezone when a context is set", () => {
      runWithRequestContext({ timezone: "America/Los_Angeles" }, () => {
        expect(getRequestTimezone()).toBe("America/Los_Angeles");
      });
    });

    it("falls back to AGENT_USER_TIMEZONE only when no request context is active", () => {
      vi.stubEnv("AGENT_USER_TIMEZONE", "Europe/London");
      expect(getRequestTimezone()).toBe("Europe/London");
    });

    it("does NOT leak AGENT_USER_TIMEZONE into a request context with no timezone", () => {
      vi.stubEnv("AGENT_USER_TIMEZONE", "Europe/London");
      runWithRequestContext({ userEmail: "alice@example.com" }, () => {
        expect(getRequestTimezone()).toBeUndefined();
      });
    });
  });

  describe("request isolation", () => {
    it("keeps concurrent async request contexts isolated", async () => {
      const [alice, bob] = await Promise.all([
        runWithRequestContext(
          {
            userEmail: "alice@example.com",
            orgId: "org-a",
            timezone: "America/New_York",
          },
          async () => {
            await delay(10);
            return {
              userEmail: getRequestUserEmail(),
              orgId: getRequestOrgId(),
              timezone: getRequestTimezone(),
            };
          },
        ),
        runWithRequestContext(
          {
            userEmail: "bob@example.com",
            orgId: "org-b",
            timezone: "America/Los_Angeles",
          },
          async () => {
            await delay(1);
            return {
              userEmail: getRequestUserEmail(),
              orgId: getRequestOrgId(),
              timezone: getRequestTimezone(),
            };
          },
        ),
      ]);

      expect(alice).toEqual({
        userEmail: "alice@example.com",
        orgId: "org-a",
        timezone: "America/New_York",
      });
      expect(bob).toEqual({
        userEmail: "bob@example.com",
        orgId: "org-b",
        timezone: "America/Los_Angeles",
      });
    });

    it("reports active context without falling back to env values", () => {
      vi.stubEnv("AGENT_USER_EMAIL", "cli@example.com");

      expect(hasRequestContext()).toBe(false);
      expect(getRequestContext()).toBeUndefined();

      runWithRequestContext({}, () => {
        expect(hasRequestContext()).toBe(true);
        expect(getRequestContext()).toEqual({});
        expect(getRequestUserEmail()).toBeUndefined();
      });
    });

    it("shares context across duplicate module instances", async () => {
      const duplicate = await import("./request-context.js?duplicate");

      runWithRequestContext(
        {
          userEmail: "alice@example.com",
          orgId: "org-a",
          timezone: "America/New_York",
        },
        () => {
          expect(duplicate.getRequestUserEmail()).toBe("alice@example.com");
          expect(duplicate.getRequestOrgId()).toBe("org-a");
          expect(duplicate.getRequestTimezone()).toBe("America/New_York");
        },
      );
    });
  });
});
