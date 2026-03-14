# Keyframe Sync Prevention Guide

## The Problem

When a composition is first loaded, it saves track data (including `keyframes: []`) to `localStorage`. If you later add keyframes to the registry, the localStorage version (with empty keyframes) was overriding the registry version.

## Safeguards Now in Place

### 1. **Smart Merge Logic** ✅

`client/contexts/TimelineContext.tsx` now intelligently merges keyframes:

```typescript
// If localStorage has empty keyframes but registry has keyframes, use registry
const useRegistryKeyframes =
  (!storedProp.keyframes || storedProp.keyframes.length === 0) &&
  defProp.keyframes &&
  defProp.keyframes.length > 0;
```

**Result**: Adding keyframes to the registry will automatically work on next reload.

### 2. **Console Validation Warnings** ✅

When keyframes are defined in registry but not showing in timeline, you'll see:

```
⚠️ Registry has keyframes but they're not showing in the timeline!
Composition: ui-showcase
Fix: Run in console: localStorage.removeItem('videos-tracks:ui-showcase'); location.reload();
```

### 3. **Developer Reset Utilities** ✅

Available in browser console:

```javascript
// Reset the current composition
resetCurrent();

// Reset just keyframes/tracks for a specific composition
resetTracks("ui-showcase");

// Reset everything (tracks, props, settings)
resetCompositionSettings("ui-showcase");
```

**Pro tip**: These are automatically loaded and available in `window`.

### 4. **Detailed Logging** ✅

When keyframes are loaded from registry, you'll see:

```
🔄 Using registry keyframes for "x" (9 keyframes from code)
```

This confirms the merge is working correctly.

### 5. **Comprehensive Documentation** ✅

- Registry file (`client/remotion/registry.ts`) has detailed header docs
- Reset utility (`client/utils/resetComposition.ts`) explains usage
- This guide! 📖

## Best Practices

### ✅ DO:

- **Define keyframes in registry from the start** when creating new compositions
- **Use resetTracks() during development** when testing new keyframes
- **Check browser console** for validation warnings
- **Save button preserves keyframes** - using the Save button writes current keyframes to registry

### ❌ DON'T:

- Don't manually edit localStorage (use reset utilities instead)
- Don't assume keyframes will auto-update without a reset (they will on _next_ fresh load, but existing localStorage needs clearing)

## Quick Fixes

### "I added keyframes but don't see them"

**Option 1**: Console reset (instant)

```javascript
resetTracks("your-composition-id");
// then refresh page
```

**Option 2**: Manual localStorage clear

```javascript
localStorage.removeItem("videos-tracks:your-composition-id");
location.reload();
```

**Option 3**: Hard refresh

- Close all tabs with the app open
- Open in new tab/window
- Should auto-sync on first load

### "I want to test keyframes without affecting users"

1. Use a different composition ID during development:

   ```typescript
   id: "ui-showcase-dev"; // Test version
   ```

2. Once finalized, rename back to production ID:

   ```typescript
   id: "ui-showcase"; // Production version
   ```

3. Users will get fresh keyframes on first load of the new ID

## Technical Details

### Merge Priority (from highest to lowest):

1. **User-created keyframes** (manually added in timeline) → Always preserved
2. **Registry keyframes** → Used if localStorage has empty array
3. **Empty array** → Only if both stored and registry are empty

### When Keyframes Sync:

- ✅ New composition loaded for first time
- ✅ localStorage cleared via reset utilities
- ✅ Registry keyframes added when localStorage has empty array
- ❌ Automatic sync when localStorage already has empty array (use reset)

### Cross-Tab Sync:

Changes are automatically synced across tabs via `storage` event listeners. If you reset in one tab, other tabs will pick up the changes.

## Testing Checklist

When adding new keyframes to a composition:

- [ ] Add keyframes to registry track definition
- [ ] Test in browser console: `resetTracks('composition-id')`
- [ ] Verify keyframes appear in timeline
- [ ] Play composition to test animation
- [ ] Check console for any warnings
- [ ] Document in composition description if this changes existing behavior

## Future Improvements

Potential enhancements to consider:

1. **Version tracking**: Add version number to tracks in registry, auto-reset if version changes
2. **UI indicator**: Show badge when registry has newer keyframes than localStorage
3. **Auto-migration**: Prompt user to reset when keyframe mismatch detected
4. **Dev mode**: Flag to always prefer registry over localStorage during development

---

**Last Updated**: March 2, 2026  
**Related Files**:

- `client/contexts/TimelineContext.tsx` (merge logic)
- `client/utils/resetComposition.ts` (reset utilities)
- `client/remotion/registry.ts` (composition definitions)
