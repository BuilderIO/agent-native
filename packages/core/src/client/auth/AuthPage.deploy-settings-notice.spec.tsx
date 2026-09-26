// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import {
  DEPLOY_SETTINGS_REQUIRED_CODE,
  getRuntimeConfigReport,
  type MissingDeploySettings,
} from "../../shared/runtime-config.js";
import { AuthPage, type AuthPageProps } from "./AuthPage.js";

const NONE: MissingDeploySettings = {
  databaseSource: null,
  authSecretKey: null,
  a2aSecretMissing: false,
};

function notice(keys: string): string {
  return `This deployment isn't set up yet. Set ${keys} in your host's environment settings, then redeploy.`;
}

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function probeWith(missing: MissingDeploySettings, env = {}): Response {
  return jsonResponse(200, {
    message: "ok",
    configuration: getRuntimeConfigReport(
      env,
      {},
      { phase: "runtime", missingDeploySettings: missing },
    ),
  });
}

type ProbeAnswer = () => Promise<Response>;

function installFetchMock(probe: ProbeAnswer, register?: Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/_agent-native/ping?configuration=1")) return probe();
    if (url.endsWith("/_agent-native/auth/session"))
      return jsonResponse(200, { error: "Not authenticated" });
    if (url.endsWith("/_agent-native/auth/register") && register)
      return register.clone();
    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function probeCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).includes("/_agent-native/ping?configuration=1"),
  ).length;
}

describe("AuthPage deploy settings notice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderPage() {
    await act(async () => {
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml())}
          identitySsoAuto={false}
        />,
      );
    });
  }

  function banner() {
    return container.querySelector('[data-testid="deploy-settings-notice"]');
  }

  it.each([
    ["no database", { ...NONE, databaseSource: "default" }, "DATABASE_URL"],
    [
      "a local PGlite database",
      { ...NONE, databaseSource: "DATABASE_URL" },
      "DATABASE_URL",
    ],
    [
      "no auth secret",
      { ...NONE, authSecretKey: "BETTER_AUTH_SECRET" as const },
      "BETTER_AUTH_SECRET",
    ],
    [
      "a workspace without A2A_SECRET",
      {
        ...NONE,
        authSecretKey: "A2A_SECRET" as const,
        a2aSecretMissing: true,
      },
      "A2A_SECRET",
    ],
    [
      "neither a database nor an auth secret",
      {
        ...NONE,
        databaseSource: "default",
        authSecretKey: "BETTER_AUTH_SECRET" as const,
      },
      "DATABASE_URL and BETTER_AUTH_SECRET",
    ],
  ])("names what is missing for %s", async (_case, missing, keys) => {
    installFetchMock(() => Promise.resolve(probeWith(missing)));

    await renderPage();

    await vi.waitFor(() => expect(banner()?.textContent).toBe(notice(keys)));
    expect(banner()?.getAttribute("role")).toBe("alert");
    // Guidance, not a lock: the sign-up form stays usable.
    expect(container.querySelector("#signup-form")).toBeTruthy();
  });

  it("stays hidden when nothing is missing, even with a weak secret on record", async () => {
    // A weak but working secret belongs to the in-app notice; this public
    // page must never advertise it.
    const fetchMock = installFetchMock(() =>
      Promise.resolve(
        probeWith(NONE, {
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "short",
        }),
      ),
    );

    await renderPage();

    await vi.waitFor(() => expect(probeCalls(fetchMock)).toBe(1));
    await act(async () => {});
    expect(banner()).toBeNull();
  });

  it.each([
    ["a server error", () => Promise.resolve(jsonResponse(500, {}))],
    ["a network failure", () => Promise.reject(new TypeError("offline"))],
    ["a malformed report", () => Promise.resolve(jsonResponse(200, {}))],
  ])("claims nothing when the probe returns %s", async (_case, probe) => {
    installFetchMock(probe);

    await renderPage();
    await act(async () => {});

    expect(banner()).toBeNull();
  });

  it("explains a refused sign-up and asks the probe again when it never answered", async () => {
    let calls = 0;
    const fetchMock = installFetchMock(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError("offline"))
          : Promise.resolve(
              probeWith({ ...NONE, authSecretKey: "BETTER_AUTH_SECRET" }),
            );
      },
      jsonResponse(503, {
        error: "This deployment is missing required settings.",
        code: DEPLOY_SETTINGS_REQUIRED_CODE,
      }),
    );
    await renderPage();

    await act(() => {
      for (const [id, value] of [
        ["s-email", "new@example.com"],
        ["s-pass", "password123"],
        ["s-pass2", "password123"],
      ]) {
        const input = container.querySelector(`#${id}`) as HTMLInputElement;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {
      container
        .querySelector("#signup-form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    await vi.waitFor(() =>
      expect(banner()?.textContent).toBe(notice("BETTER_AUTH_SECRET")),
    );
    expect(probeCalls(fetchMock)).toBe(2);
    expect(container.textContent).toContain(
      "Accounts are unavailable until this deployment is set up.",
    );
    expect(container.textContent).not.toContain(
      "We couldn't create your account",
    );
  });
});
