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
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        color: "var(--b-text-secondary)",
        padding: "9px var(--spacing-3)",
        borderRadius: "var(--b-radius)",
        lineHeight: 1,
        cursor: "pointer",
        transition: "color 0.15s, background 0.2s ease",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--b-text-muted)" }}>
        &gt;
      </span>
      <code
        style={{
          fontFamily: "inherit",
          fontSize: "inherit",
          color: "inherit",
          background: "transparent",
          border: "none",
          borderRadius: 0,
          padding: 0,
        }}
      >
        {INSTALL_COMMAND}
      </code>
    </button>
  );
}
