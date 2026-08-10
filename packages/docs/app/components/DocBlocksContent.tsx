import { useMemo } from "react";

import { splitDocSegments } from "../../lib/doc-block-segments";
import { DocBlock, DocBlocksProvider } from "./docBlocks";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  markdown: string;
}

export default function DocBlocksContent({ markdown }: Props) {
  const segments = useMemo(() => splitDocSegments(markdown), [markdown]);

  return (
    <DocBlocksProvider>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          <MarkdownRenderer key={index} markdown={segment.text} />
        ) : (
          <div key={index} className="docs-block">
            <DocBlock segment={segment} index={index} />
          </div>
        ),
      )}
    </DocBlocksProvider>
  );
}
