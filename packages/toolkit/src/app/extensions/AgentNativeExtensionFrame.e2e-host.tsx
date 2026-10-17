import { defineClientAction } from "@agent-native/core/client/host";
import React from "react";
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { AgentNativeExtensionSlot } from "./AgentNativeExtensionFrame.js";
import {
  extensionFrameUrlWithLinkNonce,
  useExternalExtensionLinks,
} from "./extension-links.js";

const extensionContent = `
<a id="external-metric-link" href="https://external.example.test/metric">Open metric</a>
<a id="same-origin-app-link" href="/__extension-e2e-app-target">Open app route</a>
<a id="same-origin-named-link" href="/__extension-e2e-app-popup" target="report">Open report</a>
<svg width="120" height="32"><a id="svg-metric-link" href="https://external.example.test/svg"><text x="0" y="20">SVG docs</text></a></svg>
<svg width="120" height="32" xmlns:xlink="http://www.w3.org/1999/xlink"><a id="xlink-svg-metric-link" xlink:href="https://external.example.test/xlink-svg"><text x="0" y="20">Legacy SVG docs</text></a></svg>
<button id="open-script-popup">Open script popup</button>
<button id="try-top-navigation">Try top navigation</button>
<div id="status">pending</div>
<pre id="results"></pre>
<script>
  document.getElementById('try-top-navigation').addEventListener('click', function() {
    window.__agentNativeExtensionHostPort.postMessage({
      type: 'agent-native-extension.open-external-link',
      href: 'https://external.example.test/forged-host-port'
    });
    window.top.location.assign('https://external.example.test/forged');
  });
  document.getElementById('open-script-popup').addEventListener('click', function() {
    window.open('https://external.example.test/script-popup', '_blank');
  });
  (async function() {
    const result = {};
    async function capture(name, fn) {
      try {
        result[name] = { ok: true, value: await fn() };
      } catch (error) {
        result[name] = {
          ok: false,
          error: error && error.message ? error.message : String(error),
        };
      }
    }

    window.addEventListener('agentNative:slot-context', async function(event) {
      const nextContext = event.detail || {};
      if (nextContext.customerId !== 'customer-2') return;
      const update = { slotContext: nextContext };
      try {
        update.hostContext = await agentNative.context();
      } catch (error) {
        update.hostContext = { error: error && error.message ? error.message : String(error) };
      }
      try {
        update.action = await appAction('allowed-action', { value: 5 });
      } catch (error) {
        update.action = { error: error && error.message ? error.message : String(error) };
      }
      try {
        update.storage = await extensionData.get('notes', 'note-1', { scope: 'user' });
      } catch (error) {
        update.storage = { error: error && error.message ? error.message : String(error) };
      }
      window.parent.postMessage({ type: 'extension-e2e.context-updated', update }, '*');
    });

    await capture('context', () => agentNative.context());
    await capture('actions', () => agentNative.listActions());
    await capture('allowedAction', () => appAction('allowed-action', { value: 3 }));
    await capture('blockedAction', () => appAction('blocked-action', {}));
    await capture('allowedCommand', () =>
      agentNative.command('refreshData', { customerId: slotContext.customerId })
    );
    await capture('blockedCommand', () => agentNative.command('hardReload', {}));
    await capture('storageSet', () =>
      extensionData.set('notes', 'note-1', { text: 'Saved note' }, { scope: 'user' })
    );
    await capture('storageGet', () =>
      extensionData.get('notes', 'note-1', { scope: 'user' })
    );
    await capture('blockedStorageScope', () =>
      extensionData.set('notes', 'note-2', { text: 'Org note' }, { scope: 'org' })
    );

    result.done = true;
    document.getElementById('status').textContent = 'done';
    document.getElementById('results').textContent = JSON.stringify(result);
    window.parent.postMessage({ type: 'extension-e2e.done', result }, '*');
  })();
</script>
`;

interface ExtensionE2EWindow {
  __extensionE2EResult?: unknown;
  __extensionE2ECommands?: Array<{ command: string; payload: unknown }>;
  __extensionE2EActionCalls?: number;
  __extensionE2EReplacementMessages?: Record<string, string[]>;
  __extensionE2EContextUpdate?: Record<string, unknown>;
  __extensionRouteLinkReadyCount?: number;
}

const hostWindow = window as Window & ExtensionE2EWindow;

function RouteLinkFrame() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const setLinkChannelReady = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.setAttribute("data-link-channel-ready", "true");
    const readyCount = (hostWindow.__extensionRouteLinkReadyCount ?? 0) + 1;
    hostWindow.__extensionRouteLinkReadyCount = readyCount;
    iframe.dataset.linkChannelReadyCount = String(readyCount);
  }, []);
  const linkNonce = useExternalExtensionLinks(iframeRef, "route-link-fixture", {
    onReady: setLinkChannelReady,
  });

  return (
    <iframe
      ref={iframeRef}
      key={linkNonce ?? "no-link-nonce"}
      src={
        linkNonce
          ? extensionFrameUrlWithLinkNonce("/__extension-e2e-route", linkNonce)
          : undefined
      }
      title="Route external link fixture"
      sandbox="allow-scripts allow-forms"
      data-e2e-route-link="true"
    />
  );
}

const extension = {
  id: "allowed-extension",
  name: "Allowed extension",
  content: extensionContent,
  manifest: {
    slots: ["crm.customer.sidebar"],
    requestedActions: ["allowed-action"],
    requestedCommands: ["refreshData"],
    storageScopes: ["user"],
  },
};

const wrongSlotExtension = {
  id: "wrong-slot-extension",
  name: "Wrong slot extension",
  content: "<div>should not render</div>",
  manifest: { slots: ["crm.billing.sidebar"] },
};

const firstLoadNavigationExtension = {
  id: "first-load-navigation-extension",
  name: "First-load navigation extension",
  content: `
<script>
  window.location.replace("https://external.example.test/first-load-replacement");
</script>
`,
  manifest: { slots: ["e2e.first-load-navigation"] },
};

const postHandshakeNavigationExtension = {
  id: "post-handshake-navigation-extension",
  name: "Post-handshake navigation extension",
  content: `
<script>
  window.addEventListener('agent-native-extension-host-port-ready', function() {
    setTimeout(function() {
      window.location.replace("https://external.example.test/after-handshake-replacement");
    }, 250);
  }, { once: true });
</script>
`,
  manifest: { slots: ["e2e.first-load-navigation"] },
};

hostWindow.__extensionE2ECommands = [];
window.addEventListener("message", (event) => {
  if (event.data?.type === "extension-e2e.done") {
    hostWindow.__extensionE2EResult = event.data.result;
    const results = document.getElementById("host-results");
    if (results) results.textContent = JSON.stringify(event.data.result);
  }
  if (event.data?.type === "extension-e2e.replacement-report") {
    const reports = hostWindow.__extensionE2EReplacementMessages ?? {};
    reports[event.data.id] = event.data.messages;
    hostWindow.__extensionE2EReplacementMessages = reports;
  }
  if (event.data?.type === "extension-e2e.context-updated") {
    hostWindow.__extensionE2EContextUpdate = event.data.update;
  }
});
hostWindow.__extensionE2EActionCalls = 0;

const actions = [
  defineClientAction<{ value: number }, { doubled: number }>({
    name: "allowed-action",
    description: "Allowed test action",
    schema: {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    },
    run: async (args) => {
      hostWindow.__extensionE2EActionCalls =
        (hostWindow.__extensionE2EActionCalls ?? 0) + 1;
      return { doubled: args.value * 2 };
    },
  }),
  defineClientAction<Record<string, never>, { shouldNotRun: true }>({
    name: "blocked-action",
    description: "Blocked test action",
    schema: { type: "object", properties: {} },
    run: async () => ({ shouldNotRun: true }),
  }),
];

function Host() {
  const [context, setContext] = useState({ customerId: "customer-1" });

  return (
    <main>
      <div id="command-count">{hostWindow.__extensionE2ECommands?.length}</div>
      <div id="host-results"></div>
      <button
        id="change-context"
        onClick={() => setContext({ customerId: "customer-2" })}
      >
        Change customer context
      </button>
      <AgentNativeExtensionSlot
        id="crm.customer.sidebar"
        extensions={[extension, wrongSlotExtension]}
        sandbox="allow-scripts allow-top-navigation allow-top-navigation-by-user-activation"
        context={context}
        actions={actions}
        getContext={() => ({
          resource: { type: "customer", id: "customer-1", name: "Ada Co" },
        })}
        commands={{
          refreshData: async ({ payload }) => {
            hostWindow.__extensionE2ECommands?.push({
              command: "refreshData",
              payload,
            });
            const count = document.getElementById("command-count");
            if (count) {
              count.textContent = String(
                hostWindow.__extensionE2ECommands?.length ?? 0,
              );
            }
            return { refreshed: true, payload };
          },
        }}
      />
      <AgentNativeExtensionSlot
        id="e2e.first-load-navigation"
        extensions={[
          firstLoadNavigationExtension,
          postHandshakeNavigationExtension,
        ]}
        context={{}}
        getContext={() => ({})}
      />
      <RouteLinkFrame />
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Host />);
