// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: { nativeShaderPreview: null as unknown },
  isError: false,
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => undefined,
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
  useActionQuery: () => ({
    data: mocks.data,
    isError: mocks.isError,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      role="switch"
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
}));

import { EditorShaderPreferencesTab } from "./EditorShaderPreferencesTab";

describe("editor shader preferences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.data = { nativeShaderPreview: null };
    mocks.isError = false;
    mocks.mutateAsync.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("acknowledges an editor-only override before persistence completes", async () => {
    let finishMutation!: (value: unknown) => void;
    mocks.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        finishMutation = resolve;
      }),
    );

    await act(async () => root.render(<EditorShaderPreferencesTab />));
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => toggle?.click());

    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      nativeShaderPreview: {
        quality: "auto",
        frameRateTarget: 60,
        colorMode: "srgb",
        dynamicRange: "sdr",
      },
    });

    await act(async () => finishMutation({ nativeShaderPreview: {} }));
  });

  it("rolls an optimistic editor preference back when persistence fails", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<EditorShaderPreferencesTab />));
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]');

    await act(async () => toggle?.click());

    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "settings.editorPreferencesSaveFailed",
    );
  });

  it("keeps live diagnostics in a deliberate disclosure with an honest boundary", async () => {
    await act(async () => root.render(<EditorShaderPreferencesTab />));
    const disclosure = container.querySelector<HTMLDetailsElement>("details");

    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector("summary")?.textContent).toBe(
      "settings.editorPreviewDiagnostics",
    );
    expect(disclosure?.textContent).toContain(
      "settings.editorPreviewDiagnosticsUnavailable",
    );
  });

  it("reuses the same controls in the editor while replacing only the unavailable Settings disclosure", async () => {
    await act(async () =>
      root.render(
        <EditorShaderPreferencesTab
          liveDiagnostics={<p>Actual mounted screen diagnostics</p>}
        />,
      ),
    );
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
    expect(container.querySelector("details")?.textContent).toContain(
      "Actual mounted screen diagnostics",
    );
    expect(container.querySelector("details")?.textContent).not.toContain(
      "settings.editorPreviewDiagnosticsUnavailable",
    );
  });
});
