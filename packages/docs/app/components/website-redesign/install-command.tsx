import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";

import { copyText } from "./ds/clipboard";
import { useSnackbar } from "./ds/snackbar";

const INSTALL_COMMAND = "npx @agent-native/core@latest create my-app";

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
  // The command is one unbreakable token to a reader, so it scales with the
  // viewport instead of wrapping mid-command: 2.6vw is the widest size that
  // still fits inside the get-started dialog's padding at 390px.
  "inline-flex cursor-pointer items-center gap-[var(--spacing-2)] rounded-[var(--b-radius)] px-[var(--spacing-3)] py-[9px] font-[family-name:var(--b-font-mono)] text-[length:min(var(--b-t-label-1),2.6vw)] leading-none whitespace-nowrap text-[var(--b-text-secondary)] [transition:color_0.15s,background_0.2s_ease]",
  "border border-transparent bg-origin-border [background-clip:padding-box,border-box]",
  "bg-[image:linear-gradient(var(--b-bg-inset),var(--b-bg-inset)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "focus-visible:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:text-[var(--b-text-primary)] focus-visible:text-[var(--b-text-primary)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
].join(" ");

export function InstallCommand() {
  const showSnackbar = useSnackbar();
  const t = useT();

  async function handleCopy() {
    // No feedback when nothing actually landed on the clipboard, rather than
    // falsely claiming it worked.
    if (!(await copyText(INSTALL_COMMAND))) return;
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    showSnackbar(t("common.copied"));
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t("homepage.install.copyCommand")}
      className={CLASSES}
    >
      <span aria-hidden="true" className="text-[var(--b-text-muted)]">
        &gt;
      </span>
      <code>{INSTALL_COMMAND}</code>
    </button>
  );
}
