// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VisualEditPage from "./VisualEdit";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

describe("VisualEditPage hydration", () => {
  it("hydrates the agent-first install handoff without account chrome", async () => {
    const html = renderToString(<VisualEditPage />);
    expect(html).not.toContain("/sign-in");
    expect(html).not.toContain("/home");
    expect(html).toContain(
      "npx @agent-native/core@latest skills add visual-edit",
    );

    container.innerHTML = html;
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <VisualEditPage />, {
        onRecoverableError: recoverableError,
      });
    });

    expect(recoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain("npx @agent-native/core@latest");
  });
});
