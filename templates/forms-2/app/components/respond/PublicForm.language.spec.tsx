// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seen: [] as string[],
  seenPreferences: [] as string[],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  AgentNativeI18nProvider: (props: {
    initialLocale?: string;
    initialPreference?: string;
    initialMessages?: unknown;
    persistPreference?: boolean;
    children?: unknown;
  }) => {
    mocks.seenPreferences.push(String(props.initialPreference));
    mocks.seen.push(
      `${props.initialLocale}|${String(props.persistPreference)}|${props.initialMessages ? "yes" : "no"}`,
    );
    return <div>{props.children as never}</div>;
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: undefined,
    error: null,
    isLoading: true,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({ mutate: vi.fn() }),
  useSession: () => ({ session: null }),
}));
vi.mock("@/i18n", () => ({
  i18nCatalog: { namespace: "forms" },
  shippedLocaleCodes: ["en-US", "de-DE"],
  resolveShippedLocale: (code: string) =>
    code === "de" || code === "de-DE" ? "de-DE" : null,
  loadLocaleMessages: async (code: string) =>
    code === "de-DE" ? { forms: { respond: { submit: "Absenden" } } } : null,
}));
vi.mock("./states", () => ({
  ClosedState: () => null,
  FormSkeleton: () => null,
  LoadErrorState: () => null,
  UnavailableState: () => null,
}));
vi.mock("./FormRunner", () => ({ FormRunner: () => <div>runner</div> }));
vi.mock("./PasswordGate", () => ({ PasswordGate: () => null }));
vi.mock("./respond-storage", () => ({
  rememberPassword: vi.fn(),
  respondentId: () => "r",
  sessionIdFor: () => "s",
}));
vi.mock("./track-events", () => ({ useTrackEvents: () => null }));

import { FormLanguage } from "./PublicForm";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  mocks.seen.length = 0;
  mocks.seenPreferences.length = 0;
});

function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}

describe("form language", () => {
  it("takes a stored language code and the locale the provider ships", () => {
    render(
      <FormLanguage language="de">
        <span>body</span>
      </FormLanguage>,
    );
    expect(mocks.seen[mocks.seen.length - 1]).toBe("de-DE|false|no");
  });

  it("renders the respondent surface in the form's own language, without persisting it", () => {
    const host = render(
      <FormLanguage language="de-DE">
        <span>body</span>
      </FormLanguage>,
    );
    expect(host.textContent).toContain("body");
    expect(mocks.seen[mocks.seen.length - 1]).toBe("de-DE|false|no");
    // The scoped provider pins the preference too, or it re-resolves the locale from
    // the author's browser language once it mounts.
    expect(mocks.seenPreferences[mocks.seenPreferences.length - 1]).toBe(
      "de-DE",
    );
  });

  it("passes the locale's own messages once they arrive", async () => {
    const host = render(
      <FormLanguage language="de-DE">
        <span>body</span>
      </FormLanguage>,
    );
    await vi.waitFor(() =>
      expect(mocks.seen[mocks.seen.length - 1]).toBe("de-DE|false|yes"),
    );
    expect(host.textContent).toContain("body");
  });

  it("keeps the app language when the form names none", () => {
    const host = render(
      <FormLanguage>
        <span>plain</span>
      </FormLanguage>,
    );
    expect(host.textContent).toContain("plain");
    expect(mocks.seen).toEqual([]);
  });
});
