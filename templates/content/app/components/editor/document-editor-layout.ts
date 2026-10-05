import { cn } from "@/lib/utils";

// The page editor's column geometry. The loading placeholders use the same
// classes so the title and body hold still when the editor replaces them.

export function documentEditorTitleRegionClassName(
  hasDatabase: boolean,
  host: "page" | "preview" = "page",
) {
  if (host === "preview") {
    return hasDatabase
      ? "shrink-0 w-full max-w-none px-4 pb-2 pt-2 sm:px-6 sm:pt-6 group/title"
      : "shrink-0 mx-auto w-full max-w-3xl px-4 pb-3 pt-2 sm:px-6 sm:pt-6 group/title";
  }
  if (hasDatabase) {
    return cn(
      "shrink-0 w-full max-w-none px-4 pt-14 pb-2 sm:px-8 sm:pt-7 lg:px-10 group/title",
    );
  }

  return cn(
    "shrink-0 w-full max-w-3xl mx-auto px-4 pt-14 sm:px-8 md:px-16 md:pt-16 group/title",
    "pb-8",
  );
}

// The size class sets the line height. The title textarea grows to its
// `scrollHeight`, which at 36px includes about 2px of Inter's descent below
// the 40px line; the 2px bottom padding holds that space in both the textarea
// and the placeholder, so each is 42px tall.
export const DOCUMENT_EDITOR_TITLE_CLASS_NAME =
  "block w-full break-words p-0 font-bold text-foreground";

export const DOCUMENT_EDITOR_PAGE_TITLE_SIZE_CLASS_NAME =
  "text-3xl md:text-4xl md:pb-0.5";

export function documentEditorBodyClassName(host: "page" | "preview") {
  return cn(
    "mx-auto w-full max-w-3xl flex-1 cursor-text px-4",
    host === "preview" ? "pb-10 sm:px-6" : "pb-16 sm:px-8 md:px-16",
  );
}

// What sits above the title: the page icon (56px), the "Add icon" button an
// editor sees on a page without one (28px), or nothing for a reader.
export type DocumentEditorIconRow = "icon" | "add" | "none";
