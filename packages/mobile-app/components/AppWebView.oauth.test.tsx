// @vitest-environment happy-dom

import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  type ComponentType,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { AuthPage } = await vi.importActual<{
  AuthPage: ComponentType<Record<string, unknown>>;
}>("../../toolkit/src/app/auth/AuthPage");

const native = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
  open: vi.fn(),
  save: vi.fn(),
  dismiss: vi.fn(),
}));
function evaluate(script: string) {
  window.eval(script);
}
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    View: Box,
    Text: Box,
    TouchableOpacity: Box,
    ActivityIndicator: () => null,
    Platform: { OS: "ios" },
    Linking: { openURL: vi.fn() },
    AppState: { addEventListener: () => ({ remove() {} }) },
  };
});
vi.mock("@/lib/mobile-deck-save-bridge", () => ({
  registerMobileSlidesWebView: vi.fn(),
}));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: native.open,
  dismissAuthSession: native.dismiss,
}));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
    multiSet: vi.fn(),
  },
}));
vi.mock("@/components/NativeSignInSheet", () => ({
  NativeSignInSheet: () => null,
}));
vi.mock("@/components/uniwind-interop", () => ({
  WebView: forwardRef((props, ref) => {
    native.props = props as Record<string, unknown>;
    useImperativeHandle(ref, () => ({
      injectJavaScript: evaluate,
      reload: vi.fn(),
    }));
    return null;
  }),
}));
vi.mock("@/lib/mobile-theme", () => ({
  buildMobileGuestThemeScript: () => "true;",
}));
vi.mock("@/lib/mobile-colors", () => ({
  useMobileThemeColors: () => ({ theme: "light" }),
}));
vi.mock("@/lib/native-app-auth", () => ({
  useNativeAppAuthState: () => ({ enabled: false, ready: true }),
}));
vi.mock("@/lib/native-auth", () => ({
  NATIVE_AUTH_BASE_URL: "https://example.test",
  inspectNativeSessionShared: vi.fn(),
}));
vi.mock("@/lib/navigation", () => ({
  useCurrentPathname: () => "/tab-app/test-app",
}));
vi.mock("@/lib/session-token-store", () => ({
  SESSION_TOKEN_KEY: "test:parent",
  getSessionToken: async () => null,
  saveSessionToken: native.save,
  clearSessionToken: vi.fn(),
}));
vi.mock("@/lib/workspace-app-auth", () => ({
  ensureLiveWorkspaceAppSessionsHydrated: async () => {},
  mobileSessionFingerprint: () => "test-owner",
}));
import AppWebView from "./AppWebView";
type TestRoot = { render(node: ReactNode): void; unmount(): void };
const { createRoot } = await vi.importActual<{
  createRoot(container: Element): TestRoot;
}>("react-dom/client");
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let finish: ((value: { type: string; url?: string }) => void) | undefined;
let cookieConfirmed: boolean;
let handoffRequests: RequestInit[];
let sessionRequests: RequestInit[];
let exchangeRequests: RequestInit[];
let challengeRequests: Array<{ url: string; init: RequestInit | undefined }>;
let replace: ReturnType<typeof vi.spyOn>;
const origin = "http://localhost:3000";
const providerUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?state=qa-test-state";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/sign-in?c=%2Fhome");
  finish = undefined;
  native.save.mockReset();
  native.open.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  cookieConfirmed = true;
  handoffRequests = [];
  sessionRequests = [];
  native.dismiss.mockReset();
  exchangeRequests = [];
  challengeRequests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let data: object = { error: "Not authenticated" };
      if (url.includes("google/auth-url")) {
        challengeRequests.push({ url, init });
        data = { url: providerUrl };
      } else if (url.includes("desktop-exchange")) {
        exchangeRequests.push(init ?? {});
        data = {
          error: "Desktop browser binding cannot cross native cookie jars",
        };
      } else if (url.includes("mobile-session")) {
        handoffRequests.push(init ?? {});
        data = { ok: true };
      } else if (url.includes("/auth/session")) {
        sessionRequests.push(init ?? {});
        if (handoffRequests.length && cookieConfirmed)
          data = { email: "qa-test@example.test", token: "qa-test-app-token" };
      } else if (url.includes("/auth/local-dev")) data = { available: true };
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
  vi.stubGlobal(
    "open",
    vi.fn(() => ({ closed: false, location: { href: "" }, close: vi.fn() })),
  );
  replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const match = getOnboardingHtml({
    requestHost: "127.0.0.1",
    requestPath: "/sign-in?c=%2Fhome",
  }).match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) throw new Error("Auth props unavailable");
  const props = JSON.parse(match[1]) as Record<string, unknown>;
  await act(async () => {
    root.render(
      createElement(
        "div",
        null,
        createElement(AppWebView, { url: origin, captureSessionToken: false }),
        createElement(AuthPage, {
          ...props,
          identitySsoEnabled: false,
          googleViaIdentitySso: false,
          googleAuthMode: "auto",
          showGoogle: true,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
  });
  Object.assign(window, {
    ReactNativeWebView: {
      postMessage(data: string) {
        const handler = native.props.onMessage as (event: {
          nativeEvent: { data: string; url: string };
        }) => void;
        handler({ nativeEvent: { data, url: origin + "/sign-in" } });
      },
    },
  });
  evaluate(String(native.props.injectedJavaScriptBeforeContentLoaded));
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>("#local-dev-full-options")
      ?.click();
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  replace.mockRestore();
  Reflect.deleteProperty(window, "__agentNativeNavigationStarted");
  // Each case represents a fresh WebView document.
  for (const key of Object.keys(window))
    if (key.startsWith("__agentNativeMobile"))
      Reflect.deleteProperty(window, key);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>("#google-btn")?.click();
    await vi.advanceTimersByTimeAsync(100);
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function button() {
  return container.querySelector<HTMLButtonElement>("#google-btn");
}

it.each(["cancel", "dismiss", "error"])(
  "returns a native Google sheet (%s) to the sign-in retry without saving its token",
  async (result) => {
    if (result === "error")
      native.open.mockRejectedValueOnce(new Error("QA test native failure"));
    await start();
    await act(async () => {
      if (result !== "error") finish?.({ type: result });
    });
    await advance(6000);
    expect(button()?.disabled).toBe(false);
    expect(
      container.querySelector("#google-signin .msg.error")?.textContent,
    ).toContain("Unable to sign in with Google");
    expect(native.open).toHaveBeenCalledWith(
      providerUrl,
      "agentnative://oauth-complete",
    );
    expect(native.save).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await start();
    expect(native.open).toHaveBeenCalledTimes(2);
  },
);

it("uses mobile state validation and confirms the WebView cookie without a bearer", async () => {
  await start();
  expect(native.open).toHaveBeenCalledOnce();
  const challenge = challengeRequests.at(0);
  if (!challenge) throw new Error("Native auth URL was not resolved");
  const params = new URL(challenge.url, origin).searchParams;
  expect(params.get("mobile")).toBe("1");
  expect(params.has("desktop")).toBe(false);
  expect(params.has("flow_id")).toBe(false);
  expect(exchangeRequests).toHaveLength(0);
  await advance(30_000);
  expect(button()?.disabled).toBe(false);
  expect(replace).not.toHaveBeenCalled();
  await finishSuccess();
  const handoff = handoffRequests.at(0);
  expect(handoff?.method).toBe("POST");
  expect(handoff?.credentials).toBe("include");
  expect(new Headers(handoff?.headers).get("Authorization")).toBe(
    "Bearer qa-test-app-token",
  );
  const confirmation = sessionRequests.at(-1);
  expect(confirmation?.credentials).toBe("include");
  expect(new Headers(confirmation?.headers).has("Authorization")).toBe(false);
  expect(native.save).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/home");
});

it("shows retry when the handoff returns OK but the WebView still has no session cookie", async () => {
  cookieConfirmed = false;
  await start();
  await finishSuccess();
  expect(button()?.disabled).toBe(false);
  expect(
    container.querySelector("#google-signin .msg.error")?.textContent,
  ).toContain("Unable to sign in with Google");
  expect(replace).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
});

it("rejects a callback from a different OAuth state before any cookie write", async () => {
  await start();
  await finishSuccess("wrong-state");
  expect(handoffRequests).toHaveLength(0);
  expect(native.save).not.toHaveBeenCalled();
  expect(button()?.disabled).toBe(false);
  expect(replace).not.toHaveBeenCalled();
});

it("supersedes a hung native attempt and ignores its late callback", async () => {
  await start();
  const oldFinish = finish;
  if (!oldFinish) throw new Error("First native browser did not start");
  await advance(30_000);
  await start();
  expect(native.dismiss).toHaveBeenCalledOnce();
  expect(native.open).toHaveBeenCalledTimes(2);
  await act(async () => {
    oldFinish({
      type: "success",
      url: "agentnative://oauth-complete?token=qa-test-old-token&state=qa-test-state",
    });
  });
  expect(handoffRequests).toHaveLength(0);
  await finishSuccess();
  expect(handoffRequests).toHaveLength(1);
  expect(replace).toHaveBeenCalledWith("/home");
});

async function finishSuccess(state = "qa-test-state") {
  await act(async () => {
    if (!finish) throw new Error("Native Google sheet did not open");
    finish({
      type: "success",
      url:
        "agentnative://oauth-complete?token=qa-test-app-token&state=" + state,
    });
    await vi.advanceTimersByTimeAsync(100);
  });
}

it("does not open a legacy Google request over an active mobile auth session", async () => {
  await start();
  const handler = native.props.onMessage as (event: {
    nativeEvent: { data: string; url: string };
  }) => void;
  await act(async () => {
    handler({
      nativeEvent: {
        url: origin + "/sign-in",
        data: JSON.stringify({ type: "openUrl", url: providerUrl }),
      },
    });
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(native.open).toHaveBeenCalledOnce();
});

it.each([
  "//_agent-native/google/auth-url",
  "//qa-external.example/_agent-native/google/auth-url",
])("refuses a protocol-relative endpoint prefix (%s)", async (path) => {
  const result = window.eval(
    "window.__agentNativeMobileOAuth.start(" +
      JSON.stringify(origin + path) +
      ")",
  ) as Promise<string>;
  await advance(100);
  expect(native.open).not.toHaveBeenCalled();
  expect(handoffRequests).toHaveLength(0);
  await expect(result).resolves.toBe("failed");
});

it("drops a callback when the WebView starts loading another document", async () => {
  await start();
  const onLoadStart = native.props.onLoadStart as () => void;
  await act(async () => {
    onLoadStart();
  });
  await finishSuccess();
  expect(handoffRequests).toHaveLength(0);
  expect(native.save).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
