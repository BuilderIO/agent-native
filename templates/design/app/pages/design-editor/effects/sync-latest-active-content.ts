import { prepareCanonicalSourceContent } from "../source-publication";

export function syncLatestActiveContentFromRender(args: {
  activeContent: string;
  activeFile: { id: string; fileType?: string | null } | null | undefined;
  latestActiveContentRef: { current: string | null };
  pendingLocalFileContents: ReadonlyMap<string, { content: string }>;
}): void {
  const { activeFile } = args;
  if (!activeFile?.id) {
    args.latestActiveContentRef.current = args.activeContent;
    return;
  }
  const pendingContent = args.pendingLocalFileContents.get(
    activeFile.id,
  )?.content;
  args.latestActiveContentRef.current = prepareCanonicalSourceContent(
    pendingContent ?? args.activeContent,
    { fileId: activeFile.id, fileType: activeFile.fileType },
  ).content;
}
