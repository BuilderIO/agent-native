// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewWorkspaceAppFlow } from "./NewWorkspaceAppFlow.js";

const sendToAgentChatMock = vi.hoisted(() => vi.fn());
const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const devState = vi.hoisted(() => ({ isDevMode: false }));

vi.mock("./agent-chat.js", () => ({
  sendToAgentChat: sendToAgentChatMock,
}));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
}));

vi.mock("./use-dev-mode.js", () => ({
  useDevMode: () => ({ isDevMode: devState.isDevMode }),
}));

const vaultSecrets = [
  {
    id: "secret-openai",
    name: "OpenAI",
    credentialKey: "OPENAI_API_KEY",
    provider: "openai",
  },
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value",
  )?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("NewWorkspaceAppFlow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frameState.inBuilderFrame = false;
    devState.isDevMode = false;
    sendToAgentChatMock.mockReset();
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("list-vault-secret-options")) {
        return jsonResponse(vaultSecrets);
      }
      if (url.includes("start-workspace-app-creation")) {
        return jsonResponse({
          mode: "builder",
          appId: "qa-dashboard",
          url: "https://branch.example.test",
        });
      }
      if (url.includes("grant-vault-secrets-to-app")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: `Unexpected URL: ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderAndSelectSecret() {
    await act(async () => {
      root.render(
        React.createElement(NewWorkspaceAppFlow, { dispatchBasePath: null }),
      );
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain("OPENAI_API_KEY"),
      );
    });

    changeValue(
      container.querySelector("textarea")!,
      "Build a quality dashboard",
    );
    changeValue(container.querySelector("input")!, "qa-dashboard");

    act(() => {
      findButton(container, "OPENAI_API_KEY").click();
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(findButton(container, "Create app").disabled).toBe(false),
      );
    });
  }

  async function submitForm() {
    await act(async () => {
      findButton(container, "Create app").click();
    });
  }

  it("sends Builder-frame requested key grants in the prompt without marking grants active", async () => {
    frameState.inBuilderFrame = true;
    await renderAndSelectSecret();
    await submitForm();

    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
    const payload = sendToAgentChatMock.mock.calls[0][0];
    expect(payload).toMatchObject({ submit: true, type: "code" });
    expect(payload).not.toHaveProperty("newTab");

    const message = payload.message;
    expect(message).toContain(
      "Requested Dispatch vault key grants for this app: OPENAI_API_KEY",
    );
    expect(message).toContain(
      "After the app exists, grant the selected Dispatch vault keys",
    );
    expect(message).toContain(
      "Treat these as requested grants, not active grants before creation succeeds.",
    );
    expect(message).toContain("shared workspace database/hosting model");
    expect(message).toContain("workspace app registry metadata");
    expect(message).toContain(
      "workspace-apps.json or .agent-native/workspace-apps.json",
    );
    expect(message).toContain("manifest/package/deploy metadata");
    expect(message).toContain("agent card/A2A metadata");
    expect(message).not.toContain("Builder.io");
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("grant-vault-secrets-to-app"),
      ),
    ).toBe(false);
  });

  it("sends local chat requested key grants in the prompt without marking grants active", async () => {
    devState.isDevMode = true;
    await renderAndSelectSecret();
    await submitForm();

    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
    const payload = sendToAgentChatMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      submit: true,
      type: "code",
      newTab: true,
    });
    expect(payload.message).toContain(
      "Requested Dispatch vault key grants for this app: OPENAI_API_KEY",
    );
    expect(payload.message).toContain("App readiness requirements");
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("grant-vault-secrets-to-app"),
      ),
    ).toBe(false);
  });

  it("passes selected key ids to the server action as a pending request", async () => {
    await renderAndSelectSecret();
    await submitForm();

    const startCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("start-workspace-app-creation"),
    );
    expect(startCall).toBeTruthy();
    const body = JSON.parse((startCall?.[1] as RequestInit).body as string);
    expect(body.secretIds).toEqual(["secret-openai"]);
    expect(body).not.toHaveProperty("preparedPrompt");
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("grant-vault-secrets-to-app"),
      ),
    ).toBe(false);
  });
});
