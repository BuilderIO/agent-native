# Shared command-menu architecture

Status: planned follow-up. Do not treat the current app-specific command menus
as the long-term architecture.

## Decision

Use `cmdk` as the interaction engine, keep the command-menu shell and registry
contract in shared Agent-Native code, and let each app register its own commands
and searchable resources.

The shared layer should own the behavior that must be identical everywhere:

- Cmd/Ctrl+K opening, toggling, focus, and dismissal
- the dialog, input, list, group, item, shortcut, loading, and empty states
- keyboard navigation, selection, and accessible labeling
- command ranking and the boundary between static commands and async results
- common framework commands such as theme, agent, settings, changelog, and
  diagnostics

Apps should own only their domain knowledge:

- localized command labels and descriptions
- icons, keywords, shortcuts, and visibility rules
- route-aware context and permission checks
- command handlers that call the app's existing action/navigation surfaces
- async search providers for resources such as recordings, meetings,
  dictations, documents, or CRM records

The shared layer must not become a universal data index or import app routes.
It coordinates registered providers; it does not invent domain results.

## Proposed contract

The core package should expose a registry/provider API along these lines:

```ts
type CommandContext = {
  pathname: string;
  searchParams: URLSearchParams;
  appId: string;
  organizationId?: string;
};

type CommandDefinition = {
  id: string;
  group: string;
  label: string;
  description?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  availableWhen?: (context: CommandContext) => boolean;
  run: (context: CommandContext) => void | Promise<void>;
};

type CommandSearchProvider = {
  id: string;
  search: (
    query: string,
    context: CommandContext,
  ) => Promise<CommandDefinition[]>;
};
```

The final names and exact shape should follow the existing core type conventions.
The important boundary is that the menu renders descriptors and provider
results instead of each app manually rebuilding the palette's React tree and
filtering its children.

## Current state

The repository already has the beginnings of this split:

- `packages/toolkit/src/ui/command.tsx` wraps the `cmdk` primitive.
- `packages/core/src/client/CommandMenu.tsx` owns the shared dialog shell,
  keyboard hook, framework entries, and composable group/item surface.
- `templates/clips/app/components/clips-command-menu.tsx` currently owns the
  Clips registry, route context, navigation handlers, and recording/meeting/
  dictation search providers.

The remaining problem is that app registries are still hand-authored JSX. The
same pattern exists in other templates, so improvements currently require
duplicated work and can drift in behavior.

## Migration plan

1. Add the shared descriptor/provider types and registry context in core.
2. Make the shared `CommandMenu` render registered descriptors while keeping
   its existing composable API temporarily for compatibility.
3. Move common framework commands into the shared registry.
4. Convert Clips from `ClipsCommandMenu` JSX groups to registered static
   commands plus registered search providers. Preserve its route-aware
   commands and action-backed searches.
5. Convert the other app menus (including CRM, Forms, Dispatch, and Macros) to
   the same registration surface.
6. Remove duplicate per-app shortcut listeners and bespoke static filtering
   after all consumers migrate.
7. Add shared contract tests for registration, availability, ranking, async
   loading, stale-result suppression, keyboard selection, and contextual
   commands; retain app tests for domain-specific handlers and routes.

## Acceptance criteria

- An app can add commands and search providers without copying the command
  dialog or keyboard handling.
- A command is hidden when its app-provided context or permission predicate
  says it is unavailable.
- Search results can navigate through the app's existing client routing and
  actions without raw API calls or a second data model.
- Async providers show loading and empty states consistently and cannot display
  stale results from a previous query or route.
- Cmd/Ctrl+K opens exactly one menu in a host containing multiple Agent-Native
  surfaces.
- App-local commands remain localized and can link to the current resource,
  folder, meeting, or dictation context.

## Non-goals

- Replacing `cmdk` with a second command-palette dependency.
- Putting app route definitions or resource-specific SQL in core.
- Creating one global search endpoint that every app must use.
- Refactoring the current Clips menu as part of an unrelated UX-fixes change.
