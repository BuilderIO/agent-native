import { Suspense } from "react";

import { hasDocBlockSyntax } from "./doc-block-detection";
import {
  DocBlocksContent,
  getPreloadedDocBlocksContent,
  preloadDocBlocksContent,
} from "./doc-block-renderer";
import { DEFAULT_DOCS_LOCALE, type DocsLocale } from "./docs-locale";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  markdown: string;
  locale?: DocsLocale;
}

export default function DocContent({
  markdown,
  locale = DEFAULT_DOCS_LOCALE,
}: Props) {
  if (!hasDocBlockSyntax(markdown)) {
    return <MarkdownRenderer markdown={markdown} locale={locale} />;
  }

  const PreloadedDocBlocksContent = getPreloadedDocBlocksContent();
  if (PreloadedDocBlocksContent) {
    return <PreloadedDocBlocksContent markdown={markdown} locale={locale} />;
  }

  void preloadDocBlocksContent();

  return (
    <Suspense fallback={null}>
      <DocBlocksContent markdown={markdown} locale={locale} />
    </Suspense>
  );
}
