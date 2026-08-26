import { trackEvent } from "@agent-native/core/client/analytics";
import { IconCopy } from "@tabler/icons-react";

import { useSnackbar } from "./ds/snackbar";

const INSTALL_COMMAND = "npx @agent-native/core@latest create my-app";

export function InstallCommand() {
  const showSnackbar = useSnackbar();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      // coercion-ok: clipboard permission/availability failures mean the
      // copy silently didn't happen, so skip the success feedback below
      // rather than falsely claiming it worked
      return;
    }
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    showSnackbar("COPIED");
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy install command"
      className="hover:text-[var(--b-text-primary)]"
      style={{
        display: "inline-flex",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        color: "var(--b-text-secondary)",
        // 1px of padding over a gradient background with an opaque child on
        // top: only a gradient hairline shows through at the edges, which a
        // real border can't do -- the line is brightest at the top-left and
        // fades out where the gradient meets the fill color. Same trick as
        // the nav's IconBox.
        padding: 1,
        border: "none",
        borderRadius: "var(--b-radius)",
        background:
          "linear-gradient(140deg, var(--c-neutral-700) 0%, var(--b-bg-prominent) 100%)",
        lineHeight: 1,
        cursor: "pointer",
        transition: "color 0.15s, background 0.2s ease",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--spacing-2)",
          padding: "9px var(--spacing-3)",
          borderRadius: "calc(var(--b-radius) - 1px)",
          background: "var(--b-bg-inset)",
          transition: "background 0.2s ease",
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
        <IconCopy
          size={14}
          stroke={1.75}
          aria-hidden="true"
          style={{
            marginLeft: "var(--spacing-1)",
            color: "var(--b-text-muted)",
          }}
        />
      </span>
    </button>
  );
}
