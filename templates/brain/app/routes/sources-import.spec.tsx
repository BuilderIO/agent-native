// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ imported: vi.fn() }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "get-brain-admin-status"
        ? { isAdmin: true }
        : name === "list-sources"
          ? { sources: [] }
          : {},
    refetch: vi.fn(),
  }),
  useActionMutation: (name: string) => ({
    isPending: false,
    mutate: (
      _args: unknown,
      options: { onSuccess: (value: unknown) => void },
    ) => {
      if (name === "ensure-company-context-source")
        options.onSuccess({
          source: {
            id: "source-one",
            title: "Manual",
            provider: "manual",
            visibility: "private",
          },
        });
    },
    mutateAsync: async (args: unknown) => {
      if (name === "import-markdown-files") fixture.imported(args);
      return {
        files: [],
        summary: { imported: 1, queued: 0, failed: 0, blocked: 0 },
      };
    },
  }),
}));
import Sources from "./sources";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  fixture.imported.mockClear();
});
it("submits optional participant labels for each selected file", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(createElement(MemoryRouter, {}, createElement(Sources))),
  );
  const open = [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes("sources.companyContextUpload"),
  );
  expect(open).toBeDefined();
  await act(async () => open?.click());
  const inputs =
    document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const input = inputs.item(1);
  expect(input).toBeDefined();
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [
      new File(["Meeting text"], "meeting.md", { type: "text/plain" }),
      new File(["Other text"], "other.md", { type: "text/plain" }),
    ],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  const label = [...document.querySelectorAll("label")].find((entry) =>
    entry.textContent.includes("sources.importParticipants"),
  );
  const participants = label?.querySelector("input");
  expect(participants).toBeDefined();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(participants, "Avery, Jordan");
    participants?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = [...document.querySelectorAll("button")].find((button) =>
    button.textContent.includes("sources.importMarkdownFiles"),
  );
  expect(submit).toBeDefined();
  await act(async () => submit?.click());
  expect(fixture.imported).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceId: "source-one",
      files: [
        expect.objectContaining({
          path: "meeting.md",
          participants: ["Avery", "Jordan"],
        }),
        expect.objectContaining({ path: "other.md", content: "Other text" }),
      ],
    }),
  );
  expect(fixture.imported.mock.calls[0]?.[0].files[1]).not.toHaveProperty(
    "participants",
  );
});
