# Clips Search Debounce Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Debounce the Clips library recording search by 200ms without changing the search bar's appearance or immediate input behavior.

**Architecture:** The search bar retains an immediate controlled `query` for rendering and interaction, while a local effect maintains a trailing `debouncedQuery`. Only the action-backed `useRecordingSearch` hook receives the delayed value, keeping the timing policy local to this component.

**Tech Stack:** React, TypeScript, Vitest, React DOM test utilities, oxfmt

### Task 1: Debounce the recording search call

**Files:**
- Modify: `templates/clips/app/components/library/search-bar.tsx`

**Step 1: Add debounced state**

Directly after the existing `query` state, add:

```tsx
const [debouncedQuery, setDebouncedQuery] = useState("");
```

**Step 2: Add the trailing timer**

Before the search hook call, add:

```tsx
useEffect(() => {
  const timeout = setTimeout(() => setDebouncedQuery(query), 200);
  return () => clearTimeout(timeout);
}, [query]);
```

**Step 3: Use the debounced query for data fetching**

Replace:

```tsx
const { data, isFetching } = useRecordingSearch(query);
```

with:

```tsx
const { data, isFetching } = useRecordingSearch(debouncedQuery);
```

**Step 4: Preserve presentation**

Do not change JSX, class names, inline behavior, media queries, popover visibility, highlighting, or user-facing copy.

### Task 2: Cover debounce timing

**Files:**
- Modify: `templates/clips/app/components/library/search-bar.test.tsx`

**Step 1: Make the search mock observable**

Add `recordingSearch: vi.fn()` to the hoisted mocks and have the `useRecordingSearch` mock pass its query argument into that spy before returning empty results.

**Step 2: Add fake-timer coverage**

Add a test that renders the component, changes the input to multiple values within the debounce window, verifies the latest value has not reached the hook before 200ms, advances timers to 200ms, and verifies the latest query reaches the hook.

**Step 3: Keep tests isolated**

Reset the new mock and restore real timers between tests.

### Task 3: Verify

**Files:**
- Verify: `templates/clips/app/components/library/search-bar.tsx`
- Verify: `templates/clips/app/components/library/search-bar.test.tsx`

**Step 1: Format modified source files**

Run:

```bash
pnpm exec oxfmt templates/clips/app/components/library/search-bar.tsx templates/clips/app/components/library/search-bar.test.tsx
```

Expected: command exits 0.

**Step 2: Run the targeted test**

Run:

```bash
pnpm --dir templates/clips test app/components/library/search-bar.test.tsx
```

Expected: all `SearchBar` tests pass.

**Step 3: Run Clips typecheck**

Run:

```bash
pnpm --dir templates/clips typecheck
```

Expected: command exits 0 with no TypeScript errors.

**Step 4: Review the diff**

Confirm the source diff changes only search timing and test coverage, with no visual or style changes.
