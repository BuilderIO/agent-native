Use `PageHeader` when the workspace needs a heading and commands that apply to the whole view. Place `PageHeaderTitle` in reading order before `PageHeaderActions`. A leading slot can hold navigation such as a mobile sidebar toggle.

Group related icon commands in a named `Toolbar` and give each `ToolbarButton` a name that states its action. Keep a distinct primary command, such as Compose, as a sibling `Button` inside `PageHeaderActions`. The header arranges its children. The application supplies the active page title and handles each command.

```tsx
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderTitle,
} from "@agent-native/toolkit/ui/base-ui/page-header";

<PageHeader>
  <PageHeaderTitle>Inbox</PageHeaderTitle>
  <PageHeaderActions>{inboxActions}</PageHeaderActions>
</PageHeader>;
```

See [Toolbar](?path=/docs/components-toolbar--docs) for grouping related commands with arrow-key navigation.
