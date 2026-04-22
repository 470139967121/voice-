# Admin Panel Restructure — PR C Implementation Plan

**Date:** 2026-04-17
**Branch:** refactor/admin-panel-pr-c
**Parent:** PR A (#289) + PR B (#301) — core modules + tab extraction done
**Goal:** Wire tab modules as authoritative source, remove ~9,500 lines of inline JS from index.html

## Current State

- `public/admin/index.html`: 14,487 lines (5,000 HTML + 9,500 inline JS)
- `public/admin/js/main.js`: 148 lines (auth, store, tab config, module pre-loading)
- `public/admin/js/tabs/*.js`: 15 module files (6,890 lines total)
- `public/js/core/*.js`: 5 shared modules (state, auth, api, ui, tabs)
- Modules are **additive** — pre-loaded silently, inline script still authoritative
- 28 Playwright admin spec files with 400+ tests — all passing

## Architecture

### Tab Module Contract
Each module must export:
- `init(deps)` — one-time setup (event listeners, DOM refs). Called on first activation.
- `activate(deps)` — called every time tab becomes active (load data, start listeners)
- `deactivate()` — called when switching away (cleanup listeners, abort requests)

### Wiring Flow
1. `main.js` calls `tabs.register(tabId, module)` for each loaded module
2. Tab button clicks call `tabs.show(tabId)` which:
   - Calls previous tab's `deactivate()`
   - Shows the panel (DOM visibility)
   - Calls `init()` on first visit, then `activate()`

### Auth Flow Transfer
The inline script has its own `onAuthStateChanged` that does admin claim checking + dashboard setup. `main.js` already has `authHandler` ready but not wired. PR C wires it.

## Execution Order

### Phase 0: Auth + Tab Framework Wiring
**Risk: HIGH** — affects all tabs. Must be done first and carefully.

1. Wire `onAuthStateChanged` in main.js to use `authHandler`
2. Wire tab button click handlers to call `tabs.show(tabId)`
3. Import Firestore SDK in main.js (currently deferred due to duplicate init conflicts)
4. Register all 15 tab modules in main.js
5. Remove inline auth flow code
6. Remove inline tab switching code (`showTab()` function)

### Phase 1-15: Tab Wiring (one at a time, simplest first)

For EACH tab:
1. **Verify tests exist** — check existing Playwright coverage, write additional tests if gaps
2. **Run tests** — confirm all pass with inline code (baseline)
3. **Wire module** — ensure `init/activate/deactivate` replicate inline behavior
4. **Remove inline code** — delete the inline functions for this tab only
5. **Run ALL tests** — confirm zero regressions

**Order (simplest → most complex):**

| Step | Tab | Module Lines | Test File(s) | Test Count | Risk |
|------|-----|-------------|--------------|------------|------|
| 1 | Audit Log | 180 | admin-panel.spec.ts (partial) | ~10 | Low |
| 2 | Backups | 248 | admin-backups.spec.ts | 8 | Low |
| 3 | Appeals | 213 | admin-appeals.spec.ts | 10 | Low |
| 4 | Fun Facts | 256 | admin-funfacts.spec.ts | 10 | Low |
| 5 | Maintenance | 203 | admin-maintenance.spec.ts | 16 | Low |
| 6 | Banners | 449 | admin-banners.spec.ts | 12 | Medium |
| 7 | Devices | 265 | admin-devices.spec.ts | 14 | Medium |
| 8 | Economy Config | 404 | admin-economy-config.spec.ts | 16 | Medium |
| 9 | Gifts | 356 | admin-gifts.spec.ts | 14 | Medium |
| 10 | Spin Monitor | 642 | admin-spin-monitor.spec.ts | 10 | Medium |
| 11 | Logs | 825 | admin-logs.spec.ts + admin-alerts.spec.ts | 28 | High |
| 12 | Reports | 756 | admin-reports.spec.ts + admin-keyboard.spec.ts | 28 | High |
| 13 | Starting Screens | 1029 | admin-starting-screens.spec.ts | 45 | High |
| 14 | Suggestions | 859 | admin-suggestions.spec.ts | 93 | High |
| 15 | Users | 41→full | admin-users-*.spec.ts (5 files) | 57 | Critical |

### Phase 16: Final Cleanup
1. Remove the empty inline `<script type="module">` block
2. Remove backwards-compat shims from PR A (window.* globals)
3. JSDoc for core module exports
4. Update CLAUDE.md with new module layout
5. Verify no `window.*` globals leak (console check)
6. Run ALL tests one final time

## Testing Strategy

- **Existing tests are the safety net** — 400+ Playwright tests must pass at every step
- **Write additional tests** where coverage gaps exist (especially for init/activate/deactivate lifecycle)
- **Run ALL Playwright tests locally** after each tab wiring (not just the tab-specific tests)
- **CI validates** across 5 browsers after push

## Risks

1. **Firestore SDK duplicate init** — main.js and inline both init Firebase. Must be resolved in Phase 0.
2. **Shared state** — inline functions share module-level variables. Modules must maintain equivalent state.
3. **Event listener lifecycle** — inline code adds listeners once on page load. Modules must do the same in `init()`, not `activate()`.
4. **DOM timing** — inline script runs as type="module" (deferred). Module execution order may differ.
5. **Cross-tab references** — some tabs call functions from other tabs (e.g., Reports → Users search). Must be handled via imports or pub/sub.
