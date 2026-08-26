import { trackEvent } from "@agent-native/core/client/analytics";

import { useSnackbar } from "./ds/snackbar";

const INSTALL_COMMAND = "npx @agent-native/core@latest create my-app";

// navigator.clipboard is missing or rejects in an iframe that wasn't granted
// clipboard-write (the preview host is one), so fall back to the legacy
// selection-based copy instead of silently doing nothing there.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // coercion-ok: permission/availability failure, retried via execCommand
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    // coercion-ok: false is the copy-failed signal the caller already branches on
    return false;
  } finally {
    field.remove();
  }
}

// Two stacked background layers on a real 1px border: the fill layer is
// clipped to padding-box and the gradient layer to border-box, so the gradient
// only shows inside the border itself. That keeps the hairline exactly the same
// 1px as the buttons beside it -- the older approach (1px of padding over a
// gradient with an opaque child on top) depends on the child's box landing on
// a whole device pixel and rounds up to 2px when it doesn't. Only the fill
// layer changes on hover; the gradient stays put.
const CLASSES = [
  // The two properties have different durations, so this keeps the shorthand
  // verbatim rather than flattening both onto one `duration-*`.
  "inline-flex cursor-pointer items-center gap-[var(--spacing-2)] rounded-[var(--b-radius)] px-[var(--spacing-3)] py-[9px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] leading-none text-[var(--b-text-secondary)] [transition:color_0.15s,background_0.2s_ease]",
  "border border-transparent bg-origin-border [background-clip:padding-box,border-box]",
  "bg-[image:linear-gradient(var(--b-bg-inset),var(--b-bg-inset)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "focus-visible:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:text-[var(--b-text-primary)] focus-visible:text-[var(--b-text-primary)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
].join(" ");

export function InstallCommand() {
  const showSnackbar = useSnackbar();

  async function handleCopy() {
    // No feedback when nothing actually landed on the clipboard, rather than
    // falsely claiming it worked.
    if (!(await copyText(INSTALL_COMMAND))) return;
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    showSnackbar("Copied");
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy install command"
      className={CLASSES}
    >
      <span aria-hidden="true" className="text-[var(--b-text-muted)]">
        &gt;
      </span>
      {/* Every class here neutralizes the docs-wide `code {}` rule in
          global.css, which would otherwise draw its own bordered #f5f5f5 chip
          (#111 in dark) inside this button. None of them are redundant. */}
      <code className="rounded-none border-none bg-transparent p-0 font-[family-name:inherit] text-[length:inherit] text-inherit">
        {INSTALL_COMMAND}
      </code>
    </button>
  );
}
