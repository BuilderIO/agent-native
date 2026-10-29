import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nextStepBar = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  FirstOutputNextStepBar: (props: unknown) => {
    nextStepBar(props);
    return <div data-first-output-next-step="true" />;
  },
}));

import { DesignFirstOutputNextStep } from "./first-output-next-step.js";

describe("Design first-output next steps", () => {
  it("does not show export or share actions when their event listener is absent", () => {
    const markup = renderToStaticMarkup(
      <DesignFirstOutputNextStep
        outputId="design-1"
        generationActive={false}
        outputReady
        actionsAvailable={false}
        labels={{
          ariaLabel: "Next steps",
          refineWithPrompt: "Refine with a prompt",
          export: "Export",
          shareLink: "Share link",
          dismiss: "Dismiss",
        }}
        onRefine={vi.fn()}
        onExport={vi.fn()}
        onShareLink={vi.fn()}
      />,
    );

    expect(markup).toBe("");
    expect(nextStepBar).not.toHaveBeenCalled();
  });
});
