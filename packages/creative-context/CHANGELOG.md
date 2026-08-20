# @agent-native/creative-context

Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).

## 0.7.0

### Minor Changes

- 39383b5: designs can be generated using creative context

## 0.6.6

### Patch Changes

- 4c7c289: Keep browser-rendered website style extraction working when the shared evaluator
  is bundled before it is serialized into Chromium.

## 0.6.5

### Patch Changes

- b3b4580: Normalize commenter access to the read-only creative-context role contract.

## 0.6.4

### Patch Changes

- 9204f85: Fix the Context tab's dropdown in the Share dialog rendering invisibly behind the host popover and dismissing the whole dialog on interaction. The select now matches the popover's nested-overlay z-index and is marked so `ShareButton` doesn't treat clicks inside it as outside clicks.

## 0.6.3

### Patch Changes

- 25f588e: Redirect legacy `/agent` management URLs to the canonical settings routes and preserve app-owned settings tabs.
