import { vi } from "vitest";

export interface PreferencesFixture {
  content: string;
  owner: string;
  revision: { id: string; updatedAt: number };
}

export function savedPreferences(content: string): PreferencesFixture {
  return {
    content,
    owner: "owner@example.test",
    revision: { id: "personal-guidance", updatedAt: 12 },
  };
}

/** What the mocked data hooks answer with; a test sets it before it mounts. */
export const preferences = {
  saved: savedPreferences("Use concise answers.") as
    | PreferencesFixture
    | undefined,
  isLoading: false,
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
  refetch: vi.fn(async () => undefined),
  reset() {
    this.saved = savedPreferences("Use concise answers.");
    this.isLoading = false;
    this.isError = false;
    this.isPending = false;
    this.mutateAsync.mockReset();
    this.mutateAsync.mockImplementation(async (input: { content: string }) => {
      this.saved = {
        ...savedPreferences(input.content),
        revision: { id: "personal-guidance", updatedAt: 13 },
      };
      return this.saved;
    });
    this.refetch.mockClear();
  },
};

export const preferencesHooksMock = {
  useActionQuery: (name?: string) =>
    name === "get-editor-preferences"
      ? {
          data: { lineNumbers: false, fullWidthCells: false },
          refetch: vi.fn(async () => ({ isError: false })),
          isLoading: false,
          isFetchedAfterMount: true,
          isError: false,
        }
      : {
          data: preferences.isLoading ? undefined : preferences.saved,
          refetch: preferences.refetch,
          isLoading: preferences.isLoading,
          isError: preferences.isError,
        },
  useActionMutation: () => ({
    mutateAsync: (...args: unknown[]) => preferences.mutateAsync(...args),
    isPending: preferences.isPending,
  }),
};

// The shared account controls are the toolkit's page; these suites are about the app's own row.
export const accountControlsMock = {
  PreferencesSettings: () => <div>Existing account controls</div>,
};
