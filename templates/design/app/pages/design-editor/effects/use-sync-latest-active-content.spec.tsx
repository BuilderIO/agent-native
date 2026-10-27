// @vitest-environment happy-dom

import { act, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { useSyncLatestActiveContent } from "./sync-latest-active-content";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const html = (body: string) => `<html><body>${body}</body></html>`;

function Probe({
  activeContent,
  latestActiveContentRef,
  readsDuringRender,
}: {
  activeContent: string;
  latestActiveContentRef: MutableRefObject<string | null>;
  readsDuringRender: Array<string | null>;
}) {
  useSyncLatestActiveContent({
    activeContent,
    activeFile: { id: "screen-1", fileType: "text" },
    latestActiveContentRef,
    pendingLocalFileContents: new Map(),
  });
  // Screens resolve their content while rendering, before any effect runs.
  readsDuringRender.push(latestActiveContentRef.current);
  return null;
}

it("hands screens a collaborator's newly saved content in the same render, not one render later", async () => {
  const latestActiveContentRef = { current: null as string | null };
  const readsDuringRender: Array<string | null> = [];
  const mine = html("mine");
  const theirs = html("theirs");
  const root = createRoot(document.createElement("div"));
  const render = (activeContent: string) =>
    act(async () =>
      root.render(
        <Probe
          activeContent={activeContent}
          latestActiveContentRef={latestActiveContentRef}
          readsDuringRender={readsDuringRender}
        />,
      ),
    );

  await render(mine);
  readsDuringRender.length = 0;
  await render(theirs);

  expect(readsDuringRender[0]).toBe(theirs);
  await act(async () => root.unmount());
});
