# Archetype & Hybrid Profile System UI Implementation Plan

Based on my analysis of the `c:\protoai` repository, the backend implementation for the hybrid profile system (which includes inheritance resolution, loading, and merging) is **already complete** across `cli/claude-select.cjs`, `SettingsManager.js`, `FsProfileRepository.js`, and `ListProfilesWorkflow.js`. 

The remaining work is entirely in the UI layer. Currently, the `Settings.ui.js` panel displays archetypes as clickable "chips" that set the default profile, but it lacks the interface to create, edit, and save custom profiles that inherit from these archetypes.

## Proposed Changes

### 1. `tauri-app/ui/index.html`
We will update the `#settings-profiles` section to include a new **Custom Profiles** management area:
- Add a dropdown to select an existing custom profile to edit, or a "Create New" option.
- Add input fields for:
  - **Profile ID/Name**
  - **Base Archetype** (Dropdown populated from `_profiles.archetypes`, plus a "None" option)
  - **System Prompt Override** (Textarea to add specific instructions on top of the archetype)
  - **Model Override** (Dropdown to override the default model)
- Add **Save** and **Delete** buttons.

### 2. `tauri-app/ui/modules/ui/Settings.ui.js`
We will add the interaction logic to power the new HTML:
- Add an `_updateCustomProfileForm()` function that fills the form when a profile is selected.
- Wire up the Save button to update `_settings.profiles.userProfiles[id]` with the new profile data `{ name, archetypeId, system, model }`.
- Persist the changes using the existing IPC command: `_callTauri("settings_set", { key: "profiles.userProfiles", value: _settings.profiles.userProfiles })`.
- Wire up the Delete button to remove the key from `_settings.profiles.userProfiles` and save.
- Ensure that after saving/deleting, we refresh the profiles via `_loadProfiles()` and update the dropdowns via `_populateProfileSelects()`.

## User Review Required

> [!IMPORTANT]
> The backend relies on an ID string for each profile (e.g., `my-custom-profile`). When a user types a Name like "My Custom Profile", I plan to auto-generate the ID by lowercasing and replacing spaces with hyphens. Let me know if you prefer a different approach.

## Verification Plan
1. Open the ProtoAI Settings (Ctrl+Shift+S) and navigate to the Profiles tab.
2. Create a new custom profile, select an archetype as its base, and add a custom system prompt.
3. Save the profile and verify it appears in the "Default AI Profile" dropdown.
4. Select it as the default, close settings, and send a chat message to verify the new profile is actively used by the orchestrator.
