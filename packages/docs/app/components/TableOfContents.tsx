interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
  return (
    <aside className="hidden w-[200px] shrink-0 xl:block">
      <nav className="sticky top-[65px] overflow-y-auto pb-8 pt-8 pl-4">
        <p className="mb-2 text-xs font-semibold text-[var(--fg-secondary)]">
          On this page
        </p>
        <ul className="list-none space-y-0 p-0">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="toc-link"
                style={item.indent ? { paddingLeft: 12 } : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
