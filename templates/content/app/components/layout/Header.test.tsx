// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messagesByLocale } from "@/i18n-data";
import { renderUi } from "@/test-utils/render-ui";

import { Header } from "./Header";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => {
    const [section = "", name = ""] = key.split(".");
    const messages = messagesByLocale["en-US"] as unknown as Record<
      string,
      Record<string, string> | undefined
    >;
    return messages[section]?.[name] ?? key;
  },
}));

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

function headingAt(path: string) {
  const { container } = renderUi(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>,
  );
  return container.querySelector("h1")?.textContent;
}

describe("Header", () => {
  it("titles the Trash page Trash, not the app's name", () => {
    expect(headingAt("/trash")).toBe("Trash");
  });

  it("keeps the app's name on the home route", () => {
    expect(headingAt("/")).toBe("Content");
  });
});
