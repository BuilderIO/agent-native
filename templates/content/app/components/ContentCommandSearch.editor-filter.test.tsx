// @vitest-environment happy-dom

import type { ShareOrgMember } from "@agent-native/core/client/sharing";
import { CommandMenu } from "@agent-native/toolkit/app/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorSearchChoice, type SearchEditor } from "./ContentCommandSearch";

const memberSearch = vi.hoisted(() => ({
  members: [] as ShareOrgMember[],
  error: null as Error | null,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/sharing", async (importOriginal) => ({
  ...(await importOriginal()),
  useShareOrgMemberSearch: () => ({
    members: memberSearch.members,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: memberSearch.error,
    loadMore: () => {},
  }),
}));

const ME = "asmith@example.com";

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`No ${what}`);
  return value;
}

describe("EditorSearchChoice", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    const mounted = root;
    if (mounted) await act(async () => mounted.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    memberSearch.members = [];
    memberSearch.error = null;
  });

  async function openPicker() {
    const onChange = vi.fn<(editor: SearchEditor | null) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () =>
      mounted.render(
        <CommandMenu
          open
          onOpenChange={() => {}}
          placeholder="Search query"
          inputLabel="Search query"
          showAgentFallback={false}
          renderContent={() => (
            <EditorSearchChoice
              value={null}
              currentUserEmail={ME}
              onChange={onChange}
              focusInput={() => {}}
            />
          )}
        />,
      ),
    );
    const trigger = required(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="root.searchEditor"]',
      ),
      "editor chip",
    );
    await act(async () => trigger.click());
    return { onChange };
  }

  async function typePeopleSearch(text: string) {
    const input = required(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="root.searchPeoplePlaceholder"]',
      ),
      "people search",
    );
    // Set the value the way typing does, so React sees the change.
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const pickerDialog = () =>
    required(
      document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="root.searchEditor"]',
      ),
      "people picker",
    );
  const optionTexts = () =>
    Array.from(pickerDialog().querySelectorAll('[role="option"]')).map(
      (option) => option.textContent,
    );

  it("lists the signed-in person among members when a search by name hides Me", async () => {
    memberSearch.members = [
      { email: "ASmith@example.com", name: "Alice Smith" },
      { email: "bo@example.com", name: "Bo Lee" },
    ];
    await openPicker();

    // With nothing typed, the Me row stands in for the signed-in person.
    expect(optionTexts()).toEqual([
      "root.searchAnyEditor",
      `root.searchMe${ME}`,
      "Bo Leebo@example.com",
    ]);

    await typePeopleSearch("Alice");
    expect(optionTexts()).toEqual([
      "Alice SmithASmith@example.com",
      "Bo Leebo@example.com",
    ]);
  });

  it("reports a failed lookup without calling it empty, and still takes a typed email", async () => {
    memberSearch.error = new Error("Could not load people");
    const { onChange } = await openPicker();

    await typePeopleSearch("Sam");
    expect(pickerDialog().querySelector('[role="alert"]')?.textContent).toBe(
      "root.searchPeopleUnavailable",
    );
    expect(pickerDialog().textContent).not.toContain("root.searchNoPeople");

    await typePeopleSearch("sam@example.com");
    expect(optionTexts()).toEqual(["sam@example.com"]);
    const typedEmail =
      pickerDialog().querySelector<HTMLElement>('[role="option"]');
    expect(typedEmail).not.toBeNull();
    await act(async () => typedEmail?.click());
    expect(onChange).toHaveBeenCalledWith({
      email: "sam@example.com",
      name: null,
    });
  });
});
