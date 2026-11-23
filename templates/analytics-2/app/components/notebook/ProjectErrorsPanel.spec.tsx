// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { ProjectErrorsPanel } from "./ProjectErrorsPanel";

async function render(failedCount: number, onRerun = vi.fn()) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ProjectErrorsPanel failedCount={failedCount} onRerun={onRerun} />,
    ),
  );
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("offers Rerun app when cells failed and reruns the whole project", async () => {
  const onRerun = vi.fn();
  const { host, cleanup } = await render(2, onRerun);
  try {
    expect(host.textContent).toContain("publishedApp.projectErrors");
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("publishedApp.rerunApp");
    await act(async () => button?.click());
    expect(onRerun).toHaveBeenCalledTimes(1);
  } finally {
    await cleanup();
  }
});

it("renders nothing when no cell failed", async () => {
  const { host, cleanup } = await render(0);
  try {
    expect(host.innerHTML).toBe("");
  } finally {
    await cleanup();
  }
});
