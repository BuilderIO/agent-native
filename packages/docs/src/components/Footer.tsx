export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--border)] px-6 py-8">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between text-sm text-[var(--fg-secondary)]">
        <p className="m-0">&copy; {year} Agent-Native</p>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/agent-native"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@agent-native/core"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            npm
          </a>
        </div>
      </div>
    </footer>
  );
}
