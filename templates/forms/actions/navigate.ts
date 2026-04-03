/**
 * Navigate the UI to a view or form.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=forms
 *   pnpm action navigate --view=form --formId=abc123
 *   pnpm action navigate --view=responses --formId=abc123
 *
 * Options:
 *   --view       View to navigate to (forms, form, responses, settings)
 *   --formId     Form to open (for form or responses view)
 */

import { writeAppState } from "@agent-native/core/application-state";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // Handle --key=value
        result[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          result[key] = next;
          i++;
        } else {
          result[key] = "true";
        }
      }
    }
  }
  return result;
}

export default async function main(args: string[]) {
  const { view, formId } = parseArgs(args);

  if (!view && !formId) {
    console.error(
      "Error: At least --view or --formId is required. Usage: pnpm action navigate --view=forms",
    );
    process.exit(1);
  }

  const nav: Record<string, string> = {};
  if (view) nav.view = view;
  if (formId) nav.formId = formId;

  await writeAppState("navigate", nav);
  console.log(
    `Navigating to ${view || "form"}${formId ? ` (form: ${formId})` : ""}`,
  );
}
