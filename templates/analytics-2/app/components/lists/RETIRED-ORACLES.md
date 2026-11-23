# Oracles retired with the pre-rebuild list shell (row 514 decision, 11-10 11:33)

Ported into app/components/projects/ProjectsListView.ported-oracles.spec.tsx (3 executable tests):

- title sort both directions (ProjectsTitleSortUrl)
- current person's name vs another owner's email (ProjectsOwnerIdentities)
- rows render in the order given for the current person (ProjectsMyAccess)

Already covered by the rebuilt view's own specs, so not ported again:

- ProjectsListView.spec.tsx: sort labels + real-field sort, title/favorites/owner filter, headers and column order, empty/loading/error states, row hrefs, owner display, 66-row listing
- ProjectsSortMenu.spec.tsx, ProjectsListView.status.spec.tsx, ProjectsListView.emptyStates.spec.tsx, CollectionsPage.spec.tsx, ThreadsPage.spec.tsx

NO equivalent in the rebuilt view; retired here and filed as a capability row instead of dropped silently:

- ProjectsAccessUrl (13): deep-linked access role URLs, encoded role normalisation, atomic access+view+duration apply
- ProjectAccessSummaryColumns (10): effective access, inherited edit, distinct-principal counting, 66-row summary reads
- ProjectsCreatorMultiple / CreatorMultipleChoices / CreatorIdentities / CreatorSearch / CreatorSelectedOptions (5+3+4+6+3): multi-creator filter and creator search
- ProjectsOwnerSearch.optional / .typed (7+7): owner search by email with directory debounce
- ProjectsCollapsedFilters (3), ProjectsInlineFilters (4), ProjectsOptionalFilters (4): collapsed and inline filter menus
- CollectionEditAction.behavior (2), CollectionsSharingSummary (1), ProjectCollectionsColumn (2): collection edit menu and sharing summary
- ProjectsMyAccess (9): the my-access filter/column
- WorkspaceListRoute.trash-default (3): the route's default trash view
- ArchivedListDisplaySettings (1): per-kind column preferences
