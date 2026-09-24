import type { HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assistant-ui/react", () => ({
  ComposerPrimitive: {
    Root: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

import { AgentComposerFrame } from "./AgentComposerFrame.js";

describe("AgentComposerFrame", () => {
  it("does not turn the full composer border into the host focus ring", () => {
    const html = renderToStaticMarkup(
      <AgentComposerFrame>
        <span>Composer</span>
      </AgentComposerFrame>,
    );

    expect(html).toContain("border-input");
    expect(html).not.toContain("focus-within:border-ring");
  });
});
