/**
 * Framework-shipped dev-overlay panels. Loaded as a side-effect import from
 * `DevOverlay.tsx` so any app that mounts the overlay gets these for free.
 */

import { createElement } from "react";
import { registerDevPanel } from "./registry.js";
import { OnboardingPreview } from "./OnboardingPreview.js";

let registered = false;

function registerBuiltins() {
  if (registered) return;
  registered = true;

  registerDevPanel({
    id: "framework-onboarding",
    label: "Onboarding",
    description:
      "Preview the new-user onboarding flow without resetting your own setup.",
    order: 10,
    options: [
      {
        id: "reopen",
        label: "Reopen onboarding",
        description: "Un-dismiss the setup checklist for the current session.",
        type: "action",
        buttonLabel: "Reopen",
        onClick: async () => {
          await fetch("/_agent-native/onboarding/reopen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        },
      },
    ],
    render: () => createElement(OnboardingPreview),
  });
}

registerBuiltins();
