---
"@agent-native/core": patch
---

Stop refusing real deck URLs in A2A responses. The artifact guard only accepted
decks from `create-deck`, `duplicate-deck`, `get-deck`, `list-decks`, and
`add-slide`, and rejected a `create-deck` that saved an empty deck — so the
documented "create empty, then fill" flow, `patch-deck`, `save-deck`,
`update-slide`, `import-pptx`, and `restore-deck-version` all produced "I could
not verify the deck URL" for decks that were genuinely saved. Any successful
result that names a deck (an explicit `deckId`, or a canonical `/deck/<id>` URL
the action itself returned) now verifies it.
