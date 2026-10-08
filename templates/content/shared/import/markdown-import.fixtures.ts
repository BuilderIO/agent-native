/** An ordinary Markdown file, the kind people export from GitHub or editors. */
export const RELEASE_NOTES_MD = `---
title: Release notes 2.4
tags: [release, changelog]
author: Sam Example
---

# Release notes 2.4

This release adds **bulk export**, fixes *several* sync bugs, and ~~removes~~ deprecates the old API. See the [migration guide](https://example.com/migrate) and run \`npm i example@2.4\`.

## Highlights

1. Faster sync
   - Up to 3x on large folders
   - Fewer retries
2. New export formats
3. Better errors

- [x] Ship the changelog
- [ ] Update the docs site

> Upgrading from 1.x? Read the guide first.

## Compatibility

| Platform | Supported | Notes |
| :------- | :-------: | ----: |
| macOS    | yes       | 13+   |
| Windows  | yes       | \`x64\` only |
| Linux    | partial   | see #42 |

## Architecture

\`\`\`mermaid
flowchart LR
  A[Client] --> B[API]
  B --> C[(DB)]
\`\`\`

\`\`\`ts
export function sync(folder: string): Promise<void> {
  return run(folder);
}
\`\`\`

![Architecture diagram](./images/architecture.png)

![Remote logo](https://example.com/static/logo.png "Example logo")

The cost grows as $O(n \\log n)$ and the bound is:

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.[^1]

<details>
<summary>Known issues</summary>

- Large PDFs export slowly.

</details>

---

[^1]: Saving also triggers a sync.
`;

/** The list indentation styles editors write, which CommonMark nests. */
export const LIST_INDENTS_MD = `- two-space parent
  - two-space child
    - two-space grandchild

- four-space parent
    - four-space child

- tab parent
\t- tab child

1. ordered parent
   1. three-space ordered child

- [ ] task parent
  - [x] task child
`;

/** A README with the HTML people put at the top of one. */
export const README_MD = `<p align="center">
  <img src="./logo.svg" alt="Project logo" width="120">
  <br>
  <b>Fast</b> builds for <sup>every</sup> team
</p>

<!-- prettier-ignore -->
[![Build status](https://ci.example.com/badge.svg)](https://ci.example.com/runs)

# Project

> [!WARNING]
> Version 1 is no longer supported.

Plans cost $5 and $10 per month; the identity is $e^{i\\pi} + 1 = 0$.

Use <mark>highlighted</mark> text, a line<br>break, and a [setup guide](docs/setup.md).
See [the API](../outside/api.md), [an anchor](#usage), and [a script](javascript:alert(1)).

[Reference link][docs] and [missing reference][nowhere].

[docs]: https://example.com/docs "Docs home"
`;

/** Text dropped by a hand-written callout whose body is not tab-indented. */
export const UNTABBED_CALLOUT_NFM = `<callout icon="💡">
Remember to tab-indent callout bodies.
</callout>

<details>
<summary>More</summary>
Hidden detail
</details>
`;
