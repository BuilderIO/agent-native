import { H3 } from "h3";
import { describe, expect, it, vi } from "vitest";

// Report what the mounted route hands the handler instead of touching storage.
vi.mock("../application-state/handlers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../application-state/handlers.js")>();
  const seen = (event: { context?: Record<string, unknown> }) => ({
    anonymousOwner:
      typeof event.context?.[actual.APP_STATE_ANONYMOUS_OWNER_CONTEXT_KEY] ===
      "function",
  });
  return { ...actual, getStateMany: seen, getState: seen };
});

const { mountApplicationStateRoutes } = await import("./core-routes-plugin.js");

async function read(app: H3, path: string) {
  const response = await app.fetch(new Request(`http://example.test${path}`));
  return response.json();
}

describe("mountApplicationStateRoutes anonymous owner", () => {
  it("hands the app's anonymous owner to the handlers when given one", async () => {
    const app = new H3();
    mountApplicationStateRoutes({}, "/_agent-native", app as never, {
      anonymousOwner: () => "anon@example.test",
    });

    await expect(
      read(app, "/_agent-native/application-state?keys=navigation"),
    ).resolves.toEqual({ anonymousOwner: true });
  });

  it("leaves the handlers without one by default", async () => {
    const app = new H3();
    mountApplicationStateRoutes({}, "/_agent-native", app as never);

    await expect(
      read(app, "/_agent-native/application-state?keys=navigation"),
    ).resolves.toEqual({ anonymousOwner: false });
  });
});
