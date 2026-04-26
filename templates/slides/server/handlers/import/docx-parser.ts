export interface ParsedDocument {
  title: string;
  html: string;
  text: string;
  sections: { heading: string; content: string }[];
}

export async function parseDocx(fileBuffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");

  const htmlResult = await mammoth.convertToHtml({ buffer: fileBuffer });
  const html = htmlResult.value;

  const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
  const text = textResult.value;

  // Parse sections by splitting on headings in the HTML
  const sections = extractSections(html);

  // Derive title from the first heading or first line of text
  let title = "Imported Document";
  if (sections.length > 0 && sections[0].heading) {
    title = sections[0].heading;
  } else {
    const firstLine = text.split("\n").find((l) => l.trim().length > 0);
    if (firstLine && firstLine.trim().length < 200) {
      title = firstLine.trim();
    }
  }

  return { title, html, text, sections };
}

/** Split HTML into sections based on h1/h2/h3 tags. */
function extractSections(html: string): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];

  // Split on heading tags, keeping the delimiter
  const parts = html.split(/(?=<h[1-3][^>]*>)/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Try to extract the heading text
    const headingMatch = trimmed.match(/^<h[1-3][^>]*>(.*?)<\/h[1-3]>/is);

    if (headingMatch) {
      const heading = stripHtmlTags(headingMatch[1]).trim();
      const content = trimmed.slice(headingMatch[0].length).trim();
      sections.push({ heading, content });
    } else {
      // Content before the first heading
      if (sections.length === 0) {
        sections.push({ heading: "", content: trimmed });
      } else {
        // Append to previous section
        sections[sections.length - 1].content += "\n" + trimmed;
      }
    }
  }

  // If no headings were found, treat the whole document as one section
  if (sections.length === 0 && html.trim()) {
    // Try splitting by paragraphs for a rough section breakdown
    const paragraphs = html
      .split(/<\/p>/i)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length > 0) {
      const firstText = stripHtmlTags(paragraphs[0]).trim();
      sections.push({
        heading: firstText.length < 200 ? firstText : "",
        content: html,
      });
    }
  }

  return sections;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
