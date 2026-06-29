/**
 * Renders a markdown doc that may embed visual blocks. Splits the source into
 * ordered prose and block segments (see {@link splitDocSegments}); prose renders
 * through the existing {@link MarkdownRenderer} (Shiki highlighting, heading
 * anchors, copy buttons), and blocks render through the shared `BlockView` inside
 * a {@link DocBlocksProvider}.
 *
 * The surrounding `<article className="docs-content">` (DocsLayout) styles all the
 * prose via descendant selectors, so interleaving block siblings between prose
 * chunks keeps the typography intact.
 */

import { useMemo } from "react";

import { DocBlock, DocBlocksProvider, splitDocSegments } from "./docBlocks";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  markdown: string;
}

export default function DocContent({ markdown }: Props) {
  const segments = useMemo(() => splitDocSegments(markdown), [markdown]);

  // Fast path: docs with no embedded blocks render exactly as before.
  if (segments.every((segment) => segment.kind === "markdown")) {
    return <MarkdownRenderer markdown={markdown} />;
  }

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
