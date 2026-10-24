import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ og: 0, recap: 0 }));
const served = vi.hoisted(() => [] as Array<[string, unknown]>);
const failLoads = vi.hoisted(() => ({ og: 0 }));

vi.mock("./social-og-image.js", () => {
  loads.og += 1;
  return {
    createAgentNativeOgImageHandler: () => {
      if (failLoads.og > 0) {
        failLoads.og -= 1;
        throw new Error("og image failed to load");
      }
      return (event: unknown) => {
        served.push(["og", event]);
        return "og image";
      };
    },
  };
});

vi.mock("./recap-image-route.js", () => {
  loads.recap += 1;
  return {
    createRecapImageHandler: () => (event: unknown) => {
      served.push(["recap", event]);
      return "recap image";
    },
  };
});

import { mountImageRoutes } from "./core-routes-plugin.js";
import type { H3AppShim } from "./framework-request-handler.js";

function mount() {
  const routes = new Map<string, (event: H3Event) => unknown>();
  const app = {
    use(path: string, handler: (event: H3Event) => unknown) {
      routes.set(path, handler);
    },
  } as H3AppShim;
  mountImageRoutes(app, "/_agent-native");
  return routes;
}

describe("mountImageRoutes", () => {
  it("loads each image module on its route's first request, once across concurrent requests", async () => {
    const routes = mount();

    expect([...routes.keys()]).toEqual([
      "/_agent-native/og-image.png",
      "/_agent-native/recap-image",
    ]);
    expect(loads).toEqual({ og: 0, recap: 0 });

    const first = { id: 1 } as unknown as H3Event;
    const second = { id: 2 } as unknown as H3Event;
    const og = routes.get("/_agent-native/og-image.png")!;

    expect(await Promise.all([og(first), og(second)])).toEqual([
      "og image",
      "og image",
    ]);
    expect(loads).toEqual({ og: 1, recap: 0 });

    expect(await routes.get("/_agent-native/recap-image")!(first)).toBe(
      "recap image",
    );
    expect(await og(second)).toBe("og image");
    expect(loads).toEqual({ og: 1, recap: 1 });
    expect(served).toEqual([
      ["og", first],
      ["og", second],
      ["recap", first],
      ["og", second],
    ]);
  });

  it("fails a request whose image handler fails to load, and loads it again on the next request", async () => {
    failLoads.og = 1;
    served.length = 0;
    const og = mount().get("/_agent-native/og-image.png")!;
    const event = { id: 3 } as unknown as H3Event;

    await expect(og(event)).rejects.toThrow("og image failed to load");
    expect(await og(event)).toBe("og image");
    expect(served).toEqual([["og", event]]);
  });
});
