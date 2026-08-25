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

  function handleCopy() {
    navigator.clipboard.writeText(INSTALL_COMMAND).catch(() => {});
    setCopied(true);
    trackEvent("copy install command", { command: INSTALL_COMMAND });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-1)",
        color: "var(--b-text-secondary)",
      }}
    >
      <span aria-hidden="true">&gt;</span>
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
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy install command"
        className="hover:text-[var(--b-text-primary)]"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--b-text-secondary)",
          cursor: "pointer",
          transition: "color 0.15s",
        }}
      >
        {copied ? (
          <IconCheck size={14} stroke={1.75} />
        ) : (
          <IconCopy size={14} stroke={1.75} />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied!" : ""}
      </span>
    </div>
  );
}
