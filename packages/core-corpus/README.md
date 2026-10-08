# @agent-native/core-corpus

Optional, version-matched source corpus for `@agent-native/core` source-search.
Install it in an app when agents need searchable framework and template source:

```bash
pnpm add @agent-native/core-corpus@$(node -p "require('./node_modules/@agent-native/core/package.json').version")
```

The package contains generated source snapshots. Canonical source remains in
the Core, Toolkit, and template packages in the framework repository.
