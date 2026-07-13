// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  appBasePath: () => "/design",
  PromptComposer: ({ actionButton }: { actionButton?: React.ReactNode }) => (
    <div data-testid="prompt-composer">{actionButton}</div>
  ),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/embedding/react", () => ({
  EmbeddedApp: () => null,
}));

vi.mock("@/components/design/DesignThumbnail", () => ({
  DesignThumbnail: () => <div data-testid="design-thumbnail" />,
}));

vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogTitle: Container,
  };
});

vi.mock("@/components/ui/popover", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: Container,
    PopoverAnchor: Container,
    PopoverContent: Container,
    PopoverTrigger: Container,
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Tooltip: Container,
    TooltipContent: Container,
    TooltipTrigger: Container,
  };
});

import PromptPopover from "./PromptDialog";

const mountedRoots: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

async function renderPrompt(
  canSubmitWithoutPrompt: boolean,
  onSubmit = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });

  await act(async () => {
    root.render(
      <PromptPopover
        open
        centered
        title="New design"
        canSubmitWithoutPrompt={canSubmitWithoutPrompt}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
  });

  return { container, onSubmit };
}

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("PromptPopover template submission", () => {
  it("submits an empty prompt when the selected template can render directly", async () => {
    const { container, onSubmit } = await renderPrompt(true);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="home.useTemplate"]',
    );

    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(onSubmit).toHaveBeenCalledWith("", [], {});
  });

  it("does not expose empty submission for templates that still need a prompt", async () => {
    const { container, onSubmit } = await renderPrompt(false);

    expect(
      container.querySelector('button[aria-label="home.useTemplate"]'),
    ).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
