import {
  AgentNativeI18nProvider,
  useLocale,
  useT,
} from "@agent-native/core/client/i18n";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { toast, Toaster } from "sonner";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import { putRecordingBackupMeta } from "@/lib/recording-backup";
import { FakeLockManager } from "@/lib/testing/fake-lock-manager";

import {
  offerLocalRecording,
  useLocalRecordingRecovery,
} from "../use-local-recording-recovery";

const toastId = "clips-local-recording-recovery";
export const english = "A recording hasn't finished uploading";
export const spanish = "Una grabación no ha terminado de subirse";

function Watcher() {
  useLocalRecordingRecovery();
  return null;
}

function Probe() {
  const { setPreference } = useLocale();
  const t = useT();
  const oldT = useRef(t);
  const [watching, setWatching] = useState(true);
  return (
    <>
      {watching && <Watcher />}
      <button onClick={() => void setPreference("es-ES")}>
        Change language
      </button>
      <button onClick={() => setWatching(false)}>Unmount watcher</button>
      <button
        onClick={() =>
          offerLocalRecording({
            meta: { recordingId: "unfinished", ownerEmail: null },
            t: oldT.current,
            navigate: () => {},
          })
        }
      >
        Offer from recorder
      </button>
    </>
  );
}

export function renderedToast() {
  return document.querySelector<HTMLElement>("[data-sonner-toast]");
}

export function expectToast(title: string, action: string, cancel: string) {
  const current = renderedToast();
  expect(current?.querySelector("[data-title]")?.textContent).toBe(title);
  expect(current?.querySelector("[data-action]")?.textContent).toBe(action);
  expect(current?.querySelector("[data-cancel]")?.textContent).toBe(cancel);
}

export function setupRecoveryLocale() {
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

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    toast.dismiss(toastId);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(initialLocale: "en-US" | "es-ES" = "en-US") {
    const gate = {
      release: (): void => {
        throw new Error("Locale gate was not initialized");
      },
    };
    const waiting = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const catalog = {
      ...i18nCatalog,
      loadMessages: async (
        locale: Parameters<typeof i18nCatalog.loadMessages>[0],
      ) => {
        if (locale === "es-ES") await waiting;
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
            <Toaster />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() =>
      expectToast(english, "Finish upload", "Remind me tomorrow"),
    );
    return gate.release;
  }

  async function switchToSpanish(release: () => void) {
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Change language")
        ?.click();
      release();
    });
  }

  return { mount, switchToSpanish, getContainer: () => container };
}
