// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PromptPopover from "./PromptDialog";

interface ComposerStubProps {
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
  onSubmit: (
    text: string,
    files: File[],
    references: unknown[],
    options: Record<string, unknown>,
  ) => void;
}

vi.mock("@agent-native/core/client", () => ({
  appBasePath: () => "",
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  PromptComposer: (props: ComposerStubProps) => (
    <div
      data-testid="prompt-composer"
      data-draft-scope={props.draftScope ?? ""}
      data-initial-text={props.initialText ?? ""}
      data-initial-text-key={String(props.initialTextKey ?? "")}
    >
      <button
        type="button"
        data-testid="composer-submit"
        onClick={() => props.onSubmit("hello world", [], [], {})}
      >
        submit
      </button>
    </div>
  ),
}));

vi.mock("@agent-native/core/embedding/react", () => ({
  EmbeddedApp: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: unknown }) =>
    open ? <div>{children as never}</div> : null,
  DialogContent: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
  DialogTitle: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: unknown }) =>
    open ? <div>{children as never}</div> : null,
  PopoverAnchor: ({ children }: { children?: unknown }) => (
    <>{children as never}</>
  ),
  PopoverContent: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
  PopoverTrigger: ({ children }: { children: unknown }) => (
    <>{children as never}</>
  ),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

let cleanup: (() => Promise<void>) | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  root = undefined;
  container = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  toastError.mockClear();
});

async function renderPopover(props: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cleanup = async () => {
    await act(async () => root?.unmount());
    container?.remove();
  };
  await act(async () => {
    root!.render(
      <PromptPopover
        open
        onOpenChange={() => {}}
        title="Generate design"
        onSubmit={() => {}}
        {...props}
      />,
    );
  });
}

describe("PromptPopover draft isolation", () => {
  it("scopes the composer draft key to this popover's title by default", async () => {
    await renderPopover({ title: "Tweak design" });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).toBe("Tweak design");
  });

  it("prefers an explicit draftScope over the title default", async () => {
    await renderPopover({
      title: "Generate design",
      draftScope: "design:abc123:generate",
    });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).toBe(
      "design:abc123:generate",
    );
  });
});

describe("PromptPopover submit failure recovery", () => {
  it("restores the typed prompt into the composer instead of losing it when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network down"));
    await renderPopover({ onSubmit });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
    });
    // Let the async handleSubmit's rejection settle and re-render.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("network down");

    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    // The composer optimistically clears its own text as soon as onSubmit is
    // invoked, so the popover must feed the failed prompt back in via
    // `initialText`/`initialTextKey` rather than let it vanish.
    expect(composer?.getAttribute("data-initial-text")).toBe("hello world");
    expect(composer?.getAttribute("data-initial-text-key")).not.toBe("");
    expect(composer?.getAttribute("data-initial-text-key")).not.toBe("0");
  });

  it("does not surface a restore when onSubmit succeeds", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderPopover({ onSubmit });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalled();
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-initial-text")).toBe("");
  });
});

describe("PromptPopover skip affordance", () => {
  it("falls back to the localized skip label when the caller doesn't pass one", async () => {
    await renderPopover({ onSkip: vi.fn() });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "promptDialog.skipPrompt",
    );
    expect(skipButton).toBeTruthy();
  });

  it("uses an explicit skipLabel over the localized default", async () => {
    await renderPopover({ onSkip: vi.fn(), skipLabel: "Not now" });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Not now",
    );
    expect(skipButton).toBeTruthy();
  });

  it("fires once and closes once after an async skip succeeds", async () => {
    let resolveSkip: (() => void) | undefined;
    const onSkip = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSkip = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    await renderPopover({ onSkip, onOpenChange });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "promptDialog.skipPrompt",
    );

    await act(async () => {
      skipButton?.click();
      skipButton?.click();
      await Promise.resolve();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveSkip?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and allows retry when an async skip fails", async () => {
    const onSkip = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    await renderPopover({ onSkip, onOpenChange });
    const findSkipButton = () =>
      Array.from(container!.querySelectorAll("button")).find(
        (btn) => btn.textContent === "promptDialog.skipPrompt",
      );

    await act(async () => {
      findSkipButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(findSkipButton()?.disabled).toBe(false);
    expect(
      container!.querySelector('[data-testid="prompt-composer"]'),
    ).toBeTruthy();

    await act(async () => {
      findSkipButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSkip).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
