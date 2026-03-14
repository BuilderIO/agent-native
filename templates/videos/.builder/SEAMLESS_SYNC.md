# Seamless Registry-LocalStorage Sync System

## ✅ What's Implemented

### 1. **Visual Save Button States**

**🟢 Green Save Button** = You have unsaved changes

- localStorage has overrides that differ from registry
- Click to sync your changes to registry
- Shows tooltip: "Save current settings as default"

**⚪ Grey Save Button** = Everything is synced

- No localStorage overrides
- Registry and working state are identical
- Shows tooltip: "All changes saved to registry"

**Implementation**: `useUnsavedChanges()` hook detects localStorage presence

### 2. **Auto-Save After AI Generation**

When AI creates or modifies a composition:

1. AI finishes (fires `builder.agentChat.chatRunning` event with `isRunning: false`)
2. System waits 1 second for localStorage to settle
3. **Automatically saves to registry** (silent mode, no alerts)
4. Clears localStorage
5. Reloads page with clean registry defaults
6. 🟢 **Save button turns grey** (everything synced!)

**Flow**:

```
User asks AI to change composition
  ↓
AI makes changes (auto-saves to localStorage)
  ↓
AI finishes (event fires)
  ↓
System auto-saves to registry (silent)
  ↓
localStorage cleared
  ↓
Page reloads
  ↓
✅ Registry and localStorage in perfect sync!
```

### 3. **Orange Indicator + Reset Button**

Still shows when you have localStorage overrides, but:

- Now correctly disappears after Save
- Perfectly syncs with Save button color
- One-click reset available

## 🎯 Complete User Experience

### Scenario 1: Manual Editing

```
1. User edits composition
   🟡 Orange indicator appears
   🟢 Save button turns green

2. User clicks Save
   ✅ Confirmation dialog
   ✅ Saves to registry
   ✅ Clears localStorage
   ✅ Reloads page

3. After reload:
   ⚪ No orange indicator
   ⚪ Grey Save button
   ✅ Perfect sync!
```

### Scenario 2: AI Generation

```
1. User asks AI to create composition
   🤖 AI generates code
   🟡 Changes auto-save to localStorage
   🟢 Save button green

2. AI finishes
   🤖 Auto-save triggers (silent)
   ✅ Saves to registry
   ✅ Clears localStorage
   ✅ Reloads page

3. After reload:
   ⚪ No orange indicator
   ⚪ Grey Save button
   ✅ Perfect sync automatically!
```

### Scenario 3: Version Bump

```
Developer adds keyframes to registry:

1. Increment version: 2
2. User loads composition
   🔄 Auto-detects version mismatch
   🔄 Clears stale localStorage
   ✅ Loads fresh registry defaults
   ⚪ Grey Save button (synced)
```

## 🛠️ Technical Details

### Files Modified:

**`client/hooks/useUnsavedChanges.ts`** (NEW)

- Hook that detects localStorage presence
- Returns `true` if unsaved changes exist
- Reactively updates when storage changes

**`client/pages/CompositionView.tsx`**

- Uses `useUnsavedChanges()` hook
- Save button styling: `hasUnsavedChanges ? green : grey`
- Refactored save into `performSave(silent)` function
- Listens for `videos.auto-save` event
- Auto-saves silently after AI generation

**`client/components/NewCompositionPopover.tsx`**

- Listens for `builder.agentChat.chatRunning` event
- Dispatches `videos.auto-save` when AI finishes
- Waits 1 second for localStorage to settle

**`client/contexts/TimelineContext.tsx`**

- Version tracking system
- Smart keyframe merge (registry wins when localStorage empty)
- Auto-clear stale data on version mismatch
- Comprehensive logging

**`client/remotion/registry.ts`**

- Added `version?` field to `CompositionEntry`
- Documented keyframe sync patterns
- UI Showcase uses `version: 3`

### Console Commands Available:

```javascript
// Reset current composition
resetCurrent();

// Reset only tracks/keyframes
resetTracks("composition-id");

// Reset everything
resetCompositionSettings("composition-id");
```

## 📊 State Machine

```
Registry (Source of Truth)
    ↓
localStorage (Working Copy)
    ↓ (user edits)
localStorage (Modified)
    🟢 Green Save + 🟡 Orange indicator
    ↓ (click Save OR AI finishes)
Registry (Updated)
    ↓ (localStorage cleared)
    ⚪ Grey Save + No indicator
```

## 🎨 Visual Indicators at a Glance

| State      | Save Button | Orange Indicator | Meaning                  |
| ---------- | ----------- | ---------------- | ------------------------ |
| Synced     | Grey ⚪     | Hidden           | Registry = localStorage  |
| Unsaved    | Green 🟢    | Visible 🟡       | localStorage has changes |
| After Save | Grey ⚪     | Hidden           | Auto-synced!             |
| After AI   | Grey ⚪     | Hidden           | Auto-synced!             |

## 🚀 Benefits

1. **No confusion** - Visual state makes it obvious if you're synced
2. **No manual work** - AI changes auto-save to registry
3. **No stale data** - Version bumps auto-clear localStorage
4. **No lost work** - localStorage still preserves edits during session
5. **One-click fixes** - Reset button when things go wrong

## 🎯 Best Practices

**For Developers**:

- Bump `version` when adding keyframes to existing compositions
- Document breaking changes in description
- Test auto-save flow after generating new compositions

**For Users**:

- 🟢 Green button = click to save your work
- ⚪ Grey button = everything's synced, no action needed
- 🟡 Orange badge = reminder you have unsaved changes
- AI changes save automatically - no manual save needed!

---

**Result**: Registry and localStorage stay in perfect sync with zero manual intervention! 🎉
