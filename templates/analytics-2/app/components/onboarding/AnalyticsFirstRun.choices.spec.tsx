// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recorded: Array<{ action: string; args: unknown }> = [];
const actions = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  importCsv: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    callAction: async (action: string, args: unknown) => {
      recorded.push({ action, args });
      if (action === "create-project") return actions.create(args);
      if (action === "upload-project-file") return actions.upload(args);
      if (action === "import-project-csv") return actions.importCsv(args);
      if (action === "delete-project") return actions.deleteProject(args);
      throw new Error(`Unexpected action ${action}`);
    },
  };
});

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return i18nMock;
});

import { resolveRoute } from "@/routes/routing/registry";

import { AnalyticsFirstRun } from "./AnalyticsFirstRun";

/**
 * Census CEN-analytics-2-001: every choice on the first-run screen led nowhere.
 * A sample button navigated to `/project?sample=<name>`, which matches no route
 * (the org route redirects it to /home) and no code reads the parameter, so the
 * account landed on Home with no project for the dataset.
 *
 * This is the batch's own acceptance condition, run against the component: the
 * dataset's name must reach the app through a real action call, and the
 * destination the component navigates to must resolve to a route that renders
 * something - not a redirect, not Home.
 */

let host: HTMLDivElement;
let root: Root | null = null;
let location = "";

function LocationProbe() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("first-run choices reach the app", () => {
  beforeEach(() => {
    actions.upload.mockReset().mockResolvedValue({ file: { id: "csv-file" } });
    actions.create.mockReset().mockResolvedValue({
      id: "project-1",
      href: "/project/project-1/latest",
    });
    actions.importCsv.mockReset().mockResolvedValue({
      dataset: {
        id: "staged-csv",
        name: "first-analysis",
        rowCount: 3,
        columns: ["month", "value"],
        sourceComplete: true,
      },
    });
    actions.deleteProject.mockReset().mockResolvedValue({ ok: true });
    recorded.length = 0;
    location = "";
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  const mount = async (
    onComplete = vi.fn<() => boolean | Promise<boolean>>(() => true),
    onSkip = vi.fn(),
  ): Promise<{ onComplete: typeof onComplete }> => {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/"]}>
          <AnalyticsFirstRun onComplete={onComplete} onSkip={onSkip} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await wait(0);
    });
    return { onComplete };
  };

  it("creates a project for the chosen sample dataset instead of opening Home", async () => {
    const { onComplete } = await mount();
    const sampleButton = [...host.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "orders",
    );
    expect(sampleButton, "the orders sample button").toBeTruthy();

    await act(async () => {
      sampleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await wait(0);
    });
    await act(async () => {
      await wait(0);
    });

    // the dataset's name reached the app through a recorded action call
    const createCall = recorded.find(
      (call) => call.action === "create-project",
    );
    expect(createCall).toBeTruthy();
    expect(createCall?.args).toEqual({
      title: "orders",
      sampleDataset: "orders",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    // the choice completed onboarding and the destination renders something
    expect(onComplete).toHaveBeenCalled();
    expect(location).not.toBe("");
    const route = resolveRoute(location);
    expect(route.frame).not.toBe("redirect");
    expect(route.id).not.toBe("home");
  });

  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button, label).toBeTruthy();
    await act(async () => {
      button?.click();
      await wait(0);
    });
  };

  const csv = "month,value\nJanuary,10\nFebruary,20\nMarch,15\n";
  const selectCsv = async (name = "first-analysis.csv") => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input, "CSV file picker").not.toBeNull();
    const file = new File([csv], name, {
      type: "text/csv",
      lastModified: 1_700_000_000_000,
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode(csv).buffer,
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [file],
        configurable: true,
      });
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(0);
    });
  };

  it("imports the selected CSV through the staged-data action before completing and navigating", async () => {
    const { onComplete } = await mount();
    await selectCsv();
    expect(actions.create).toHaveBeenCalledExactlyOnceWith({
      title: "first-analysis",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(actions.importCsv).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-1",
      filename: "first-analysis.csv",
      dataBase64: btoa(csv),
    });
    expect(actions.upload).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-1",
      filename: "first-analysis.csv",
      mimeType: "text/csv",
      dataBase64: btoa(csv),
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(location).toBe("/project/project-1/latest");
  });

  it("leaves onboarding and projects untouched when the file chooser is cancelled", async () => {
    const { onComplete } = await mount();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(recorded).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();
    expect(location).toBe("/");
  });

  it("retries an import failure in the already-created project without completing early", async () => {
    actions.importCsv.mockRejectedValueOnce({
      actionMessage: "CSV import failed",
    });
    const { onComplete } = await mount();
    await selectCsv();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "CSV import failed",
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(location).toBe("/");
    await click("Try again");
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.importCsv).toHaveBeenCalledTimes(2);
    expect(actions.upload).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(location).toBe("/project/project-1/latest");
  });

  it("retains the sample project when onboarding completion fails and reuses it on retry", async () => {
    const onComplete = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce({ actionMessage: "Completion failed" })
      .mockResolvedValue(true);
    await mount(onComplete);
    await click("orders");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Completion failed",
    );
    expect(location).toBe("/");
    await click("Try again");
    expect(actions.create).toHaveBeenCalledExactlyOnceWith({
      title: "orders",
      sampleDataset: "orders",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(location).toBe("/project/project-1/latest");
  });

  it("retains a completed CSV import when onboarding completion fails", async () => {
    const onComplete = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce({ actionMessage: "Completion failed" })
      .mockResolvedValue(true);
    await mount(onComplete);
    await selectCsv();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Completion failed",
    );
    expect(location).toBe("/");
    await click("Try again");
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.importCsv).toHaveBeenCalledTimes(1);
    expect(actions.upload).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(location).toBe("/project/project-1/latest");
  });

  it("keeps onboarding open when completion explicitly returns false", async () => {
    const onComplete = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    await mount(onComplete);
    await click("orders");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not finish setup",
    );
    expect(location).toBe("/");
    await click("Try again");
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(location).toBe("/project/project-1/latest");
  });

  it("reports a failed Skip and only leaves onboarding after a successful retry", async () => {
    const onComplete = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce({ actionMessage: "Completion failed" })
      .mockResolvedValue(true);
    const onSkip = vi.fn();
    await mount(onComplete, onSkip);
    await click("Skip");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Completion failed",
    );
    expect(onSkip).not.toHaveBeenCalled();
    await click("Try again");
    expect(onSkip).toHaveBeenCalledOnce();
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("shows a creation error and retries the same chosen sample", async () => {
    actions.create.mockRejectedValueOnce({ actionMessage: "Creation failed" });
    await mount();
    await click("orders");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Creation failed",
    );
    expect(location).toBe("/");
    await click("Try again");
    const [first, second] = actions.create.mock.calls.map(([input]) => input);
    expect(first).toMatchObject({ title: "orders", sampleDataset: "orders" });
    expect(second.requestId).toBe(first.requestId);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(location).toBe("/project/project-1/latest");
  });

  it("excludes the sr-only file input from keyboard tab order", async () => {
    await mount();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus to the error alert when a choice fails", async () => {
    actions.create.mockRejectedValueOnce({ actionMessage: "Creation failed" });
    await mount();
    await click("orders");
    const alert = host.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(document.activeElement).toBe(alert);
  });

  it("reuses the existing project when the same CSV file is re-selected via the file picker after a failure", async () => {
    actions.importCsv.mockRejectedValueOnce({
      actionMessage: "CSV import failed",
    });
    await mount();
    await selectCsv();
    expect(actions.create).toHaveBeenCalledTimes(1);
    await selectCsv();
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.upload).toHaveBeenCalledTimes(1);
    expect(actions.importCsv).toHaveBeenCalledTimes(2);
    expect(location).toBe("/project/project-1/latest");
  });

  it("cleans up an orphaned incomplete CSV project when switching to another choice", async () => {
    actions.upload.mockRejectedValueOnce({ actionMessage: "Upload failed" });
    actions.create
      .mockResolvedValueOnce({
        id: "orphan-csv-project",
        href: "/project/orphan-csv-project/latest",
      })
      .mockResolvedValueOnce({
        id: "sample-project",
        href: "/project/sample-project/latest",
      });
    await mount();
    await selectCsv();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Upload failed",
    );
    await click("orders");
    expect(actions.deleteProject).toHaveBeenCalledWith({
      projectId: "orphan-csv-project",
    });
    expect(location).toBe("/project/sample-project/latest");
  });

  it("creates an untitled project for a file named only .csv instead of an empty title", async () => {
    await mount();
    await selectCsv(".csv");
    expect(actions.create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(location).toBe("/project/project-1/latest");
  });

  it("caps a very long file name at the project title limit so the project still opens", async () => {
    await mount();
    await selectCsv(`${"é".repeat(600)}.csv`);
    const title = (actions.create.mock.calls[0]?.[0] as { title: string })
      .title;
    expect([...title]).toHaveLength(500);
    expect(location).toBe("/project/project-1/latest");
  });

  it("trims spaces around the file name before using it as the title", async () => {
    await mount();
    await selectCsv("  quarterly numbers  .csv");
    expect(actions.create.mock.calls[0]?.[0]).toMatchObject({
      title: "quarterly numbers",
    });
  });

  it("removes the abandoned sample project when another sample is opened after a failed completion", async () => {
    const onComplete = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce({ actionMessage: "Completion failed" })
      .mockResolvedValue(true);
    actions.create
      .mockResolvedValueOnce({
        id: "orders-project",
        href: "/project/orders-project/latest",
      })
      .mockResolvedValueOnce({
        id: "customers-project",
        href: "/project/customers-project/latest",
      });
    await mount(onComplete);
    await click("orders");
    await click("customers");
    expect(actions.deleteProject).toHaveBeenCalledExactlyOnceWith({
      projectId: "orders-project",
    });
    expect(location).toBe("/project/customers-project/latest");
  });
});
