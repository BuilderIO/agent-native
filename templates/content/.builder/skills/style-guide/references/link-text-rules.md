# Link Text Rules

Rules for writing effective link (anchor) text in blog posts. Adapted from Google's developer style guide, filtered for blog context. These rules apply during drafting (Phase 6) and are checked during the editing micro-rules sweep (Phase 7, Step 4b).

## Rules

### Rule 1: Use descriptive link text

Write short, unique, descriptive phrases that provide context for the linked content. Never use generic phrases.

**Banned phrases as link text:** "click here", "here", "read more", "this article", "this post", "this page", "this guide", "link", "this link"

| Good | Bad |
|------|-----|
| see the [React Server Components RFC](url) | see [this document](url) |
| check the [Next.js App Router migration guide](url) | [click here](url) to learn more |
| the [Vercel deployment docs](url) cover this | [read more](url) |

**Detection pattern:** Link text matches any banned phrase exactly, or link text is a single common word ("here", "link", "this").

### Rule 2: Link text stands alone

Write link text that makes sense without the surrounding sentence. A reader scanning only the links should understand what each leads to.

| Good | Bad |
|------|-----|
| [Builder.io's visual editor](url) handles component mapping | Builder.io's visual editor handles [component mapping](url) -- "component mapping" alone is vague |
| install the [ESLint React plugin](url) | install [the plugin](url) |

**Detection pattern:** Link text that requires the surrounding sentence to identify the destination (pronouns, articles alone, generic nouns).

### Rule 3: No URLs as link text

Use the page title or a descriptive phrase instead of displaying the raw URL.

| Good | Bad |
|------|-----|
| see the [HTTP/1.1 RFC](https://www.w3.org/Protocols/rfc2616/rfc2616.html) | see [https://www.w3.org/Protocols/rfc2616/rfc2616.html](https://www.w3.org/Protocols/rfc2616/rfc2616.html) |
| the [Tailwind CSS docs](url) explain utility classes | check out [tailwindcss.com/docs](url) |

**Detection pattern:** Link text starts with `http://`, `https://`, or `www.`, or matches a domain pattern like `example.com/path`.

### Rule 4: Include abbreviations in link text

When linking to a term that has an abbreviation, include both the full form and the abbreviation within the link.

| Good | Bad |
|------|-----|
| [Google Kubernetes Engine (GKE)](url) | [Google Kubernetes Engine](url) (GKE) |
| [Content Security Policy (CSP)](url) | [Content Security Policy](url) (CSP) |

**Detection pattern:** An abbreviation in parentheses appears immediately after a link but outside the link text.

### Rule 5: Keep link text short

Target 2-6 words. Link text should be a phrase, not a sentence or paragraph.

| Good | Bad |
|------|-----|
| the [Server Components RFC](url) | the [RFC that describes how React Server Components work and their integration with streaming](url) |
| [Builder.io's React SDK](url) | [the SDK that Builder.io provides for React developers to integrate visual editing](url) |

**Detection pattern:** Link text exceeds 10 words.

### Rule 6: Front-load important words

Place the most important or identifying words at the beginning of the link text. Readers scan links -- leading words matter most.

| Good | Bad |
|------|-----|
| [React 19 upgrade guide](url) | [guide for upgrading to React 19](url) |
| [Vite configuration reference](url) | [reference for configuring Vite](url) |

**Detection pattern:** Link text starts with a generic word ("guide for", "reference for", "documentation about", "page about").

### Rule 7: Unique link text per target

Do not use identical link text for different destination URLs within the same post. Each link text should uniquely identify its destination.

| Good | Bad |
|------|-----|
| [React docs](url1) ... [Vue docs](url2) | [official docs](url1) ... [official docs](url2) -- which docs? |
| [Next.js App Router](url1) ... [Remix routing](url2) | [the documentation](url1) ... [the documentation](url2) |

**Detection pattern:** Two or more links in the same post share identical anchor text but point to different URLs.

### Rule 8: Punctuation outside links

Place periods, commas, colons, and semicolons outside the link tags. The punctuation is not part of the linked content.

| Good | Bad |
|------|-----|
| see the [React Server Components RFC](url). | see the [React Server Components RFC.](url) |
| supports [TypeScript](url), [JavaScript](url), and [Python](url) | supports [TypeScript,](url) [JavaScript,](url) and [Python](url) |

**Detection pattern:** Link text ends with `.`, `,`, `:`, or `;`.

### Rule 9: No quotation marks around links

When text is a link, the link styling is the visual indicator. Do not add quotation marks around linked text.

| Good | Bad |
|------|-----|
| For details, see [Meet Android Studio](url). | For details, see "[Meet Android Studio](url)." |
| Read [The Pragmatic Programmer](url). | Read "[The Pragmatic Programmer](url)." |

**Exception:** Unlinked references to titles use quotation marks or italics as appropriate.

**Detection pattern:** Link text is wrapped in quotation marks (`"[text](url)"` or `"[text](url)"`).

### Rule 10: Signal unexpected link behavior

If a link downloads a file or sends an email, mention the action and file type in the link text or surrounding context. Readers expect links to navigate to web pages.

| Good | Bad |
|------|-----|
| download the [migration checklist PDF](url) | see the [migration checklist](url) -- reader doesn't expect a download |
| [email the support team](mailto:support@example.com) | [contact us](mailto:support@example.com) -- reader expects a web page |
| the [Kubernetes security whitepaper (PDF)](url) | the [Kubernetes security whitepaper](url) |

**Detection pattern:** Link URL contains `mailto:` or points to a file extension (`.pdf`, `.zip`, `.csv`, `.xlsx`) without the link text or surrounding sentence mentioning the file type or action.

## Quick Reference Table

For the editing micro-rules sweep (Phase 7, Step 4b):

| Check | Search For | Fix |
|-------|-----------|-----|
| Banned phrases | "click here", "read more", "this article", "this post", "here" as link text | Replace with descriptive anchor: page title, tool name, or specific phrase |
| Bare URLs | Link text starting with `http`, `https`, `www`, or matching a domain pattern | Replace with page title or description |
| Overly long | Link text exceeding 10 words | Shorten to 2-6 word descriptive phrase |
| Trailing punctuation | Link text ending with `.` `,` `:` `;` | Move punctuation outside the link |
| Duplicate anchors | Identical link text pointing to different URLs | Make each link text unique to its destination |
| Orphaned abbreviations | Abbreviation in parentheses immediately after but outside a link | Include abbreviation inside the link text |
