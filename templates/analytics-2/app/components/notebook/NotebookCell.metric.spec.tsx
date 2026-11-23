// @vitest-environment happy-dom
import { strict as assert } from "node:assert";

import { useActionQuery } from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));

const source = { cellId: "producer", exportId: "result" };
const fields = [
  { fieldId: "month", name: "month", type: "datetime", nullable: false },
  { fieldId: "revenue", name: "revenue", type: "number", nullable: false },
];
const initialConfig = {
  version: 1,
  revision: 0,
  source,
  fieldId: null as string | null,
  mode: "aggregate",
  aggregation: null as string | null,
  row: 0,
  title: "",
  format: null as string | null,
};

const initialContents: Extract<Cell["contents"], { kind: "metric" }> = {
  id: "metric",
  kind: "metric",
  order: "a",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  valueVariableName: null,
  valueRowIndex: null,
  resultVariable: null,
  outputResult: false,
  format: null,
};
const initialCell = {
  id: "metric",
  projectId: "project",
  versionId: "version",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contents: { ...initialContents, metricConfig: initialConfig },
};
const noop = () => {};

it("edits typed Single value settings, shows projected values, and reopens saved settings", async () => {
  let stored = initialCell;
  const readRevisions = new Set<number>();
  const saveRevisions: { sent: string; expected: string }[] = [];
  const project = () => ({
    project: { id: stored.projectId, cells: [stored] },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.href);
    const action = url.pathname.split("/").at(-1);
    if (action === "get-actions-batch")
      return new Response(action, { status: 404 });
    if (action === "get-project") return Response.json(project());
    if (action === "get-notebook-transform") {
      const { aggregation, fieldId, mode, row, revision } =
        stored.contents.metricConfig;
      if (url.searchParams.get("expectedConfigRevision") !== String(revision))
        return Response.json({
          sources: [],
          result: { status: "stale", reason: "notebook_conflict" },
        });
      readRevisions.add(revision);
      const field =
        fields.find((item) => item.fieldId === fieldId) ?? fields[0];
      assert(field);
      const isNumber = field.type === "number";
      return Response.json({
        result: {
          status: "ready",
          kind: "metric",
          field,
          aggregation:
            mode === "row" ? null : (aggregation ?? (isNumber ? "sum" : "max")),
          value: isNumber
            ? mode === "row"
              ? row === -1
                ? 1450
                : 1200
              : aggregation === "average"
                ? 1375
                : 5500
            : "2026-04-01 00:00:00",
          source: { fields, completeness: "complete", rowCount: 4 },
        },
        sources: [
          { binding: { ...source, resultId: "result" }, name: "sales", fields },
        ],
      });
    }
    if (action === "save-project-cell") {
      assert(typeof init?.body === "string");
      const request = JSON.parse(init.body) as {
        contents: typeof stored.contents;
        expectedUpdatedAt: string;
      };
      saveRevisions.push({
        sent: request.expectedUpdatedAt,
        expected: stored.updatedAt,
      });
      stored = {
        ...stored,
        contents: request.contents,
        updatedAt: `2026-01-01T00:00:0${request.contents.metricConfig.revision}.000Z`,
      };
      return Response.json(project());
    }
    throw new Error(`Unexpected action: ${String(action)}`);
  });

  const host = document.createElement("div");
  document.body.append(host);
  const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let client = newClient();
  let root = createRoot(host);

  function Notebook() {
    const { data } = useActionQuery<{ project: { cells: Cell[] } }>(
      "get-project",
      { projectId: initialCell.projectId },
    );
    const cell = data?.project.cells[0];
    return cell ? (
      <NotebookCell
        cell={cell}
        title="Value 2"
        connections={[]}
        canEdit
        busy={false}
        running={false}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId={null}
        draftText=""
        dirty={false}
        stale={false}
        outputState={undefined}
        error={null}
        onTextChange={noop}
        onSaveDraft={noop}
        onRun={noop}
        onDiscard={noop}
        onOverwrite={noop}
        onDelete={noop}
        onSelectConnection={noop}
        onDismissError={noop}
      />
    ) : null;
  }

  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <Notebook />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );

  async function find<T extends HTMLElement>(
    selector: string,
    content?: string,
  ) {
    const result = await act(async () =>
      vi.waitFor(() => {
        const found = [...document.querySelectorAll<T>(selector)].find(
          (item) =>
            content === undefined || item.textContent.trim() === content,
        );
        assert(
          found,
          `Missing ${selector}${content ? ` containing ${content}` : ""}`,
        );
        return found;
      }),
    );
    assert(result);
    return result;
  }

  async function click(selector: string, content?: string) {
    const button = await find(selector, content);
    await act(async () => button.click());
  }

  async function key(element: HTMLElement, value: string) {
    await act(async () => {
      element.focus();
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  async function select(label: string, value: string) {
    await key(await find(`[role="combobox"][aria-label="${label}"]`), "Enter");
    await key(await find('[role="option"]', value), "Enter");
  }

  async function edit(label: string, value: string) {
    const input = await find<HTMLInputElement>(`input[aria-label="${label}"]`);
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setter);
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
  }

  async function shows(value: string) {
    await act(async () =>
      vi.waitFor(() => expect(host.textContent).toContain(value)),
    );
  }

  try {
    await render();
    await shows("2026-04-01 00:00:00");
    await click('button[aria-label="Single Value"]');
    await find('[role="combobox"][aria-label="Column"]', "month");
    await find('[role="combobox"][aria-label="Aggregate"]', "Max");
    await select("Column", "revenue");
    await shows("5,500");
    await find('[role="combobox"][aria-label="Aggregate"]', "Sum");
    await select("Aggregate", "Avg");
    await shows("1,375");
    await click("button", "Row");
    await shows("1,200");
    await edit("Row", "-1");
    await shows("1,450");
    await edit("Title", "Latest revenue");
    await shows("Latest revenue");
    await select("Format", "Currency");
    await shows("$1,450.00");
    expect(stored.contents.metricConfig).toMatchObject({
      fieldId: "revenue",
      mode: "row",
      row: -1,
      title: "Latest revenue",
      format: "currency",
    });

    await act(async () => root.unmount());
    client.clear();
    root = createRoot(host);
    client = newClient();
    await render();
    await shows("Latest revenue");
    await shows("$1,450.00");
    expect([...readRevisions]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(saveRevisions).toHaveLength(6);
    expect(saveRevisions.map(({ sent }) => sent)).toEqual(
      saveRevisions.map(({ expected }) => expected),
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
