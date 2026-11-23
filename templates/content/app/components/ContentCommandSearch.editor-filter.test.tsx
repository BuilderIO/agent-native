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
  hasMore: false,
  queries: [] as string[],
  loadMore: () => {},
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/sharing", async (importOriginal) => ({
  ...(await importOriginal()),
  useShareOrgMemberSearch: (query: string) => {
    memberSearch.queries.push(query);
    return {
      members: memberSearch.members,
      isLoading: false,
      isLoadingMore: false,
      hasMore: memberSearch.hasMore,
      error: memberSearch.error,
      loadMore: memberSearch.loadMore,
    };
  },
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
    memberSearch.hasMore = false;
    memberSearch.queries = [];
    memberSearch.loadMore = () => {};
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
        >
          {null}
        </CommandMenu>,
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
    expect(memberSearch.queries[memberSearch.queries.length - 1]).toBe("Alice");
    expect(optionTexts()).toEqual([
      "Alice SmithASmith@example.com",
      "Bo Leebo@example.com",
    ]);
  });

  it("offers the next page of people when the first page isn't all of them", async () => {
    memberSearch.members = [{ email: "bo@example.com", name: "Bo Lee" }];
    memberSearch.hasMore = true;
    const loadMore = vi.fn();
    memberSearch.loadMore = loadMore;
    const { onChange } = await openPicker();

    const options = optionTexts();
    expect(options[options.length - 1]).toBe("root.searchMorePeople");
    const more = Array.from(
      pickerDialog().querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent === "root.searchMorePeople");
    await act(async () => more?.click());
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(pickerDialog()).toBeTruthy();
  });

  it("keeps Load more after a later page fails, so it can try again", async () => {
    memberSearch.members = [{ email: "bo@example.com", name: "Bo Lee" }];
    memberSearch.hasMore = true;
    memberSearch.error = new Error("Could not load people");
    await openPicker();

    expect(pickerDialog().querySelector('[role="alert"]')).not.toBeNull();
    const options = optionTexts();
    expect(options[options.length - 1]).toBe("root.searchMorePeople");
  });

  it("reports a failed lookup without calling it empty, and still takes a typed email", async () => {
    memberSearch.error = new Error("Could not load people");
    const { onChange } = await openPicker();

    await typePeopleSearch("Sam");
    expect(pickerDialog().querySelector('[role="alert"]')?.textContent).toBe(
      "root.searchPeopleUnavailable",
    );
    expect(pickerDialog().textContent).not.toContain("root.searchNoPeople");

    await typePeopleSearch("sam@example");
    expect(optionTexts()).toEqual([]);

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
