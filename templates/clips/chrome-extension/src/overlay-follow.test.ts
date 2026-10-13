import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips overlay follow permissions", () => {
  it("reconciles restored recording state and clears terminal saving overlays", () => {
    const backgroundSource = readFileSync(
      new URL("./background.ts", import.meta.url),
      "utf8",
    );
    const restoreStart = backgroundSource.indexOf(
      "async function restoreRuntimeState",
    );
    const restoreEnd = backgroundSource.indexOf(
      "\nfunction sendTabMessage",
      restoreStart,
    );
    const restoreSource = backgroundSource.slice(restoreStart, restoreEnd);

    expect(restoreSource).toContain(
      "await reconcilePersistedNativeRecording()",
    );
    expect(restoreSource).toContain("shouldClearTerminalSavingOverlay(");
    expect(restoreSource).toContain("await broadcastUnmount()");
    expect(restoreSource).toContain(
      "await finishSaving(\n      activeNativeRecording,\n      activeNativeRecording.recordingId,\n      true,\n    );",
    );
    expect(restoreSource).toContain('setActionPopup("src/popup.html")');

    const finishStart = backgroundSource.indexOf(
      "async function finishSaving(",
    );
    const finishEnd = backgroundSource.indexOf(
      "\nasync function stopRecording",
      finishStart,
    );
    const finishSource = backgroundSource.slice(finishStart, finishEnd);
    expect(finishSource).toContain(
      'restoringCompletedRecording && recording.status === "complete"',
    );
    expect(finishSource).toContain(
      "claimRecordingFinalization(recording.sessionId)",
    );
    expect(finishSource).toContain("if (!releaseFinalization) return false;");
  });

  it("gates page error telemetry on active recording and guards reinjection", () => {
    const contentScriptSource = readFileSync(
      new URL("./content-script.ts", import.meta.url),
      "utf8",
    );

    expect(contentScriptSource).toMatch(
      /function reportContentScriptError[\s\S]*?if \(!recordingActive\) return;/,
    );
    expect(contentScriptSource).toContain(
      "chrome.storage.onChanged.addListener",
    );
    expect(contentScriptSource).toContain(
      "if (flags.__clipsOverlayHostReady) return;",
    );
    expect(contentScriptSource).toContain("data.token !== historyBridgeToken");
    expect(contentScriptSource).toContain(
      "MAX_HISTORY_NAVIGATION_MESSAGES_PER_WINDOW",
    );
    expect(contentScriptSource).toContain(
      "MAX_CLICK_INPUT_MESSAGES_PER_WINDOW",
    );
    expect(contentScriptSource).toContain("function resetDiagnosticQuotas");
    expect(contentScriptSource).toContain("resetQuotas || enteringRecording");
    expect(contentScriptSource).toContain(
      "sendDiagnosticNavigation(window.location.href)",
    );
  });

  it("keeps cross-tab follow enabled and declares the broad-host manifest path", () => {
    const backgroundSource = readFileSync(
      new URL("./background.ts", import.meta.url),
      "utf8",
    );
    const historyBridgeSource = readFileSync(
      new URL("./content-history-bridge.ts", import.meta.url),
      "utf8",
    );
    expect(backgroundSource).toContain(
      "const CROSS_TAB_FOLLOW: boolean = true;",
    );

    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
    ) as {
      host_permissions?: string[];
      content_scripts?: Array<{
        matches?: string[];
        js?: string[];
        run_at?: string;
        world?: string;
        all_frames?: boolean;
      }>;
    };

    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining(["<all_urls>"]),
    );

    const overlayScript = manifest.content_scripts?.find((entry) =>
      entry.js?.includes("assets/content-script.js"),
    );
    expect(overlayScript).toEqual(
      expect.objectContaining({
        matches: expect.arrayContaining(["<all_urls>"]),
        js: ["assets/content-script.js"],
        run_at: "document_idle",
        all_frames: false,
      }),
    );

    const historyBridge = manifest.content_scripts?.find((entry) =>
      entry.js?.includes("assets/content-history-bridge.js"),
    );
    expect(historyBridge).toEqual(
      expect.objectContaining({
        matches: ["<all_urls>"],
        js: ["assets/content-history-bridge.js"],
        run_at: "document_start",
        world: "MAIN",
        all_frames: false,
      }),
    );

    expect(backgroundSource).toContain("sendWithInjectionFallback");
    expect(backgroundSource).toContain("shouldFollowOverlay");
    expect(backgroundSource).toContain("assets/content-history-bridge.js");
    expect(historyBridgeSource).toContain("webCrypto?.randomUUID");
    expect(historyBridgeSource).toContain("webCrypto.getRandomValues(bytes)");
    expect(historyBridgeSource).toContain('data.kind === "request-token"');
    expect(backgroundSource).toContain("MAX_CLICK_INPUT_INGRESS_PER_WINDOW");
    expect(backgroundSource).toContain("restoreCaptureSession");
    expect(backgroundSource).toContain('overlayPhase === "paused"');
    expect(backgroundSource).toContain(
      'const resetDiagnosticQuotas = overlayPhase === "recording";',
    );
  });
});
