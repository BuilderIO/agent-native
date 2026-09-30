# Fixing

Fix the boundary that made the symptom possible, not the symptom.

The clearest case: the padding inspector read `styles.paddingTop || "0"` from a
parsed style map that never expanded shorthands. The tempting fix is a fallback
at the reader. The correct one was in `cssStyleAliases`, which **already**
expanded `background` and `font` with the browser's own parser — `padding` had
simply never been added. Six lines, and it fixed the sibling `border-radius`
case too.

Watch for the tell: a local `|| styles.borderRadius` fallback existing beside
your bug usually means the boundary below is wrong.

**Figma is the reference for behaviour, not a spec for HTML.** Design renders
HTML, where an element Figma would call plain text can have a background, a
border or a shadow. Disabling corner radius for every "text" element to match
Figma once broke pill buttons and badges. Before you disable, clamp or hide a
control to match Figma, try one neighbouring case the change must not break
(for example a text element with a background) on the copy, and say in the
report that you did.

### When NOT to fix

State the concern, log a recipe, leave it. Two examples:

- **Needs a product owner.** The breakpoint scoping defect sits in a substrate
  with in-flight work (`BP-DEEP` comments). Guessing writes silently-wrong CSS
  into real documents — worse than the bug.
- **Needs copy you cannot author.** Adding a menu item meant UI strings in nine
  locales. The command was already reachable two other ways.
