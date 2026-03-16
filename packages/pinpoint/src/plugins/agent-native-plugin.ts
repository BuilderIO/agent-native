// @agent-native/pinpoint — Built-in agent-native plugin
// MIT License
//
// Wires sendToAgentChat(), SSE sync, and file persistence.
// Default plugin — makes Pinpoint agent-native out of the box.
// Can be disabled for standalone/clipboard-only mode.

import type { Plugin, Pin } from "../types/index.js";

export const agentNativePlugin: Plugin = {
  name: "agent-native",

  setup(_api, hooks) {
    hooks.register("onPinCreate", (_pin: Pin) => {
      // Pin created — the main app handles storage via the configured adapter
    });

    hooks.register("onPinResolve", (_pin: Pin) => {
      // Pin resolved — could notify the agent
    });
  },

  hooks: {
    onPinCreate(pin: Pin) {
      if (typeof console !== "undefined") {
        console.debug("[pinpoint] Pin created:", pin.id);
      }
    },

    onPinResolve(pin: Pin) {
      if (typeof console !== "undefined") {
        console.debug("[pinpoint] Pin resolved:", pin.id);
      }
    },

    transformOutput(output: string) {
      return output;
    },
  },
};
