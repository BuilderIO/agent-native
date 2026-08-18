import { useMemo } from "react";

import { splitDocSegments } from "../../lib/doc-block-segments";
import { DocBlock, DocBlocksProvider } from "./docBlocks";
import { DEFAULT_DOCS_LOCALE, type DocsLocale } from "./docs-locale";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  markdown: string;
  locale?: DocsLocale;
}

export default function DocBlocksContent({
  markdown,
  locale = DEFAULT_DOCS_LOCALE,
}: Props) {
  const segments = useMemo(() => splitDocSegments(markdown), [markdown]);

  return (
    <DocBlocksProvider locale={locale}>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          <MarkdownRenderer
            key={index}
            markdown={segment.text}
            locale={locale}
          />
        ) : (
          <div key={index} className="docs-block">
            <DocBlock segment={segment} index={index} />
          </div>
        ),
      )}
    </DocBlocksProvider>
  );
}
