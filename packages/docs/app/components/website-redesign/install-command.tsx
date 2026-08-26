import { trackEvent } from "@agent-native/core/client/analytics";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

const INSTALL_COMMAND = "npx @agent-native/core@latest create my-app";

export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      // coercion-ok: clipboard permission/availability failures mean the
      // copy silently didn't happen, so skip the success feedback below
      // rather than falsely claiming it worked
      return;
    }
    setCopied(true);
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy install command"
      className="border-[var(--b-border-default)] bg-[var(--b-bg-raised)] hover:border-[var(--b-border-title-row)] hover:text-[var(--b-text-primary)]"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        color: "var(--b-text-secondary)",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--b-radius)",
        padding: "10px var(--spacing-3)",
        lineHeight: 1,
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
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
      {copied ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: "var(--spacing-1)",
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--b-text-primary)",
          }}
        >
          <IconCheck size={14} stroke={1.75} />
          COPIED
        </span>
      ) : (
        <IconCopy
          size={14}
          stroke={1.75}
          aria-hidden="true"
          style={{ marginLeft: "var(--spacing-1)" }}
        />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied!" : ""}
      </span>
    </button>
  );
}
