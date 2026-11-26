# Pasting from other design tools

Copy in Figma, Paper or Wonder, paste in Design. One path handles all three.

```
paste event
  findDesignToolPaste        sync: which tool wrote this clipboard? claims the event
  readDesignToolSource       async: adapter.read() -> layers + warnings
  runImportDesignToolPasteIntoDesign
                             host images, plan placement, insert or create screens
```

## Adapters

An adapter is `detect(html)` plus `read(html)` in its own file, registered in
`index.ts`.

- `detect` is a cheap, linear marker check. It runs on every HTML paste, so it
  must never scan quadratically (see `hasFigmaClipboardPayload`).
- `read` runs only after `detect` matched. It returns `ok` with layers and
  warnings, or `invalid` with a reason. A copy that is the tool's but unreadable
  is `invalid`, never `absent`.
- Paper and Wonder validate the payload with zod, map it onto the shared layer
  tree in `ir.ts`, and let `emit.ts` write the HTML. Figma's clipboard carries
  a `fig-kiwi` scene; `shared/figma-clipboard-decode.ts` renders it to HTML and
  runs in a worker.

## Adding a tool

1. Dump a real clipboard (`public.html`) and write the zod schema from it.
2. Map the payload to `PasteFrame`s; convert colors to hex in the adapter.
3. Export `detectX` and `readX`; add them to `ADAPTERS` and `DesignTool`.
4. Add the tool to `TOOL_LABELS` and `designToolPasteFailureTitle`, plus the
   `<tool>PasteFailed` catalog key in every locale.
5. Test with a synthetic fixture shaped like the real payload. Never commit a
   real copy of someone's design.

## Rules

- Never build HTML by hand in an adapter. `emit.ts` owns escaping and the
  allowlists for style names, tags, SVG attributes and value grammar.
- Report what was lost as a structured `PasteWarning`; `warnings.ts` localizes
  it. Never put English text in a toast.
- Read payload records with `lookup()`, not `record[key]`: a key named
  "constructor" must find nothing.
- Remote images are hosted through `upload-image` before insert
  (`images.ts`); one that cannot be hosted keeps its link and is reported.
