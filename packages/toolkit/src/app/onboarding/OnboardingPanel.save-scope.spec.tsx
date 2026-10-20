// @vitest-environment happy-dom

import type { OnboardingStepStatus } from "@agent-native/core/onboarding/types";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

let steps: OnboardingStepStatus[] = [];
let onboardingError: string | null = null;
let dismissed = false;
let summaryKnown = true;
let refresh = vi.fn(async () => {});
vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  createOnboardingCorrelationId: () => "test-onboarding-correlation-id",
  trackOnboardingEvent: vi.fn(),
  useOnboarding: () => ({
    steps,
    currentStepId: steps[0]?.id ?? null,
    completeCount: steps.filter((step) => step.complete).length,
    totalCount: steps.length,
    allComplete:
      steps.length > 0 &&
      steps.filter((step) => step.required).every((step) => step.complete),
    dismissed,
    summaryKnown,
    loading: false,
    error: onboardingError,
    refresh,
    complete: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/onboarding/use-preview-mode", () => ({
  useOnboardingPreviewMode: () => false,
}));
vi.mock("@agent-native/core/client/use-dev-mode", () => ({
  useDevMode: () => ({ isDevMode: false }),
}));

import { OnboardingBanner } from "./OnboardingBanner.js";
import { OnboardingPanel } from "./OnboardingPanel.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function formStep(saveTo?: "scoped-secrets"): OnboardingStepStatus {
  return {
    id: "example-keys",
    title: "Example keys",
    description: "Connect the example service.",
    order: 1,
    required: true,
    complete: false,
    methods: [
      {
        id: "example-form",
        kind: "form",
        label: "Paste a token",
        primary: true,
        payload: {
          fields: [{ key: "EXAMPLE_TOKEN", label: "Token", secret: true }],
          writeScope: "workspace",
          ...(saveTo ? { saveTo } : {}),
        },
      },
    ],
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  steps = [];
  onboardingError = null;
  dismissed = false;
  summaryKnown = true;
  refresh = vi.fn(async () => {});
  vi.unstubAllGlobals();
});

async function renderOnboarding(child: React.ReactNode): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{child}</TooltipProvider>
      </QueryClientProvider>,
    );
  });
}

async function saveAs(
  role: "member" | "admin",
  saveTo?: "scoped-secrets",
): Promise<Array<{ url: string; body: Record<string, unknown> }>> {
  steps = [formStep(saveTo)];
  const saves: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/_agent-native/org/me")) {
        return json({
          email: "viewer@example.test",
          orgId: "org-1",
          orgName: "Acme",
          role,
        });
      }
      saves.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return json({ saved: ["EXAMPLE_TOKEN"] });
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <OnboardingPanel />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => {
    const save = [...container!.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    expect(save?.disabled).toBe(false);
  });

  const input = container!.querySelector("input")!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "example-token-value");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container!
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(saves).toHaveLength(1));
  return saves;
}

describe("onboarding form save scope", () => {
  it("saves a member's key personally, not to the step's workspace scope", async () => {
    const [save] = await saveAs("member");
    expect(save.url).toContain("/_agent-native/env-vars");
    expect(save.body.scope).toBe("user");
  });

  it("saves a member's scoped secret personally", async () => {
    const [save] = await saveAs("member", "scoped-secrets");
    expect(save.url).toContain("/_agent-native/secrets/adhoc");
    expect(save.body.scope).toBe("user");
  });

  it("saves an admin's key for the organization by default", async () => {
    const [envSave] = await saveAs("admin");
    expect(envSave.body.scope).toBe("org");
    act(() => root?.unmount());
    root = null;
    const [secretSave] = await saveAs("admin", "scoped-secrets");
    expect(secretSave.body.scope).toBe("workspace");
  });

  it("shows retry only when the initial summary is unavailable", async () => {
    steps = [formStep()];
    onboardingError = "summary: 503";
    summaryKnown = false;
    refresh = vi.fn(async () => {});
    await renderOnboarding(<OnboardingPanel />);

    const retry = container?.querySelector<HTMLButtonElement>(
      '[data-testid="onboarding-summary-retry"]',
    );
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container?.textContent).not.toContain("Example keys");
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps known steps visible while showing a summary retry state", async () => {
    steps = [formStep()];
    onboardingError = "summary: 503";
    await renderOnboarding(<OnboardingPanel />);

    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container?.textContent).toContain("Example keys");
    expect(
      container?.querySelector('[data-testid="onboarding-summary-retry"]'),
    ).not.toBeNull();
  });

  it("shows a retry-only banner when the initial summary is unavailable", async () => {
    steps = [formStep()];
    onboardingError = "summary: 503";
    summaryKnown = false;
    refresh = vi.fn(async () => {});
    await renderOnboarding(<OnboardingBanner />);

    const retry = container?.querySelector<HTMLButtonElement>(
      '[data-testid="onboarding-summary-retry"]',
    );
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container?.textContent).not.toContain("Example keys");
    expect(container?.textContent).not.toContain("Continue");
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows a retry action on the banner for a known active summary", async () => {
    steps = [formStep()];
    onboardingError = "summary: 503";
    summaryKnown = true;
    refresh = vi.fn(async () => {});
    await renderOnboarding(<OnboardingBanner />);

    const retry = container?.querySelector<HTMLButtonElement>(
      '[data-testid="onboarding-summary-retry"]',
    );
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("hides summary errors after onboarding is dismissed", async () => {
    dismissed = true;
    summaryKnown = true;
    onboardingError = "summary: 503";

    await renderOnboarding(
      <>
        <OnboardingBanner />
        <OnboardingPanel />
      </>,
    );
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });

  it("hides summary errors after all required steps are complete", async () => {
    steps = [{ ...formStep(), complete: true }];
    summaryKnown = true;
    onboardingError = "summary: 503";

    await renderOnboarding(
      <>
        <OnboardingBanner />
        <OnboardingPanel />
      </>,
    );
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the retry notice visible while the panel is collapsed", async () => {
    steps = [formStep()];
    summaryKnown = true;
    onboardingError = "summary: 503";
    await renderOnboarding(<OnboardingPanel />);

    const collapse = container?.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse onboarding"]',
    );
    await act(async () => collapse?.click());

    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="onboarding-summary-retry"]'),
    ).not.toBeNull();
  });
});
