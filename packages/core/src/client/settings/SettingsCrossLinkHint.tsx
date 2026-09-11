/**
 * Quiet cross-link line used to point between the Integrations tab and the
 * API keys tab. Deliberately dependency-free (no imports beyond React) so it
 * can be imported from either side without pulling in the rest of
 * SettingsPanel.tsx's module graph.
 */
export function SettingsCrossLinkHint({
  text,
  linkText,
  href,
}: {
  /** The question, e.g. "Looking for an API key instead?" */
  text: string;
  /** The link label, e.g. "Go to API keys"; an arrow is appended. */
  linkText: string;
  href: string;
}) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {text}{" "}
      <a
        href={href}
        className="text-foreground/80 underline-offset-2 hover:underline"
      >
        {linkText} →
      </a>
    </p>
  );
}
