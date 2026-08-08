/**
 * Renders the Markdown portion of a docs page. The visual-block renderer is
 * loaded only for pages that contain block syntax so ordinary docs requests do
 * not pull the full diagram/table/mermaid library into the SSR startup path.
 */

import { lazy, Suspense } from "react";

import { hasDocBlockSyntax } from "./doc-block-detection";
import MarkdownRenderer from "./MarkdownRenderer";

const DocBlocksContent = lazy(() => import("./DocBlocksContent"));

interface Props {
  markdown: string;
}

export default function DocContent({ markdown }: Props) {
  if (!hasDocBlockSyntax(markdown)) {
    return <MarkdownRenderer markdown={markdown} />;
  }

  return (
    <Suspense fallback={<MarkdownRenderer markdown={markdown} />}>
      <DocBlocksContent markdown={markdown} />
    </Suspense>
  );
}
