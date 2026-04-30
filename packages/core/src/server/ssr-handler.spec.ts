import { afterEach, describe, expect, it, vi } from "vitest";
import { createH3SSRHandler } from "./ssr-handler.js";

const mocks = vi.hoisted(() => {
  const requestHandler = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    return new Response(`${request.method} ${url.pathname}${url.search}`, {
      headers: { "x-rr-path": url.pathname },
    });
  });
  return { requestHandler };
});

vi.mock("react-router", () => ({
  createRequestHandler: vi.fn(() => mocks.requestHandler),
}));

function createEvent(pathname: string, method = "GET") {
  return {
    url: new URL(`http://example.test${pathname}`),
    req: new Request(`http://example.test${pathname}`, { method }),
  };
}

describe("createH3SSRHandler", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    mocks.requestHandler.mockClear();
  });

  it("strips APP_BASE_PATH before handing requests to React Router", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/mail/inbox?view=unread"));

    await expect(response.text()).resolves.toBe("GET /inbox?view=unread");
    expect(mocks.requestHandler).toHaveBeenCalledTimes(1);
  });

  it("preserves HEAD semantics under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/calendar";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/calendar/settings", "HEAD"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-rr-path")).toBe("/settings");
    await expect(response.text()).resolves.toBe("");
    expect(mocks.requestHandler).toHaveBeenCalledTimes(1);
  });

  it("does not SSR framework routes under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/mail/_agent-native/env-status"),
    );

    expect(response.status).toBe(404);
    expect(mocks.requestHandler).not.toHaveBeenCalled();
  });
});
