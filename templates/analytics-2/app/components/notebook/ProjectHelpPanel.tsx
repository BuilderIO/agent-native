import { useT } from "@agent-native/core/client/i18n";
import { IconBook, IconKeyboard, IconX } from "@tabler/icons-react";

import { useOpenKeyboardShortcuts } from "./KeyboardShortcutsDialog";

/** The app's own documentation entry, already used by the data surfaces. */
const DOCUMENTATION_URL = "https://www.agent-native.com/docs/";

/**
 * Help & support: the notebook's help panel. The source's help center lists
 * documentation links and the editor shortcuts, so this lists the two things
 * the rebuild can back from its own behaviour: the documentation entry the app
 * already links to, and the shortcuts the notebook really implements.
 */
export function ProjectHelpPanel({ onClose }: { onClose: () => void }) {
  const openShortcuts = useOpenKeyboardShortcuts();
  const t = useT();
  return (
    <aside className="nb-side-panel" aria-label="Help & support">
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">Help Center</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label="Close Help & support"
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      <section className="nb-help-group" aria-label="Resources">
        <h3 className="nb-help-subtitle">Resources</h3>
        <a
          className="nb-help-link"
          href={DOCUMENTATION_URL}
          target="_blank"
          rel="noreferrer"
        >
          <IconBook size={13} aria-hidden="true" />
          Documentation
        </a>
      </section>
      <section className="nb-help-group">
        <button type="button" className="nb-help-link" onClick={openShortcuts}>
          <IconKeyboard size={13} aria-hidden="true" />{" "}
          {t("keyboardShortcuts.title")}
        </button>
      </section>
    </aside>
  );
}
