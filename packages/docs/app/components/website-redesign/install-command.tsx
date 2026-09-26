import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";

import { sendAhrefsEvent } from "../../lib/ahrefs-analytics";
import { copyText } from "./ds/clipboard";
import { useSnackbar } from "./ds/snackbar";
import type { StartCtaLocation } from "./start-ctas";

const INSTALL_COMMAND = "npx @agent-native/core@latest create my-app";

const CLASSES = [
  "inline-flex cursor-pointer items-center gap-[var(--spacing-2)] rounded-[var(--b-radius)] px-[var(--spacing-3)] py-[9px] font-[family-name:var(--b-font-mono)] text-[length:min(var(--b-t-label-1),2.6vw)] leading-none whitespace-nowrap text-[var(--b-text-secondary)] [transition:color_0.15s,background_0.2s_ease]",
  "border border-transparent bg-origin-border [background-clip:padding-box,border-box]",
  "bg-[image:linear-gradient(var(--b-bg-inset),var(--b-bg-inset)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "focus-visible:bg-[image:linear-gradient(var(--b-bg-prominent),var(--b-bg-prominent)),linear-gradient(140deg,var(--b-stroke-gradient-start),var(--b-stroke-gradient-end))]",
  "hover:text-[var(--b-text-primary)] focus-visible:text-[var(--b-text-primary)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
].join(" ");

export function InstallCommand({ location }: { location: StartCtaLocation }) {
  const showSnackbar = useSnackbar();
  const t = useT();

  async function handleCopy() {
    if (!(await copyText(INSTALL_COMMAND))) return;
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    sendAhrefsEvent(
      location === "hero" ? "hero_npx_copy_click" : "footer_npx_copy_click",
    );
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
