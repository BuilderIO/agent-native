// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadCoreMessagesForLocaleMock = vi.hoisted(() => vi.fn());

vi.mock("../localization/core-messages.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../localization/core-messages.js")>();
  return {
    ...actual,
    loadCoreMessagesForLocale: loadCoreMessagesForLocaleMock,
  };
});

import {
  AgentNativeI18nProvider,
  type AgentNativeI18nCatalog,
  useLocale,
  useT,
} from "./i18n.js";

function LocaleProbe() {
  const { locale } = useLocale();
  const t = useT();
  return (
    <span>
      {locale}:{t("greeting")}
    </span>
  );
}

describe("AgentNativeI18nProvider locale loading", () => {
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
    vi.restoreAllMocks();
  });

  it("falls back to the source locale when supplemental messages fail to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadCoreMessagesForLocaleMock.mockRejectedValue(
      new Error("supplemental locale chunk failed"),
    );
    const catalog: AgentNativeI18nCatalog = {
      sourceLocale: "en-US",
      messages: { greeting: "Hello" },
      supportedLocales: ["en-US", "es-ES"],
      loadMessages: async () => ({ greeting: "Hola" }),
    };

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={catalog}
          initialLocale="es-ES"
          initialPreference="es-ES"
          persistPreference={false}
        >
          <LocaleProbe />
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toBe("en-US:Hello"));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("falling back to en-US"),
      expect.objectContaining({ message: "supplemental locale chunk failed" }),
    );
  });
});
