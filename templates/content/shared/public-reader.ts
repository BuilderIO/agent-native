import type { IconValue } from "@agent-native/core/icons";

export interface PublicReaderPage {
  id: string;
  title: string;
  icon: IconValue | null;
}

/**
 * What a public page's reader sees around it: the public pages above it, for
 * the path in the top bar, and the public pages directly under it. A private
 * page stops the path and is left out of the list, so nothing about it, not
 * even that it exists, reaches the shared public HTML.
 */
export interface PublicReaderContext {
  icon: IconValue | null;
  ancestors: PublicReaderPage[];
  /** Sub-pages the body doesn't already link to. */
  subPages: PublicReaderPage[];
  /**
   * The public pages the body's page-link blocks open, by the id each block
   * names. A block whose page isn't public has no entry and stays inert.
   */
  pageLinks: Record<string, PublicReaderPage>;
}
