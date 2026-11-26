export const NFM_INTERACTIVE_HTML_SYNTAX =
  "For something people click or play with, write a whole HTML page in a fence whose language is html interactive: it runs on the page in a sealed frame, sizes itself up to 1,000px tall and opens full screen from its own link. Its <title> is its caption. Inline <script> and <style> work; scripts, stylesheets and fonts load only from https://cdn.jsdelivr.net, and images only from /api/private-media/<id> or data: URLs. It has no other network, storage, parent page or nested frames. Change it with small find/replace edits, like any text.";

export const NFM_CONTAINER_SYNTAX =
  'Children of <callout>, <details>, <columns>, <column>, and <synced_block> sit one tab deeper than their tags, as in <callout icon="💡">\n\tText\n</callout>; a <details> keeps its <summary> line at the tags\' indent. A <column> may give its width as ratio, a percentage of the row, as in <column ratio="60">; give every column in a set one, or none for equal widths.';
