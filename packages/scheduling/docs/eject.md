# Ejecting `@agent-native/scheduling`

For full customization, you can move the package source into your own repo.

Preview the complete change report, then apply it explicitly:

```bash
agent-native package eject @agent-native/scheduling
agent-native package eject @agent-native/scheduling --apply
```

The command copies the published source into `packages/scheduling`, updates the
consumer dependency to `workspace:*`, preserves canonical
`@agent-native/scheduling` imports, and runs the detected package manager. It
refuses an existing target, unsupported workspace layout, or other collision.
All writes and lockfiles roll back if installation fails.

Now you own the code and can modify it freely. Upstream updates are available via
`npm view @agent-native/scheduling versions` — you can selectively port changes.
