import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueWebhookEvent: vi.fn(async () => []),
  dispatchWebhookDeliveries: vi.fn(async () => undefined),
  resolveAccess: vi.fn(async () => null),
}));

const table = vi.hoisted(() => ({ id: "deck.id" }));
const db = {
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  transaction: async (run: (tx: typeof db) => unknown) => run(db),
};

vi.mock("h3", () => ({
  createError: (options: any) =>
    Object.assign(new Error(options?.statusMessage), options),
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  getQuery: (event: any) => event._query ?? {},
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestURL: (event: any) =>
    new URL(
      event.req?.url ?? "http://app.test/_agent-native/actions/save-deck",
    ),
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  setResponseHeader: vi.fn(),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => null,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }));
vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: { decks: table },
}));
vi.mock("../server/handlers/decks.js", () => ({ notifyClients: vi.fn() }));
vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: vi.fn(),
}));
vi.mock("../server/lib/outbound-webhooks.js", () => ({
  enqueueWebhookEvent: (...args: unknown[]) =>
    mocks.enqueueWebhookEvent(...args),
  dispatchWebhookDeliveries: (...args: unknown[]) =>
    mocks.dispatchWebhookDeliveries(...args),
}));
vi.mock("../shared/deck-title.js", () => ({
  assertHumanReadableDeckTitle: vi.fn(),
  repairGeneratedDeckTitle: (title: string) => title,
}));
vi.mock("../shared/slide-ids.js", () => ({
  ensureUniqueSlideIds: (slides: unknown[]) => ({
    slides,
    changed: false,
    originalIds: [],
  }),
  repairDeckSlideReferences: vi.fn(),
}));
vi.mock("./_app-url.js", () => ({
  getDeckAppUrl: (id: string) => `/deck/${id}`,
}));
vi.mock("./_deck-write.js", () => ({
  assertDesignSystemReadable: vi.fn(),
  assertValidAspectRatio: vi.fn(),
  deckDesignSystemId: () => null,
  deckHttpError: (status: number, message: string) =>
    Object.assign(new Error(message), { statusCode: status }),
  deckTitle: (deck: { title?: string }) => deck.title ?? "Untitled",
}));
vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_id: string, run: () => unknown) => run(),
}));
vi.mock(
  "../../../packages/core/src/server/framework-request-handler.js",
  () => ({ getH3App: (app: unknown) => app }),
);
vi.mock("../../../packages/core/src/server/action-change.js", () => ({
  actionCallIsReadOnly: (
    _entry: unknown,
    _params: unknown,
    fallback: boolean,
  ) => fallback,
  notifyActionChange: vi.fn(),
}));
vi.mock("../../../packages/core/src/org/context.js", () => ({
  resolveOrgIdForEmail: vi.fn(),
  getOrgContext: vi.fn(async () => ({ orgId: undefined })),
  resolveOrgByDomain: vi.fn(),
}));
vi.mock("../../../packages/core/src/server/auth.js", () => ({
  getSession: vi.fn(async () => null),
  registerAuthPublicPaths: vi.fn(),
  isLoopbackRequest: () => false,
}));
vi.mock("../../../packages/core/src/server/embed-session.js", () => ({
  resolveEmbedSessionFromRequest: vi.fn(async () => null),
  resolvedEmbedCapabilityScope: () => undefined,
}));
vi.mock("../../../packages/core/src/a2a-claims.js", () => ({
  verifyA2ATokenWithClaims: vi.fn(),
}));
vi.mock("../../../packages/core/src/server/identity-sso-store.js", () => ({
  consumeOneTimeJti: vi.fn(async () => false),
}));
vi.mock("../../../packages/core/src/mcp/build-server.js", () => ({
  verifyAuth: vi.fn(async () => ({ authed: false })),
}));
vi.mock("../../../packages/core/src/mcp/oauth-route.js", () => ({
  getMcpOAuthAudiences: () => [],
}));

import { mountActionRoutes } from "../../../packages/core/src/server/action-routes.js";
import saveDeck from "./save-deck.js";

describe("save-deck action transports", () => {
  it("enqueues one deck.created event for each direct-agent and HTTP invocation", async () => {
    await saveDeck.run({
      deckId: "deck-direct",
      deck: { title: "Direct", slides: [] },
    });

    const mounted: Array<{
      path: string;
      handler: (event: any) => Promise<unknown>;
    }> = [];
    mountActionRoutes(
      {
        use: (path: string, handler: (event: any) => Promise<unknown>) =>
          mounted.push({ path, handler }),
      } as any,
      { "save-deck": saveDeck } as any,
      { getOwnerFromEvent: async () => "owner@example.com" },
    );
    await mounted[0]!.handler({
      _method: "PUT",
      _headers: { "x-agent-native-frontend": "1" },
      req: {
        url: "http://app.test/_agent-native/actions/save-deck",
        json: async () => ({
          deckId: "deck-http",
          deck: { title: "HTTP", slides: [] },
        }),
      },
    });

    expect(mocks.enqueueWebhookEvent).toHaveBeenCalledTimes(2);
    expect(
      mocks.enqueueWebhookEvent.mock.calls.map(([event]) => event),
    ).toEqual(["deck.created", "deck.created"]);
  });
});
