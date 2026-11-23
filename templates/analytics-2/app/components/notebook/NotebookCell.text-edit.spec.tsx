// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellSchema } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function press(target: HTMLElement, key: string) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

it("shows an editable text cell as a textbox named Edit <title> that holds the saved text", async () => {
  const original = "Notebook persistence 123";
  const cell = cellSchema.parse({
    id: "cell",
    projectId: "project",
    versionId: "draft",
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    contents: {
      id: "cell",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "text",
      text: original,
    },
  });
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <NotebookCell
          lineNumbers
          cell={cell}
          title="Text 1"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId={null}
          draftText={original}
          dirty={false}
          stale={false}
          outputState={undefined}
          error={null}
          onTextChange={() => {}}
          onSaveDraft={() => {}}
          onRun={() => {}}
          onDiscard={() => {}}
          onOverwrite={() => {}}
          onDelete={() => {}}
          onSelectConnection={() => {}}
          onDismissError={() => {}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const box = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Edit Text 1"]',
  );
  assert(box);
  expect(box.value).toBe(original);
});
