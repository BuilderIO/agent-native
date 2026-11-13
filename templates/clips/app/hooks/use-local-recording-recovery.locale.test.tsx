// @vitest-environment happy-dom

import {
  AgentNativeI18nProvider,
  useLocale,
  useT,
} from "@agent-native/core/client/i18n";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "me@example.com" } }),
}));

import { i18nCatalog } from "@/i18n";
import {
  claimRecordingBackupLock,
  putRecordingBackupMeta,
} from "@/lib/recording-backup";
import { FakeLockManager } from "@/lib/testing/fake-lock-manager";

import {
  findLocalRecordingsToFinish,
  useLocalRecordingRecovery,
} from "./use-local-recording-recovery";

const english = "A recording hasn't finished uploading";
const spanish = "Una grabación no ha terminado de subirse";
const toastId = "clips-local-recording-recovery";

function Probe() {
  const { setPreference } = useLocale();
  const t = useT();
  useLocalRecordingRecovery();
  return (
    <button type="button" onClick={() => void setPreference("es-ES")}>
      {t("recordRoute.unfinishedRecording")}
    </button>
  );
}

function recoveryToast() {
  return toast.getToasts().find((item) => item.id === toastId);
}

describe("recovery toast localization", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
      locks: new FakeLockManager(),
    });
    await putRecordingBackupMeta({
      recordingId: "unfinished",
      mimeType: "video/webm",
      durationMs: 4000,
      width: 1,
      height: 1,
      hasAudio: true,
      hasCamera: false,
      bytes: 4,
      chunkCount: 1,
      savedAt: "2026-10-01T10:00:00.000Z",
      completedAt: null,
      ownerEmail: "me@example.com",
      localOnly: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    toast.dismiss(toastId);
    vi.unstubAllGlobals();
  });

  async function mount(initialLocale: "en-US" | "es-ES") {
    const deferred = {
      release: () => {
        throw new Error("Locale load gate was not initialized");
      },
    };
    const gate = new Promise<void>((resolve) => {
      deferred.release = resolve;
    });
    const catalog = {
      ...i18nCatalog,
      loadMessages: async (
        locale: Parameters<typeof i18nCatalog.loadMessages>[0],
      ) => {
        if (locale === "es-ES") await gate;
        return i18nCatalog.loadMessages(locale);
      },
    };
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={catalog}
          initialLocale={initialLocale}
          initialPreference={initialLocale}
          persistPreference={false}
        >
          <MemoryRouter>
            <Probe />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() => expect(recoveryToast()?.title).toBe(english));
    return deferred.release;
  }

  async function expectSpanishToast() {
    await vi.waitFor(() => expect(container.textContent).toBe(spanish));
    await vi.waitFor(() => {
      expect(recoveryToast()).toMatchObject({
        title: spanish,
        action: { label: "Terminar la subida" },
        cancel: { label: "Recordármelo mañana" },
      });
    });
  }

  it("updates an existing prompt after changing the interface language", async () => {
    const release = await mount("en-US");
    await act(async () => {
      container.querySelector("button")?.click();
      release();
    });
    await expectSpanishToast();
  });

  it("updates a fallback prompt when the initial Spanish catalog finishes loading", async () => {
    const release = await mount("es-ES");
    await act(async () => release());
    await expectSpanishToast();
  });

  it.each([
    { initialLocale: "en-US" as const, trigger: "a language change" },
    { initialLocale: "es-ES" as const, trigger: "the initial catalog load" },
  ])(
    "does not leave an English prompt when a copy becomes active elsewhere before $trigger",
    async ({ initialLocale }) => {
      const release = await mount(initialLocale);
      const claim = await claimRecordingBackupLock("unfinished");
      expect(claim.status).toBe("held");
      if (claim.status !== "held")
        throw new Error("Could not hold recording lock");
      try {
        expect(
          (await findLocalRecordingsToFinish("me@example.com")).pending,
        ).toEqual([]);
        await act(async () => {
          if (initialLocale === "en-US")
            container.querySelector("button")?.click();
          release();
        });
        await vi.waitFor(() => expect(container.textContent).toBe(spanish));
        await vi.waitFor(() =>
          expect(recoveryToast()?.title ?? spanish).toBe(spanish),
        );
      } finally {
        claim.release();
      }
    },
  );
});
