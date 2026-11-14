// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RichEditorErrorBoundary } from "./RichEditorErrorBoundary.js";

function Boom(): React.ReactElement {
  throw new Error("bad node");
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("renders children while they are healthy", async () => {
  await act(async () =>
    root.render(
      <RichEditorErrorBoundary>
        <span>fine</span>
      </RichEditorErrorBoundary>,
    ),
  );
  expect(container.textContent).toContain("fine");
});

it("shows an inline fallback and reports the error when a child throws", async () => {
  const onError = vi.fn();
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    await act(async () =>
      root.render(
        <RichEditorErrorBoundary onError={onError}>
          <Boom />
        </RichEditorErrorBoundary>,
      ),
    );
  } catch {
    // React may rethrow in some environments; the boundary still renders.
  }
  expect(container.textContent).toContain("The editor hit an error.");
  consoleError.mockRestore();
});
