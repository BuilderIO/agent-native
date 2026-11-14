import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only saved-key storage and the database kind are replaced. The adapters,
// the credential rules and the request context are the real ones.
vi.mock("../../secrets/storage.js", () => ({
  readAppSecret: vi.fn(async () => null),
  readAppSecretMeta: vi.fn(async () => null),
  readAppSecrets: vi.fn(async () => new Map()),
  writeAppSecret: vi.fn(),
  deleteAppSecret: vi.fn(),
}));
vi.mock("../../org/context.js", () => ({
  resolveOrgIdForEmail: vi.fn(async () => null),
}));
vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  isLocalDatabase: () => false,
}));

import { runWithRequestContext } from "../../server/request-context.js";
import { microsoftTeamsAdapter } from "./microsoft-teams.js";
import { telegramAdapter } from "./telegram.js";
import { whatsappAdapter } from "./whatsapp.js";

const KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "MICROSOFT_TEAMS_APP_ID",
  "MICROSOFT_TEAMS_APP_PASSWORD",
];
const saved: Record<string, string | undefined> = {};
let urls: string[] = [];

beforeEach(() => {
  saved.NODE_ENV = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  for (const key of KEYS) {
    saved[key] = process.env[key];
    process.env[key] = `fake-${key.toLowerCase()}`;
  }
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      const body = String(url).includes("oauth2")
        ? { access_token: "fake-teams-access", expires_in: 3600 }
        : {
            ok: true,
            result: { message_id: 7 },
            id: "reply-1",
            messages: [{ id: "wamid.1" }],
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The webhook handler sends every reply as the integration owner.
function asIntegrationRun<T>(platform: string, fn: () => Promise<T>) {
  return runWithRequestContext(
    { userEmail: `integration@${platform}`, isIntegrationCaller: true },
    fn,
  );
}

describe("replies use bot credentials set as environment variables in production", () => {
  it("sends a Telegram reply", async () => {
    await asIntegrationRun("telegram", () =>
      telegramAdapter().sendResponse(
        { text: "hello", platformContext: {} },
        {
          platform: "telegram",
          externalThreadId: "chat:1",
          text: "hi",
          senderId: "2",
          timestamp: 1,
          platformContext: { chatId: 1 },
        },
      ),
    );
    expect(urls.some((url) => url.includes("api.telegram.org"))).toBe(true);
  });

  it("sends a WhatsApp reply", async () => {
    await asIntegrationRun("whatsapp", () =>
      whatsappAdapter().sendResponse(
        { text: "hello", platformContext: {} },
        {
          platform: "whatsapp",
          externalThreadId: "15551234567",
          text: "hi",
          senderId: "15551234567",
          timestamp: 1,
          platformContext: {},
        },
      ),
    );
    expect(urls.some((url) => url.includes("graph.facebook.com"))).toBe(true);
  });

  it("sends a Microsoft Teams reply", async () => {
    await asIntegrationRun("microsoft-teams", () =>
      microsoftTeamsAdapter().sendResponse(
        { text: "hello", platformContext: {} },
        {
          platform: "microsoft-teams",
          externalThreadId: "conversation-1",
          text: "hi",
          senderId: "user-1",
          timestamp: 1,
          replyRef: "activity-1",
          platformContext: {
            serviceUrl: "https://smba.trafficmanager.net/teams/",
            conversationId: "conversation-1",
            activityId: "activity-1",
            recipient: { id: "bot-1" },
          },
        },
      ),
    ).catch(() => undefined);
    expect(urls.some((url) => url.includes("/v3/conversations/"))).toBe(true);
  });
});
