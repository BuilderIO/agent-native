import type { AgentKitController } from "@agent-native/agentkit/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useAgentKit } from "./context.js";
import { AgentKitRoot } from "./root.js";
import {
  workedForRowChevronStyle,
  workedForRowSummaryStyle,
} from "./transcript-layout.js";

function WorkedForLayoutProbe() {
  const { workedForRowLayout, formatWorkedForDuration } = useAgentKit();
  return createElement("span", {
    "data-icon-gap": workedForRowLayout?.iconGap,
    "data-duration": formatWorkedForDuration?.(16_000),
  });
}

describe("worked-for row layout", () => {
  it("applies shared dimensions to the summary and leading chevron", () => {
    const layout = {
      chevronSize: 12,
      iconGap: 8,
      fontSize: 13,
      lineHeight: 16,
      paddingBlock: 2,
      paddingInline: 4,
    };

    expect(workedForRowSummaryStyle(layout)).toEqual({
      gap: "8px",
      fontSize: "13px",
      lineHeight: "16px",
      paddingBlock: "2px",
      paddingInline: "4px",
      fontFamily: "inherit",
    });
    expect(workedForRowChevronStyle(layout)).toEqual({
      width: "12px",
      height: "12px",
    });
  });

  it("rejects invalid CSS dimensions", () => {
    expect(() => workedForRowSummaryStyle({ fontSize: 0 })).toThrow(
      "workedForRowLayout.fontSize must be a valid CSS length",
    );
  });

  it("carries the layout from the AgentKit root into shared context", () => {
    const layout = { iconGap: 8 };
    const formatWorkedForDuration = (durationMs: number) =>
      `${Math.round(durationMs / 1000)} seconds`;
    const markup = renderToStaticMarkup(
      createElement(
        AgentKitRoot,
        {
          controller: {} as AgentKitController,
          threadId: "thread",
          workedForRowLayout: layout,
          formatWorkedForDuration,
        },
        createElement(WorkedForLayoutProbe),
      ),
    );

    expect(markup).toContain('data-icon-gap="8"');
    expect(markup).toContain('data-duration="16 seconds"');
  });
});
