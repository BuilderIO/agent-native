// @vitest-environment happy-dom

// The scoped provider itself, not a stand-in for it: a published form carries its own
// language, and a respondent must read the form in that language even though the
// author's interface (and the browser) are in English.

import { useT } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./states", () => ({
  ClosedState: () => null,
  FormSkeleton: () => null,
  LoadErrorState: () => null,
  UnavailableState: () => null,
}));
vi.mock("./FormRunner", () => ({
  FormRunner: (_props: {
    mode?: string;
    formId?: string;
    blocks?: unknown;
    settings?: unknown;
  }) => {
    const t = useT();
    return <span data-testid="submit">{t("forms.respond.submit")}</span>;
  },
}));
vi.mock("./PasswordGate", () => ({ PasswordGate: () => null }));
vi.mock("./respond-storage", () => ({
  rememberPassword: vi.fn(),
  respondentId: () => "r",
  sessionIdFor: () => "s",
}));
vi.mock("./track-events", () => ({ useTrackEvents: () => null }));

import { FormRunner } from "./FormRunner";
import { FormLanguage } from "./PublicForm";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function renderInEnglishBrowser(node: React.ReactElement) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["en-US"]);
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(node);
  });
  return host;
}

async function expectSubmitLabel(host: HTMLElement, expected: string) {
  // The locale's own chunk arrives after the first paint, so wait for the words
  // rather than for any text at all.
  await vi.waitFor(
    () => {
      const el = host.querySelector("[data-testid=submit]");
      expect(el?.textContent).toBe(expected);
    },
    { timeout: 8000 },
  );
}

describe("a published form's own language", () => {
  it("reads in the form's language when the author's interface is English", async () => {
    const host = await renderInEnglishBrowser(
      <FormLanguage language="de">
        <FormRunner mode="live" formId="f" blocks={[]} settings={{}} />
      </FormLanguage>,
    );
    await expectSubmitLabel(host, "Absenden");
  });

  it("accepts the locale the settings page stores for the same language", async () => {
    const host = await renderInEnglishBrowser(
      <FormLanguage language="de-DE">
        <FormRunner mode="live" formId="f" blocks={[]} settings={{}} />
      </FormLanguage>,
    );
    await expectSubmitLabel(host, "Absenden");
  });
});
