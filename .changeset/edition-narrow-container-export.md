---
"@agent-native/core": patch
---

Export `NarrowContainerProvider` and `useInNarrowContainer` from
`@agent-native/core/blocks`. Width-sensitive blocks (today `diff`) already
choose a container-appropriate default inside `tabs` and `columns`; apps that
render a borrowed block in their own narrow column — such as a Plan edition
story — can now opt into the same behaviour instead of getting a split diff
crushed into a half-width box.
