// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RecordingEditorBoundary } from "./recording-editor-boundary";

describe("RecordingEditorBoundary", () => {
  it("resets editor state when the recording changes", () => {
    let mountCount = 0;
    function StatefulChild() {
      const [instance] = useState(() => ++mountCount);
      return <span>{instance}</span>;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <RecordingEditorBoundary recordingId="recording-a">
          <StatefulChild />
        </RecordingEditorBoundary>,
      );
    });
    expect(container.textContent).toBe("1");

    act(() => {
      root.render(
        <RecordingEditorBoundary recordingId="recording-b">
          <StatefulChild />
        </RecordingEditorBoundary>,
      );
    });
    expect(container.textContent).toBe("2");

    act(() => root.unmount());
  });
});
