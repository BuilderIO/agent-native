import React from "react";
import { createRoot } from "react-dom/client";

import { defineClientAction } from "../client-action.js";
import { AgentNativeExtensionSlot } from "./AgentNativeExtensionFrame.js";

const extensionContent = `
<div id="status">pending</div>
<pre id="results"></pre>
<script>
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
}

const hostWindow = window as Window & ExtensionE2EWindow;

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

hostWindow.__extensionE2ECommands = [];
window.addEventListener("message", (event) => {
  if (event.data?.type !== "extension-e2e.done") return;
  hostWindow.__extensionE2EResult = event.data.result;
  const results = document.getElementById("host-results");
  if (results) results.textContent = JSON.stringify(event.data.result);
});

const actions = [
  defineClientAction<{ value: number }, { doubled: number }>({
    name: "allowed-action",
    description: "Allowed test action",
    schema: {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    },
    run: async (args) => ({ doubled: args.value * 2 }),
  }),
  defineClientAction<Record<string, never>, { shouldNotRun: true }>({
    name: "blocked-action",
    description: "Blocked test action",
    schema: { type: "object", properties: {} },
    run: async () => ({ shouldNotRun: true }),
  }),
];

function Host() {
  return (
    <main>
      <div id="command-count">{hostWindow.__extensionE2ECommands?.length}</div>
      <div id="host-results"></div>
      <AgentNativeExtensionSlot
        id="crm.customer.sidebar"
        extensions={[extension, wrongSlotExtension]}
        context={{ customerId: "customer-1" }}
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
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Host />);
