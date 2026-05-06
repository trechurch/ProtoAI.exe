# Plan: File Manager Redesign — Split-Screen Files Tab

**Status:** 🔲 NOT STARTED — `activateCodeTab()` is defined in `app.js` (the fix from item #79), but the two-pane `#fileMgrWrapper` / `#folderTree` / `#fileList` layout has not been implemented. `renderRightFiles` in `PrimaryPanel.ui.js` still uses the flat single-column approach. Full implementation pending.

## Context
The current Files tab in the right pane is a flat single-column list with a top breadcrumb bar. It has no persistent folder tree, no drag-and-drop, context menu items are missing (no Move/Copy), tier badges aren't shown inline on items, and `activateCodeTab()` is called but never defined. The user wants a proper two-pane file manager: folder tree (expandable, VS Code style) + file list with multi-select, full context menu, drag-to-move, double-click-to-open, and inline tier badges.

## Layout Rules

- **Split is top/bottom** (horizontal divider) → right pane is wide → folder tree LEFT, file list RIGHT (side by side)
- **Split is left/right** (vertical divider) → right pane is narrow → folder tree TOP, file list BOTTOM (stacked)
- Detect via: compare `rightPane.offsetWidth` vs `rightPane.offsetHeight`; if width > height → side-by-side, else → stacked
- Re-evaluate on `ResizeObserver` attached to `#rightPaneContent`

## Architecture

### Two sub-panes inside `renderRightFiles(container)`

```
#fileMgrWrapper  (flex-row or flex-col depending on layout)
  #folderTree    (expandable VS Code-style tree, ~30% width or ~35% height)
  #fileList      (flat list of files in selected folder, flex:1)
```

No more single `#fileTreeContainer` doing both jobs.

---

## Folder Tree (`#folderTree`)

- Rendered from `ListFilesWorkflow` responses, cached per path
- Each node: chevron (▶/▼) + folder icon + name
- Expand in-place (no navigation, tree stays visible)
- Click = select folder (loads its files into `#fileList`)
- Lazy-load children on first expand (call `ListFilesWorkflow` with that path)
- Selected folder highlighted with accent background
- Drag target: each folder node accepts `dragover` + `drop` of file items
- Tier badge on folders (colored dot, cycles eager→cached→lazy→none on click)

## File List (`#fileList`)

- Shows files (not subfolders) of the currently selected folder
- Multi-select: click = single select, Ctrl+click = toggle, Shift+click = range
- Selected items get `.selected` class + accent background
- Drag source: selected files can be dragged; `draggable="true"` on items
- Double-click → open file in Monaco (fix `activateCodeTab()`)
- Each row: icon + name + size + modified date + tier dot
- Tier dot: small colored circle (green=eager, blue=cached, orange=lazy, grey=none)
  - Click cycles through: none → eager → cached → lazy → none
  - Calls `FilePermissionsWorkflow` action `"grant"` or `"revoke"`

## Context Menu (right-click on file list or folder tree)

Extend existing `showFileContextMenu()`. Items shown based on selection state:

| Item | Condition |
|------|-----------|
| Open | single item |
| Open in Editor | single file |
| New File | always |
| New Folder | always |
| ── separator ── | |
| Rename | single item |
| Move to… | any selection |
| Copy to… | any selection |
| ── separator ── | |
| Set Tier → eager / cached / lazy / none | any selection |
| ── separator ── | |
| Delete | any selection (red) |
| ── separator ── | |
| Properties | single item |

Move/Copy: show a simple folder picker overlay (reuse the folder tree, let user click a destination folder, then call `fs_rename` for move or `fs_copy` for copy).

## Drag and Drop

- File items: `draggable="true"`, `dragstart` stores `{ paths: [...selectedPaths] }` in `event.dataTransfer`
- Folder tree nodes: `dragover` (prevent default, highlight), `dragleave` (remove highlight), `drop` (read paths, call `fs_rename` for each, refresh both panes)
- Visual: folder node gets a `.drag-over` class (accent border) during hover

## Fix: `activateCodeTab()`

Define this function in `app.js`:
```js
function activateCodeTab() {
  const tab = document.querySelector('#rightModeTabs .tab[data-mode="code"]');
  if (tab) tab.click();
}
```
This switches the right pane to the Code tab, which triggers `renderRightCode()` and Monaco init.

## Tier Badge

```js
const TIER_CYCLE = [null, "eager", "cached", "lazy"];
const TIER_COLOR = { eager: "#4caf50", cached: "#2196f3", lazy: "#f59e0b", null: "#555" };
```

- Badge is a `<span>` with `border-radius:50%; width:8px; height:8px; background: TIER_COLOR[tier]`
- Click: get current tier for this path from permissions cache → advance in TIER_CYCLE → call `FilePermissionsWorkflow`
- Cache permissions response in memory (invalidate on any grant/revoke/set-tier call)

## Files to Modify

| File | Changes |
|------|---------|
| `ui/app.js` | Replace `renderRightFiles()` + `loadAndRenderFileTree()` with new two-pane implementation; add folder tree logic, drag-and-drop, tier badges, Move/Copy menu, fix `activateCodeTab()`, add `ResizeObserver` for layout switching |
| `ui/styles.css` | Add styles for `.folder-tree`, `.folder-node`, `.folder-node.open`, `.folder-node.selected`, `.file-list`, `.file-row`, `.file-row.selected`, `.tier-dot`, `.drag-over`, `.context-menu-separator`, `.ctx-submenu` |
| `ui/index.html` | No structural changes needed — `#rightPaneContent` is the mount point |
| `tauri-app/src-tauri/src/commands.rs` | Verify `fs_copy` command exists; add if not |

## Rust command check

Need to confirm `fs_copy` exists in `commands.rs`. If not, add:
```rust
#[tauri::command]
async fn fs_copy(src: String, dest: String) -> Result<(), String> {
    std::fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
}
```

## Key Reused Functions / Patterns

- `runWorkflow("ListFilesWorkflow", { project, path })` — already works, reuse for lazy-loading tree nodes
- `runWorkflow("FilePermissionsWorkflow", { action, project, file/directory, tier })` — reuse for tier changes
- `openFile(fileOrFolder)` — reuse, just fix `activateCodeTab()`
- `renameFile()`, `deleteFile()`, `showFileProperties()` — reuse unchanged
- `showFileContextMenu()` — extend, don't replace
- `TIER_COLOR` constants match existing dialog (`#4caf50`, `#2196f3`, `#f59e0b`)
- Existing `fs_rename`, `fs_unlink`, `fs_remove`, `fs_read_file`, `fs_stat`, `fs_write_file`, `fs_mkdir` Tauri commands

## Permissions Cache

```js
let _permissionsCache = null; // { project, grantedPaths: [...] }
async function getPermissions() {
  if (_permissionsCache?.project === currentProject) return _permissionsCache;
  const res = await runWorkflow("FilePermissionsWorkflow", { action: "list", project: currentProject });
  _permissionsCache = res;
  return res;
}
function invalidatePermissions() { _permissionsCache = null; }
```

## State Variables to Add

```js
let _folderTreeState = {};   // { [path]: { expanded, children } } — tree expand state
let _selectedFolder = "";    // currently selected folder path (relative)
let _permissionsCache = null;
```

## Verification

1. Open app, switch to Files tab — see two panes (folder tree + file list)
2. Click a folder in tree — file list updates with that folder's files
3. Click ▶ chevron — tree expands in place showing subfolders
4. Ctrl+click multiple files — multi-select works, count badge updates
5. Right-click → full menu appears with Move, Copy, Set Tier submenu
6. Drag a file onto a folder in the tree — file moves, both panes refresh
7. Double-click a file — code tab activates, Monaco loads the file content
8. Click tier dot — cycles through colors, badge updates, permission persists
9. Resize split from top/bottom to left/right — layout switches orientation
10. Right-click a folder → Set Tier → sets directory-level permission
