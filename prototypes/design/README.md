# Design

The Design template's editor, v2: a new shell around the shipped inspector, layers, menus and color picker, which it keeps from the first editor prototype.

Artifact: https://claude.ai/artifact/MC9u3UmtuV3vbB865gU1kH

What the shell adds:

- The file panel and inspector float as islands and collapse to their 48px headers (⌘\ left, ⌥⌘\ right, ⌘⇧\ both). The left island's tabs are File, Library (components, icons and tokens, as inspector-style sections) and Comments. The logo menu carries the file actions and Back to dashboard; clicking the file name renames it.
- Tools sit in a column on the canvas's left edge: Move, Frame, Shapes, Text, Pen and Comment. A corner mark, right-click or a long press opens a tool's variants. I places an icon from the library.
- Interact keeps the same islands as Design. Its left panel is the chat alone. Its header follows the agent sidebar: below 384px of panel the chats share one switcher (New chat, then each open chat), and wider panels show tabs with an N more menu. A run continues the chat it was sent from. Design keeps Chat, File, Library and Comments. The header beside the people holds search (⌘K: actions, pages, layers and chats) and a notifications bell for comments and replies. One bar holds the Interact and Design switch plus the page's controls: back, forward, reload, the address, desktop, tablet and phone sizes (more under the chevron, with Rotate and Fit), then Select, Comment and Capture. A status line under the page says what the current gesture does. Collapsing the panel brings the floating prompt back over the page. Select (V) picks a layer (↑↓ for parent and child) or, on a drag, marks an area to sketch in. The toolbar on the selection lists old → new values with a note line, and every change is a numbered pin and a chip in the composer, saved or sent together. Esc steps back out, then returns to Design.
- The agent lives under the frame. The selection rides along as a chip, @ mentions agents, people and layers, and / runs a skill. While it works, the layer gets a "Claude is editing" frame, the agent joins the avatar stack, and anything you type steers it. When it's done, a receipt lists each change with Undo.
- Connect your app (a GitHub repository or an app on this computer) reads it and runs it: routes become Pages, components fill the Library, every layer knows its file and line, Design shows the code for a selection, and changes on the branch update the pages live. It also adds Branches above Pages. Each branch is a git branch and worktree under the hood, with switch, compare, send for review and updates from Main; git terms stay under Developer details.

```bash
node prototypes/kit/build.ts design
```

`settings.json` holds the Settings pages' content. The review strip across the top holds prototype-only switches: Labs flags, the history style, scenarios, the spacing overlay, Brand, the theme, and Changes.

The v2 shell blocks sit at the end of `<style>` and `<script>`; functions they replace keep their originals under a `…Base` name.
