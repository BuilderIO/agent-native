// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceTemplateCard,
  WorkspaceTemplatesSection,
  type CuratedWorkspaceTemplate,
} from "./workspace-template-card";

const clientState = vi.hoisted(() => ({
  mutation: vi.fn(),
  options: null as Record<string, unknown> | null,
  isPending: false,
}));

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (_name: string, options: Record<string, unknown>) => {
    clientState.options = options;
    return {
      mutate: clientState.mutation,
      isPending: clientState.isPending,
    };
  },
}));

vi.mock("sonner", () => ({ toast }));

const template: CuratedWorkspaceTemplate = {
  id: "weekly-report",
  name: "Weekly report",
  description: "Turn workspace activity into a concise weekly report.",
  source: "RevOps",
  integrationSetup: "Connect your CRM after installing the app.",
  liveUrl: "https://reports.example.test",
};

describe("WorkspaceTemplateCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.mutation.mockReset();
    clientState.options = null;
    clientState.isPending = false;
    toast.error.mockReset();
    toast.success.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body
      .querySelectorAll("[data-radix-portal]")
      .forEach((portal) => portal.remove());
    vi.unstubAllGlobals();
  });

  it("shows template context and only links to a live app when supplied", async () => {
    await act(async () => {
      root.render(<WorkspaceTemplateCard template={template} />);
    });

    expect(container.textContent).toContain("Weekly report");
    expect(container.textContent).toContain("RevOps");
    expect(container.textContent).toContain(
      "Connect your CRM after installing the app.",
    );

    const liveLink = container.querySelector<HTMLAnchorElement>(
      'a[href="https://reports.example.test"]',
    );
    expect(liveLink?.textContent).toContain("View the live app");
    expect(liveLink?.target).toBe("_blank");

    await act(async () => {
      root.render(
        <WorkspaceTemplateCard
          template={{ ...template, liveUrl: null, productUrl: null }}
        />,
      );
    });
    expect(
      container.querySelector('a[href="https://reports.example.test"]'),
    ).toBe(null);
  });

  it("remixes with the default app id and allows an override", async () => {
    await act(async () => {
      root.render(
        <WorkspaceTemplateCard template={template} defaultAppId="pipeline" />,
      );
    });

    const trigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Remix into workspace"),
    );
    expect(trigger).not.toBeUndefined();

    await act(async () => {
      trigger?.click();
    });

    const input = document.body.querySelector<HTMLInputElement>(
      "#workspace-template-app-id-weekly-report",
    );
    expect(input?.value).toBe("pipeline");

    await act(async () => {
      if (!input) throw new Error("Expected app id input");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "sales-ops");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      document.body.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(clientState.mutation).toHaveBeenCalledWith({
      templateId: "weekly-report",
      appId: "sales-ops",
    });

    await act(async () => {
      await (clientState.options?.onSuccess as (result: unknown) => unknown)({
        appId: "sales-ops",
      });
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Template remixed into your workspace.",
    );
  });

  it("accepts the list action envelope and renders installed state", async () => {
    await act(async () => {
      root.render(
        <WorkspaceTemplatesSection
          templates={{
            templates: [
              {
                ...template,
                installed: true,
                liveUrl: null,
                productUrl: null,
              },
            ],
          }}
          title="Curated templates"
        />,
      );
    });

    expect(container.textContent).toContain("Curated templates");
    expect(container.textContent).toContain("Installed");
    expect(container.querySelector('a[href^="https://"]')).toBeNull();
    const remixButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Remix into workspace"),
    );
    expect(remixButton).not.toHaveProperty("disabled", true);
  });
});
