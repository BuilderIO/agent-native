// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type RegenerateTranscriptRequest,
  useRegenerateTranscript,
} from "./regenerate-transcript";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

function Harness({
  importId,
  request,
}: {
  importId: string | null;
  request: (args: RegenerateTranscriptRequest) => void;
}) {
  const { regenerate, dialog } = useRegenerateTranscript(importId, request);
  return (
    <>
      <button type="button" onClick={() => regenerate("rec_1")}>
        regenerate
      </button>
      {dialog}
    </>
  );
}

describe("useRegenerateTranscript", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(importId: string | null) {
    const request = vi.fn();
    act(() => root.render(<Harness importId={importId} request={request} />));
    return request;
  }

  const click = (label: string) =>
    act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === label)!
        .click(),
    );

  it("regenerates an automatic transcript without asking, keeping any newer import", async () => {
    const request = render(null);

    await click("regenerate");

    expect(request).toHaveBeenCalledWith({
      recordingId: "rec_1",
      replaceImportId: null,
    });
    expect(document.body.textContent).not.toContain(
      "transcriptImport.regenerateOverImportTitle",
    );
  });

  it("asks before replacing an imported transcript, then names that import", async () => {
    const request = render("import-1");

    await click("regenerate");
    expect(request).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "transcriptImport.regenerateOverImportTitle",
    );

    await click("transcriptPanel.regenerate");
    expect(request).toHaveBeenCalledWith({
      recordingId: "rec_1",
      replaceImportId: "import-1",
    });
  });

  it("leaves an imported transcript alone when the user cancels", async () => {
    const request = render("import-1");

    await click("regenerate");
    await click("common.cancel");

    expect(request).not.toHaveBeenCalled();
  });
});
