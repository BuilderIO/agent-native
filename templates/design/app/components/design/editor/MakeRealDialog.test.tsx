// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MakeRealDialog } from "./MakeRealDialog";

const mocks = vi.hoisted(() => ({
  session: null as { email: string } | null,
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: mocks.session }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  useBuilderConnectFlow: () => ({
    error: null,
    connecting: false,
  }),
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@agent-native/core/shared", () => ({
  withBuilderUtmTrackingParams: (url: string) => url,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <label {...props}>{children}</label>,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

describe("MakeRealDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.session = null;
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    vi.unstubAllGlobals();
  });

  async function renderDialog(
    props: Partial<Parameters<typeof MakeRealDialog>[0]> = {},
  ) {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <MakeRealDialog
          open
          onOpenChange={onOpenChange}
          result={null}
          pending={false}
          onConfirm={onConfirm}
          {...props}
        />,
      );
    });
    return { onOpenChange, onConfirm };
  }

  it("shows a waitlist form for non-@builder.io users", async () => {
    mocks.session = { email: "reader@example.com" };
    const { onConfirm } = await renderDialog();

    expect(host.textContent).toContain("Make this a real app");
    expect(host.textContent).toContain("Join the waitlist for early access");
    expect(host.textContent).toContain("Join waitlist");
    expect(host.textContent).not.toContain("Start migration");
    expect(host.textContent).not.toContain("What happens:");

    const emailInput = host.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement | null;
    expect(emailInput?.value).toBe("reader@example.com");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the lean migration confirm for @builder.io users", async () => {
    mocks.session = { email: "Steve@Builder.io" };
    const { onConfirm } = await renderDialog();

    expect(host.textContent).toContain("Make this a real app");
    expect(host.textContent).toContain(
      "Export this design as a full React + Tailwind app",
    );
    expect(host.textContent).toContain("Start migration");
    expect(host.textContent).not.toContain("What happens:");
    expect(host.textContent).not.toContain("Join waitlist");

    const startButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Start migration"),
    );
    expect(startButton).toBeTruthy();
    await act(async () => {
      startButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("submits the waitlist and shows confirmation", async () => {
    mocks.session = { email: "reader@example.com" };
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ formSubmitted: true }),
    });
    await renderDialog();

    const form = host.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/_agent-native/builder/branch-waitlist");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "reader@example.com",
      pageUrl: window.location.href,
      useCase: "design_make_real_waitlist",
      source: "design_make_real_dialog",
    });
    expect(host.textContent).toContain("You're on the waitlist");
    expect(host.textContent).toContain("We'll email you when access opens.");
  });

  it("keeps the migration-started state compact", async () => {
    mocks.session = { email: "dev@builder.io" };
    await renderDialog({
      result: {
        status: "processing",
        branchName: "design-migration-abc",
        url: "https://builder.io/app/xyz",
        seedFileCount: 4,
      },
    });

    expect(host.textContent).toContain("Migration started");
    expect(host.textContent).toContain("design-migration-abc");
    expect(host.textContent).toContain("Open in Builder");
    expect(host.textContent).not.toContain("design file");
    expect(host.textContent).not.toContain("restorable snapshot");
  });
});
