/**
 * Framework-shipped dev-overlay panels. Loaded as a side-effect import from
 * `DevOverlay.tsx` so any app that mounts the overlay gets these for free.
 */

import { registerDevPanel } from "./registry.js";

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
        id: "show-as-new-user",
        label: "Show onboarding as new user",
        description:
          "Renders the real onboarding panel with all steps incomplete.",
        type: "boolean",
        default: false,
      },
    ],
  });
}

registerBuiltins();
