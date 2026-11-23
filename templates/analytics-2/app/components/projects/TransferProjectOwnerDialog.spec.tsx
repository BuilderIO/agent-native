// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import type { Project } from "@/lib/model/contracts";

const callAction = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));
vi.mock("sonner", () => ({ toast }));

import { TransferProjectOwnerDialog } from "./TransferProjectOwnerDialog";

const project = { id: "prj_1", title: "Funnel" } as Project;

function mount(onClose: () => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <QueryClientProvider client={new QueryClient()}>
          <TransferProjectOwnerDialog project={project} onClose={onClose} />
        </QueryClientProvider>
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  callAction.mockReset();
  toast.success.mockReset();
});

it("keeps Transfer disabled until the address is a valid email and focuses the field", () => {
  const { container, root } = mount(() => {});
  try {
    const input = container.querySelector("input") as HTMLInputElement;
    const confirm = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Transfer",
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(input);
    type(input, "not-an-email");
    expect(confirm.disabled).toBe(true);
    type(input, " qa-a@example.test ");
    expect(confirm.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("confirms a transfer with a toast and names a failed one plainly", async () => {
  const onClose = vi.fn();
  const { container, root } = mount(onClose);
  try {
    const input = container.querySelector("input") as HTMLInputElement;
    const confirm = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Transfer",
    ) as HTMLButtonElement;
    type(input, "qa-a@example.test");
    callAction.mockRejectedValueOnce(new Error("Something went wrong."));
    await act(async () => confirm.click());
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Failed to transfer ownership",
    );
    expect(onClose).not.toHaveBeenCalled();
    callAction.mockResolvedValueOnce({ id: "prj_1" });
    await act(async () => confirm.click());
    expect(toast.success).toHaveBeenCalledWith("Ownership transferred");
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
