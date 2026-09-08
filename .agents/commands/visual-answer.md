---
description: "Publish a code/product answer as a visual Plan artifact"
argument-hint: "<question>"
---

Use the `visual-answer` skill.

Answer `$ARGUMENTS` by inspecting the real code first. Gather the relevant files,
APIs, schema, UI states, and source URLs. Call `get-plan-blocks` or run
`agent-native plan blocks --out plan-blocks.md` before authoring MDX.

Write `visual-answer-source.json` with:

- `question`
- `title`
- `brief`
- `repoPath` when known
- `sourceUrl` when known
- `mdx["plan.mdx"]` using registered Plan blocks

Then run:

```sh
agent-native plan visual-answer publish --question "$ARGUMENTS" --source visual-answer-source.json
```

Return the URL from `visual-answer-url.txt` and a short summary of the evidence
you inspected. Do not paste the full visual answer inline.
