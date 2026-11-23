# Sidebar and shell regression evidence

The current host suite compares mounted output with `__goldens__`. `current-captures.json` inventories every active artifact, its integrity digest, selected rows and diagnostic pair. A changed token, control, route, markup or root envelope fails the exact comparison. The integrity test also checks every recorded row against its actual markup.

The separate `reference-fixtures` directory preserves historical migration evidence. Its initial source revision was `b4983f49f190c3a8a605209d1e42ae38e655b5ce`; later scoped capture additions are recorded in `DEVIATIONS.md`. `captures.json`, `rows.json` and the unused reference renderer consume that archive. Its 135-row accounting describes historical coverage, not current product coverage. Row 822 moved all historical fixture bytes intact and gave current host output its own baseline; reference-renderer assertions and historical integrity checks remain active.

Run from `templates/analytics-2`:

```sh
npx vitest run app/testing/sidebar-shell --maxWorkers=2
```

Vitest 4.1.9 discovers this directory with the existing config. No include override is needed. Only this directory's specs run. No server, window, service, account or dependency is required.

The historical `captures.json` maps selected surfaces to frozen row ids, state overrides and fixture source files, and lists all rows including the excluded search body. `rows.json` preserves the supplied 135-row input, including 114 counted swap/custom boundaries. This is baseline evidence, not achieved shared-renderer or strict coverage.

In both directories, each `*-surface.json` is the selected markup and complete root attribute envelope. CSS-hidden workspace copies are removed from its markup and retained as `hiddenCopies`. The adjacent file without `-surface` is the unfiltered mounted DOM diagnostic and its interactive elements. Presence selectors in `row-contracts.ts` check each credited row against the selected markup. Parent/shortcut ownership credits refer to the mounted owning region, since a listener has no independent element. Root attribute maps contain only attributes actually present; omitted attributes are absent, not inferred.

The envelope records HTML/body classes, attributes and inline styles, inline root custom properties, every global `--ws-*` token, color scheme, route, viewport/media answers, host attributes, named storage values and storage calls. Storage uses an in-memory browser-shaped fixture because this Node version's native storage is unavailable without a storage file. Images use a synthetic local URL. Fetch throws on any call. No credential fields or real account data are supplied. The fixed clock is 2026-11-12 08:00 UTC; React-generated ids are consistently normalized in markup and ID references. Other authored attributes remain unchanged.

`boot-theme-*` isolates the actual theme inline script plus the real theme menu controller, over ten storage inputs, two media values and two viewport classes. `app-inline-boot-*` additionally executes the locale inline script before mounting. First-render observations use a sibling layout effect after the shell commit and before passive effects; settled observations flush effects and timers. The toolkit boolean codec is a separate hook witness, not an Analytics collapse controller. Analytics owns no persisted desktop collapse state. Codec-unavailable records the distinct unreadable-storage case.

Component captures mount the real shell/rail/dialog boundaries with synthetic data. Workspace frame tests mount the real routing host but use a domain-content sentinel and mock the excluded global-search body. Error-boundary tests mock unused root imports. The welcome skeleton is the actual renderer without the provider's authentication/readiness gate. Settings navigation is read and mounted, but no Settings file is changed. The unused experience reskin is never enabled. Custom dialog and re-token rail captures do not claim shared schema coverage.

happy-dom does not compute physical layout. CSS widths, class names, inline styles and `data-closed` are evidence of the inputs to layout, not measured pixels. There are no screenshot files. Real browser painting, transitions, focus/tab order, CSS imports (fonts/toolkit/Tailwind), provider theme-family writers and authenticated destinations require separate browser evidence. `index.limits` records the remaining proof boundaries and unreachable host states.

The normal command never writes a golden. Initial creation requires `AGENT_NATIVE_CAPTURE_NEW_BASELINES=1` in a local Vitest test run (test mode, development, non-production, and CI absent) and uses exclusive `wx`; even that mode refuses to overwrite an existing file. A mismatch fails with the frozen file intact. Do not use snapshot-update flags. Both manifests independently reject changes to their frozen artifacts. Baseline maintenance requires an explicit review of the host changes, a separate candidate capture directory, and unchanged comparison assertions. The default run cannot refresh its own oracle.

The current Context Studio rail contract keeps Setup, Connections, and Related settings. The rail spec removes the retired destinations from its in-memory copy of each historical capture, then compares the complete remaining markup and link observations.
