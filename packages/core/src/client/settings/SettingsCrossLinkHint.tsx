export function SettingsCrossLinkHint({
  text,
  linkText,
  href,
}: {
  text: string;
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
