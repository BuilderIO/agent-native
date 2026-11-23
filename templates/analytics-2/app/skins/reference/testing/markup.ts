/** Markup with everything removed that tagging adds or that React generates per render. */
export function normalizeMarkup(html: string): string {
  return html
    .replace(/\sdata-(?:rid|rid-key|part|row-kind|skin|section)="[^"]*"/g, "")
    .replace(/(?::r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_)/g, ":id:")
    .replace(/></g, ">\n<");
}
