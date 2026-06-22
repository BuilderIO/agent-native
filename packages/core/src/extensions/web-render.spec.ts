import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePageRenderer } from "./web-render.js";

describe("resolvePageRenderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns null when no backend is configured", async () => {
    const renderer = await resolvePageRenderer({
      resolveSecret: vi.fn().mockResolvedValue(null),
    });
    expect(renderer).toBeNull();
  });

  it("resolves the Firecrawl backend when FIRECRAWL_API_KEY is present", async () => {
    const renderer = await resolvePageRenderer({
      resolveSecret: vi.fn(async (key: string) =>
        key === "FIRECRAWL_API_KEY" ? "fc-key" : null,
      ),
    });
    expect(renderer?.id).toBe("firecrawl");
  });

  it("honors the resolveSecret policy and does not fall back to env when a resolver is wired", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "env-fc-key");
    const renderer = await resolvePageRenderer({
      resolveSecret: vi.fn().mockResolvedValue(null),
    });
    expect(renderer).toBeNull();
  });

  it("renders HTML and preserves a body-safe upstream status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            html: "<html><body><p>hi</p></body></html>",
            metadata: { statusCode: 203 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const renderer = await resolvePageRenderer({
      resolveSecret: vi.fn(async () => "fc-key"),
    });
    const page = await renderer!.render("https://example.com/spa", {
      timeoutMs: 15_000,
    });
    expect(page.rendererId).toBe("firecrawl");
    expect(page.status).toBe(203);
    expect(page.html).toContain("<p>hi</p>");
  });
});
