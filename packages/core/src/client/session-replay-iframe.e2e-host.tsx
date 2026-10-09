import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { TemplatePreview } from "@/components/templates/TemplatePreview";

import { socialStory } from "../../../../templates/design/shared/design-template-presets/social-story.js";
import { AgentNativeExtensionSlot } from "../../../toolkit/src/app/extensions/AgentNativeExtensionFrame.js";
import { startSessionReplay, stopSessionReplay } from "./session-replay.js";

const extension = {
  id: "session-replay-extension",
  name: "Session replay extension",
  content: `
    <div id="recorded-extension-status">Inside recorded extension</div>
    <input id="recorded-extension-input" value="super-secret-input" />
    <button id="recorded-extension-button" type="button">Exercise extension</button>
    <script>
      (function waitForRecorder() {
        if (!window.rrwebRecord || typeof window.rrwebRecord.record !== 'function') {
          setTimeout(waitForRecorder, 25);
          return;
        }
        var button = document.getElementById('recorded-extension-button');
        var status = document.getElementById('recorded-extension-status');
        button.addEventListener('click', function() {
          status.textContent = 'Extension interaction recorded';
        });
        button.click();
        setTimeout(function() {
          window.parent.postMessage({ type: 'session-replay-iframe-e2e.done' }, '*');
        }, 100);
      })();
    </script>
  `,
  manifest: { slots: ["session-replay.test"] },
};

declare global {
  interface Window {
    __sessionReplayIframeE2E?: {
      done: boolean;
      error?: string;
      stop?: () => Promise<void>;
    };
  }
}

function Host() {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let disposed = false;
    let stopped = false;
    const finish = async () => {
      if (stopped) return;
      stopped = true;
      await stopSessionReplay("manual");
      window.__sessionReplayIframeE2E = { done: true };
    };
    void startSessionReplay({
      publicKey: "anpk_iframe_e2e",
      endpoint: "/__session-replay-iframe-upload",
      requireSignedInUser: false,
      flushIntervalMs: 100_000,
      maxEventsPerBatch: 500,
    }).then((result) => {
      if (disposed) return;
      if (!result.started) {
        window.__sessionReplayIframeE2E = {
          done: true,
          error: `Recorder did not start: ${result.reason ?? "unknown"}`,
        };
        return;
      }
      window.__sessionReplayIframeE2E = { done: false, stop: finish };
      setRecording(true);
    });

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "session-replay-iframe-e2e.done") return;
      void finish();
    };
    window.addEventListener("message", onMessage);
    return () => {
      disposed = true;
      window.removeEventListener("message", onMessage);
      void finish();
    };
  }, []);

  if (!recording) return null;

  if (
    new URLSearchParams(window.location.search).get("surface") ===
    "design-template"
  ) {
    return (
      <TemplatePreview
        title={socialStory.title}
        html={socialStory.content}
        width={socialStory.width}
        height={socialStory.height}
        recordSessionReplay
        className="session-replay-template-preview"
      />
    );
  }

  return (
    <>
      <AgentNativeExtensionSlot
        id="session-replay.test"
        extensions={[extension]}
      />
      <iframe
        data-agent-native-session-replay=""
        title="Recorded email content"
        sandbox="allow-same-origin"
        srcDoc={`<!doctype html><html><body>
          <p>Inside recorded email</p>
          <input value="email-secret-input" />
        </body></html>`}
      />
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Host />);
