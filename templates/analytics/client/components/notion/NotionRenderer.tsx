import { cn } from "@/lib/utils";

interface RichText {
  type: string;
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[];
  [key: string]: any;
}

function colorClass(color: string): string {
  const map: Record<string, string> = {
    gray: "text-muted-foreground",
    brown: "text-amber-700 dark:text-amber-500",
    orange: "text-orange-600 dark:text-orange-400",
    yellow: "text-yellow-600 dark:text-yellow-400",
    green: "text-green-600 dark:text-green-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
    pink: "text-pink-600 dark:text-pink-400",
    red: "text-red-600 dark:text-red-400",
    gray_background: "bg-muted/50 px-1 rounded",
    brown_background: "bg-amber-500/10 px-1 rounded",
    orange_background: "bg-orange-500/10 px-1 rounded",
    yellow_background: "bg-yellow-500/10 px-1 rounded",
    green_background: "bg-green-500/10 px-1 rounded",
    blue_background: "bg-blue-500/10 px-1 rounded",
    purple_background: "bg-purple-500/10 px-1 rounded",
    pink_background: "bg-pink-500/10 px-1 rounded",
    red_background: "bg-red-500/10 px-1 rounded",
  };
  return map[color] ?? "";
}

function RichTextSpan({ texts }: { texts: RichText[] }) {
  if (!texts || texts.length === 0) return null;

  return (
    <>
      {texts.map((t, i) => {
        let el: React.ReactNode = t.plain_text;

        if (t.annotations.code) {
          el = (
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground">
              {el}
            </code>
          );
        }
        if (t.annotations.bold) el = <strong>{el}</strong>;
        if (t.annotations.italic) el = <em>{el}</em>;
        if (t.annotations.strikethrough) el = <s>{el}</s>;
        if (t.annotations.underline) el = <u>{el}</u>;

        const cc = colorClass(t.annotations.color);

        if (t.href) {
          el = (
            <a
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "text-primary underline underline-offset-2 hover:text-primary/80",
                cc
              )}
            >
              {el}
            </a>
          );
        } else if (cc) {
          el = <span className={cc}>{el}</span>;
        }

        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

function BlockChildren({ blocks }: { blocks?: NotionBlock[] }) {
  if (!blocks || blocks.length === 0) return null;
  return <NotionBlocks blocks={blocks} />;
}

function ParagraphBlock({ block }: { block: NotionBlock }) {
  const rt = block.paragraph?.rich_text;
  if (!rt || rt.length === 0) return <div className="h-3" />;
  return (
    <p className="text-foreground/90 leading-[1.7]">
      <RichTextSpan texts={rt} />
    </p>
  );
}

function HeadingBlock({ block, level }: { block: NotionBlock; level: 1 | 2 | 3 }) {
  const key = `heading_${level}`;
  const rt = block[key]?.rich_text;
  const Tag = `h${level}` as const;
  const sizes = {
    1: "text-2xl font-bold pt-6 pb-1",
    2: "text-xl font-semibold pt-5 pb-1",
    3: "text-lg font-medium pt-4 pb-0.5",
  };

  return (
    <Tag className={cn(sizes[level], "text-foreground")}>
      <RichTextSpan texts={rt} />
    </Tag>
  );
}

function CalloutBlock({ block }: { block: NotionBlock }) {
  const callout = block.callout;
  const icon = callout?.icon?.emoji ?? "";
  const rt = callout?.rich_text;

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
      {icon && <span className="text-lg shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-foreground/90 leading-relaxed">
          <RichTextSpan texts={rt} />
        </div>
        <BlockChildren blocks={block.children} />
      </div>
    </div>
  );
}

function BulletedListItem({ block }: { block: NotionBlock }) {
  const rt = block.bulleted_list_item?.rich_text;
  return (
    <li className="text-foreground/90 leading-relaxed">
      <RichTextSpan texts={rt} />
      {block.children && block.children.length > 0 && (
        <ul className="list-disc ml-5 mt-1 space-y-1">
          {block.children.map((child) => (
            <NotionBlockRenderer key={child.id} block={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NumberedListItem({ block }: { block: NotionBlock }) {
  const rt = block.numbered_list_item?.rich_text;
  return (
    <li className="text-foreground/90 leading-relaxed">
      <RichTextSpan texts={rt} />
      {block.children && block.children.length > 0 && (
        <ol className="list-decimal ml-5 mt-1 space-y-1">
          {block.children.map((child) => (
            <NotionBlockRenderer key={child.id} block={child} />
          ))}
        </ol>
      )}
    </li>
  );
}

function TodoBlock({ block }: { block: NotionBlock }) {
  const todo = block.to_do;
  const checked = todo?.checked ?? false;
  const rt = todo?.rich_text;

  return (
    <div className="flex items-start gap-2">
      <div
        className={cn(
          "mt-1 h-4 w-4 shrink-0 rounded border",
          checked
            ? "bg-primary border-primary"
            : "border-muted-foreground/40"
        )}
      >
        {checked && (
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 text-primary-foreground">
            <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span className={cn("text-foreground/90 leading-relaxed", checked && "line-through opacity-60")}>
        <RichTextSpan texts={rt} />
      </span>
    </div>
  );
}

function DividerBlock() {
  return <hr className="border-border" />;
}

function TableBlock({ block }: { block: NotionBlock }) {
  const rows = block.children ?? [];
  const hasHeader = block.table?.has_column_header ?? false;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        {rows.map((row, rowIdx) => {
          const cells = row.table_row?.cells ?? [];
          const isHeader = hasHeader && rowIdx === 0;
          const Tag = isHeader ? "th" : "td";
          const Wrapper = rowIdx === 0 && isHeader ? "thead" : "tbody";

          const rowEl = (
            <tr
              key={row.id}
              className={cn(
                rowIdx !== rows.length - 1 && "border-b border-border",
                !isHeader && rowIdx % 2 === 0 && "bg-muted/20"
              )}
            >
              {cells.map((cell: RichText[], cellIdx: number) => (
                <Tag
                  key={cellIdx}
                  className={cn(
                    "px-4 py-2.5 text-left",
                    isHeader
                      ? "font-semibold text-foreground bg-muted/40"
                      : "text-foreground/90"
                  )}
                >
                  <RichTextSpan texts={cell} />
                </Tag>
              ))}
            </tr>
          );

          if (isHeader) return <thead key={row.id}>{rowEl}</thead>;
          if (rowIdx === 1 || (!hasHeader && rowIdx === 0)) {
            // Find all body rows
            const bodyRows = hasHeader ? rows.slice(1) : rows;
            return rowIdx === (hasHeader ? 1 : 0) ? (
              <tbody key="body">
                {bodyRows.map((bRow, bIdx) => {
                  const bCells = bRow.table_row?.cells ?? [];
                  return (
                    <tr
                      key={bRow.id}
                      className={cn(
                        bIdx !== bodyRows.length - 1 && "border-b border-border",
                        bIdx % 2 === 0 && "bg-muted/20"
                      )}
                    >
                      {bCells.map((cell: RichText[], cellIdx: number) => (
                        <td key={cellIdx} className="px-4 py-2.5 text-left text-foreground/90">
                          <RichTextSpan texts={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ) : null;
          }
          return null;
        })}
      </table>
    </div>
  );
}

function QuoteBlock({ block }: { block: NotionBlock }) {
  const rt = block.quote?.rich_text;
  return (
    <blockquote className="border-l-4 border-primary/50 pl-4 py-1 text-foreground/80">
      <RichTextSpan texts={rt} />
      <BlockChildren blocks={block.children} />
    </blockquote>
  );
}

function ToggleBlock({ block }: { block: NotionBlock }) {
  const rt = block.toggle?.rich_text;
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-medium text-foreground">
        <RichTextSpan texts={rt} />
      </summary>
      {block.children && (
        <div className="mt-2 pl-4">
          <BlockChildren blocks={block.children} />
        </div>
      )}
    </details>
  );
}

function NotionBlockRenderer({ block }: { block: NotionBlock }) {
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock block={block} />;
    case "heading_1":
      return <HeadingBlock block={block} level={1} />;
    case "heading_2":
      return <HeadingBlock block={block} level={2} />;
    case "heading_3":
      return <HeadingBlock block={block} level={3} />;
    case "callout":
      return <CalloutBlock block={block} />;
    case "bulleted_list_item":
      return <BulletedListItem block={block} />;
    case "numbered_list_item":
      return <NumberedListItem block={block} />;
    case "to_do":
      return <TodoBlock block={block} />;
    case "divider":
      return <DividerBlock />;
    case "table":
      return <TableBlock block={block} />;
    case "quote":
      return <QuoteBlock block={block} />;
    case "toggle":
      return <ToggleBlock block={block} />;
    default:
      return null;
  }
}

/** Groups consecutive list items into proper <ul>/<ol> wrappers */
function NotionBlocks({ blocks }: { blocks: NotionBlock[] }) {
  const grouped: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "bulleted_list_item") {
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i].type === "bulleted_list_item") {
        items.push(blocks[i]);
        i++;
      }
      grouped.push(
        <ul key={items[0].id} className="list-disc ml-5 space-y-1.5">
          {items.map((item) => (
            <BulletedListItem key={item.id} block={item} />
          ))}
        </ul>
      );
    } else if (block.type === "numbered_list_item") {
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i].type === "numbered_list_item") {
        items.push(blocks[i]);
        i++;
      }
      grouped.push(
        <ol key={items[0].id} className="list-decimal ml-5 space-y-1.5">
          {items.map((item) => (
            <NumberedListItem key={item.id} block={item} />
          ))}
        </ol>
      );
    } else if (block.type === "to_do") {
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i].type === "to_do") {
        items.push(blocks[i]);
        i++;
      }
      grouped.push(
        <div key={items[0].id} className="space-y-2.5">
          {items.map((item) => (
            <TodoBlock key={item.id} block={item} />
          ))}
        </div>
      );
    } else {
      grouped.push(<NotionBlockRenderer key={block.id} block={block} />);
      i++;
    }
  }

  return <>{grouped}</>;
}

export function NotionRenderer({ blocks }: { blocks: NotionBlock[] }) {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3">
      <NotionBlocks blocks={blocks} />
    </div>
  );
}
