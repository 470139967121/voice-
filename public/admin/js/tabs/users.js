/**
 * Users tab — thin module wrapper.
 *
 * The users tab is the most complex admin tab (~1,600 lines with 5 subtabs,
 * auto-save infrastructure, list widgets, nationality dropdown, email masking,
 * GCS helpers, etc.). Its code remains in the inline script block for now.
 *
 * This module provides the critical exports that other tab modules depend on
 * (searchUserByUniqueId) so they can be wired up without circular dependencies.
 *
 * PR C will migrate the full inline users code into this module.
 */

// ── Exports consumed by other tab modules ─────────────────────────

/**
 * Programmatic user search — triggers the inline script's search handler.
 * Used by Reports, Suggestions, and Identity graph tabs to navigate
 * to a specific user when their ID is clicked.
 */
export function searchUserByUniqueId(uid) {
  const searchInput = document.getElementById('search-uid');
  const searchBtn = document.getElementById('search-btn');
  if (searchInput && searchBtn) {
    searchInput.value = uid;
    searchBtn.click();
  }
}

/** Placeholder — inline script manages this state. */
export function getCurrentUid() {
  // Read from the inline script's scope via a shared DOM element
  const el = document.getElementById('field-uniqueId');
  return el ? el.textContent.trim() : null;
}

// ── Tab lifecycle (no-ops — inline script handles everything) ─────

export function init() {}
export function activate() {}
export function deactivate() {}
