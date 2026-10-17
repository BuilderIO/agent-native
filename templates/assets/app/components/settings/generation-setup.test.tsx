// @vitest-environment happy-dom

import type { OnboardingStepStatus } from "@agent-native/core/client/onboarding";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const saveScope = vi.hoisted(() => ({
  scope: "user" as "user" | "org" | null,
  canChoose: false,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  useCredentialSaveScope: () => ({
    ...saveScope,
    setScope: vi.fn(),
    orgName: "Acme",
    roleUnavailable: false,
    retry: vi.fn(),
  }),
  WhoField: () => <div data-testid="who-field" />,
}));

import { ManualMethodFields } from "./generation-setup";

const step: OnboardingStepStatus = {
  id: "image-generation",
  title: "Image generation",
  description: "Connect an image provider.",
  order: 1,
  required: false,
  complete: false,
  methods: [
    {
      id: "gemini",
      kind: "form",
      label: "Gemini",
      payload: {
        fields: [{ key: "GEMINI_API_KEY", label: "API key", secret: true }],
        writeScope: "workspace",
      },
    },
  ],
};

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function save(): Promise<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ saved: ["GEMINI_API_KEY"] }), {
        status: 200,
      });
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ManualMethodFields step={step} onSaved={async () => {}} />);
  });
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "example-gemini-value");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container!
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0]!;
}

describe("image generation key save scope", () => {
  it("saves a member's key personally, not to the step's workspace scope", async () => {
    saveScope.scope = "user";
    saveScope.canChoose = false;

    const body = await save();

    expect(body.scope).toBe("user");
    expect(container!.querySelector("[data-testid=who-field]")).toBeNull();
  });

  it("saves where an owner or admin picked", async () => {
    saveScope.scope = "org";
    saveScope.canChoose = true;

    const body = await save();

    expect(body.scope).toBe("org");
    expect(container!.querySelector("[data-testid=who-field]")).not.toBeNull();
  });
});
