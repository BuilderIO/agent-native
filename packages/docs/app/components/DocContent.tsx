/**
 * Renders the Markdown portion of a docs page. The visual-block renderer is
 * loaded only for pages that contain block syntax so ordinary docs requests do
 * not pull the full diagram/table/mermaid library into the SSR startup path.
 */

import { Suspense } from "react";

import { hasDocBlockSyntax } from "./doc-block-detection";
import {
  DocBlocksContent,
  getPreloadedDocBlocksContent,
  preloadDocBlocksContent,
} from "./doc-block-renderer";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  markdown: string;
}

export default function DocContent({ markdown }: Props) {
  if (!hasDocBlockSyntax(markdown)) {
    return <MarkdownRenderer markdown={markdown} />;
  }

  const PreloadedDocBlocksContent = getPreloadedDocBlocksContent();
  if (PreloadedDocBlocksContent) {
    return <PreloadedDocBlocksContent markdown={markdown} />;
  }

  // Hydration can receive prerendered loader data without rerunning the route
  // loader. Start the same preload immediately so the server HTML can hydrate
  // into the real renderer instead of painting a second Markdown tree.
  void preloadDocBlocksContent();

  return (
    <Suspense fallback={<MarkdownRenderer markdown={markdown} />}>
      <DocBlocksContent markdown={markdown} />
    </Suspense>
  );
}
