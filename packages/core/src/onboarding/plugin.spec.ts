import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const appStateGetMock = vi.hoisted(() => vi.fn());
const appStatePutMock = vi.hoisted(() => vi.fn());

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../server/auth.js", () => ({
  DEV_MODE_USER_EMAIL: "local@localhost",
  getSession: (...args: any[]) => getSessionMock(...args),
}));

vi.mock("../application-state/store.js", () => ({
  appStateGet: (...args: any[]) => appStateGetMock(...args),
  appStatePut: (...args: any[]) => appStatePutMock(...args),
}));

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { createOnboardingPlugin } from "./plugin.js";
import {
  __resetOnboardingRegistry,
  registerOnboardingStep,
} from "./registry.js";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, pathname: string, method = "GET") {
  const url = `https://app.test${pathname}`;
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req: new Request(url, { method }),
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: {
          host: "app.test",
          "x-forwarded-proto": "https",
        },
      },
      res: {
        statusCode: 200,
        setHeader() {},
      },
    },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  const body = await next();
  return { body, status: event.res.status };
}

function registerRequestContextProbeStep() {
  registerOnboardingStep({
    id: "llm",
    order: 10,
    required: true,
    title: "Connect an AI engine",
    description: "Request-scoped credentials should be visible here.",
    methods: [],
    isComplete: () =>
      getRequestUserEmail() === "alice@example.com" &&
      getRequestOrgId() === "org-1",
  });
}

describe("onboarding plugin routes", () => {
  beforeEach(() => {
    __resetOnboardingRegistry();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "org-1",
    });
    appStateGetMock.mockResolvedValue(null);
    appStatePutMock.mockResolvedValue(undefined);
  });

  it("runs step completion resolvers inside the authenticated request context", async () => {
    registerRequestContextProbeStep();
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(nitroApp, "/_agent-native/onboarding/steps");

    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        id: "llm",
        complete: true,
      }),
    ]);
  });

  it("uses the same request context when reporting dismissed/allComplete state", async () => {
    registerRequestContextProbeStep();
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === "onboarding:dismissed" ? { dismissed: true } : null,
    );
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/dismissed",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      dismissed: true,
      allComplete: true,
    });
    expect(appStateGetMock).toHaveBeenCalledWith(
      "alice@example.com",
      "onboarding:dismissed",
    );
  });
});
