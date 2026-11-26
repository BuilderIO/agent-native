import { afterEach, describe, expect, it, vi } from "vitest";

const listenerSets = new Map<string, Set<EventListenerOrEventListenerObject>>();
const origin = "https://host.example";
let negotiatedOrigin: string | null = origin;
const parent = { postMessage: vi.fn() };
const windowStub: {
  parent: unknown;
  location: {
    origin: string;
    hostname: string;
    pathname: string;
    search: string;
  };
  addEventListener: typeof addEventListener;
  removeEventListener: typeof removeEventListener;
  dispatchEvent: typeof dispatchEvent;
} = {
  parent,
  location: { origin, hostname: "app.example", pathname: "/", search: "" },
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = listenerSets.get(type) ?? new Set();
    listeners.add(listener);
    listenerSets.set(type, listeners);
  },
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    listenerSets.get(type)?.delete(listener);
  },
  dispatchEvent(event: Event) {
    for (const listener of listenerSets.get(event.type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    return true;
  },
};

vi.stubGlobal("window", windowStub);

vi.mock("./frame.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./frame.js")>()),
  getFrameOrigin: () => negotiatedOrigin,
  isTrustedFrameMessage: (event: MessageEvent) =>
    event.origin === origin ||
    (event.origin === "null" &&
      event.source === parent &&
      negotiatedOrigin === "null"),
}));
vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => false,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: vi.fn(),
}));
vi.mock("./mcp-app-host.js", () => ({
  isOpenAiMcpAppHost: () => false,
  sendMcpAppHostMessage: () => false,
}));
vi.mock("./analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics.js")>()),
  trackEvent: vi.fn(),
}));

const { AGENT_CHAT_SUBMIT_RESULT_EVENT } = await import("./agent-chat.js");

afterEach(() => {
  negotiatedOrigin = origin;
  for (const type of listenerSets.keys()) {
    if (type !== "message") listenerSets.delete(type);
  }
  vi.restoreAllMocks();
});

function sendAck(
  data: unknown,
  options: { source?: unknown; origin?: string } = {},
) {
  const event = Object.assign(new Event("message"), {
    data: { type: "agentNative.submitChatResult", data },
    source: options.source ?? parent,
    origin: options.origin ?? origin,
  });
  windowStub.dispatchEvent(event);
}

describe("agent chat parent acknowledgement listener", () => {
  it("publishes a successful parent acknowledgement", () => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);

    sendAck({ submitMessageId: "submit-1", delivered: true });

    expect(result).toHaveBeenCalledOnce();
    expect((result.mock.calls[0][0] as CustomEvent).detail).toEqual({
      submitMessageId: "submit-1",
      delivered: true,
      reason: undefined,
    });
  });

  it("preserves an optional rejection reason", () => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);

    sendAck({ submitMessageId: "submit-1", delivered: false, reason: "busy" });

    expect((result.mock.calls[0][0] as CustomEvent).detail).toEqual({
      submitMessageId: "submit-1",
      delivered: false,
      reason: "busy",
    });
  });

  it.each([
    ["a sibling frame", {}, {}],
    [
      "a forged origin",
      { origin: "https://evil.example" },
      { origin: "https://evil.example" },
    ],
  ])("ignores acknowledgements from %s", (_label, _unused, eventOptions) => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);
    const options = eventOptions as { source?: unknown; origin?: string };
    sendAck(
      { submitMessageId: "submit-1", delivered: true },
      options.origin ? options : { source: {} },
    );
    expect(result).not.toHaveBeenCalled();
  });

  it("accepts an acknowledgement from the negotiated opaque parent origin", () => {
    negotiatedOrigin = "null";
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);

    sendAck(
      { submitMessageId: "submit-1", delivered: true },
      { origin: "null" },
    );

    expect(result).toHaveBeenCalledOnce();
  });

  it("rejects an opaque acknowledgement from a sibling frame", () => {
    negotiatedOrigin = "null";
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);

    sendAck(
      { submitMessageId: "submit-1", delivered: true },
      { origin: "null", source: {} },
    );

    expect(result).not.toHaveBeenCalled();
  });

  it("ignores acknowledgements when the window is top-level", () => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);
    windowStub.parent = windowStub;
    sendAck({ submitMessageId: "submit-1", delivered: true });
    expect(result).not.toHaveBeenCalled();
    windowStub.parent = parent;
  });

  it.each([
    null,
    {},
    { submitMessageId: 1, delivered: true },
    { submitMessageId: "submit-1", delivered: "true" },
  ])("ignores malformed acknowledgement body %j", (data) => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);
    sendAck(data);
    expect(result).not.toHaveBeenCalled();
  });

  it("omits a non-string optional reason", () => {
    const result = vi.fn();
    windowStub.addEventListener(AGENT_CHAT_SUBMIT_RESULT_EVENT, result);

    sendAck({ submitMessageId: "submit-1", delivered: true, reason: 42 });

    expect((result.mock.calls[0][0] as CustomEvent).detail).toEqual({
      submitMessageId: "submit-1",
      delivered: true,
      reason: undefined,
    });
  });
});
