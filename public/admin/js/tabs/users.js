/**
 * Users tab — user search, profile editing, moderation, security, economy,
 * identity graph. The largest and most complex admin tab with 5 subtabs.
 *
 * Extracted from inline script block in index.html (PR B).
 * Contains shared infrastructure: auto-save fields, list widgets,
 * nationality dropdown, email masking, GCS helpers.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, showConfirm, escapeHtml } from '/js/core/ui.js';

// ── Dependencies (injected via init) ──────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);
let _switchTab = () => {};
let _getCurrentTab = () => '';
let _renderEvidence = () => '';
let _openEvidenceLightbox = () => {};

// ── State ─────────────────────────────────────────────────────────

let currentUid = null;
let currentFirebaseUid = null;
let loadedData = {};
let rawListData = {};
let listWidgetData = {};
let emailRevealed = false;

// ── DOM refs (resolved in init) ───────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
let fieldUid, searchUid, searchBtn, userForm;

// ── Public API ────────────────────────────────────────────────────

export function init(deps) {
  _apiBase = deps.apiBase || '';
  _getToken = deps.getToken || _getToken;
  _switchTab = deps.switchTab || _switchTab;
  _getCurrentTab = deps.getCurrentTab || _getCurrentTab;
  _renderEvidence = deps.renderEvidence || _renderEvidence;
  _openEvidenceLightbox = deps.openEvidenceLightbox || _openEvidenceLightbox;

  fieldUid = $('#field-uid');
  searchUid = $('#search-uid');
  searchBtn = $('#search-btn');
  userForm = $('#user-form');

  // Wire search
  searchBtn.addEventListener('click', doSearchFinal);
  searchUid.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearchFinal(); });

  // Wire subtab buttons
  for (const btn of $$('.user-subtab')) {
    btn.addEventListener('click', () => switchUserSubtab(btn.dataset.subtab));
  }

  // Wire all auto-save listeners, list widgets, and form controls
  // (these are set up by the code sections below)
  setupAutoSaveListeners();
  setupEconomyListeners();
  setupSuspensionListeners();
  setupAccountDeletionListeners();
  setupWarningListeners();
  setupSecurityListeners();
}

export function activate() {
  // Users tab is loaded on-demand via search, not on tab switch
}

export function deactivate() {
  // Flush any pending notifications
}

export async function searchUserByUniqueId(uid) {
  searchUid.value = uid;
  searchBtn.click();
}

export function getCurrentUid() { return currentUid; }
export function getCurrentFirebaseUid() { return currentFirebaseUid; }


// ── Field Helpers ──────────────────────────────────────────────────

// --- Field helpers ---
const ARRAY_FIELDS = ["blockedUserIds", "followingIds", "followerIds"];
const BOOLEAN_FIELDS = ["hideFollowing", "hideOnlineStatus", "hideAge"];
const TIMESTAMP_FIELDS = ["dateOfBirth", "createdAt", "lastSeenAt"];
const NULLABLE_FIELDS = [
  "avatarUrl", "profilePhotoUrl", "coverPhotoUrl", "description",
  "nationality", "email", "dateOfBirth"
];

function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Format as YYYY-MM-DDThh:mm for datetime-local input
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── List Widget Helpers ──────────────────────────────────────────

// --- List widget helpers ---
function getListWidget(field) {
  const map = { blockedUserIds: "list-blockedUserIds", followingIds: "list-followingIds", followerIds: "list-followerIds" };
  return $(`#${map[field]}`);
}

const _listSavePending = {};
async function autoSaveListField(field) {
  if (!currentUid) return;
  _listSavePending[field] = true;
  if (_listSavePending[field + '_busy']) return;
  _listSavePending[field + '_busy'] = true;
  try {
    while (_listSavePending[field]) {
      _listSavePending[field] = false;
      const items = (listWidgetData[field] || [])
        .map((s) => s.replace(/\s*\(.*\)$/, "").trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n));
      await apiCall("PATCH", `/api/user/${currentUid}`, { [field]: items }, { skipTabAbort: true });
    }
  } catch (err) {
    showToast(`Failed to save ${field}: ${err.message}`, "error");
  } finally {
    _listSavePending[field + '_busy'] = false;
  }
}

function renderListWidget(field) {
  const widget = getListWidget(field);
  if (!widget) return;
  const container = widget.querySelector(".list-items");
  container.innerHTML = "";
  const items = listWidgetData[field] || [];
  for (let i = 0; i < items.length; i++) {
    const div = document.createElement("div");
    div.className = "list-item";
    const span = document.createElement("span");
    span.className = "list-item-text";
    span.textContent = items[i];
    div.appendChild(span);
    const btn = document.createElement("button");
    btn.className = "list-item-remove";
    btn.textContent = "\u00d7";
    btn.addEventListener("click", () => {
      listWidgetData[field].splice(i, 1);
      renderListWidget(field);
      autoSaveListField(field);
    });
    div.appendChild(btn);
    container.appendChild(div);
  }
}

// Wire up list widget add buttons
for (const field of ["blockedUserIds", "followingIds", "followerIds"]) {
  const widget = getListWidget(field);
  if (!widget) continue;
  const addInput = widget.querySelector(".list-add input");
  const addBtn = widget.querySelector(".list-add button");

  const doAdd = () => {
    const val = addInput.value.trim();
    if (!val) return;
    if (!listWidgetData[field]) listWidgetData[field] = [];
    // Prevent duplicates (compare numeric ID part)
    const exists = listWidgetData[field].some((item) => item.replace(/\s*\(.*\)$/, "") === val);
    if (exists) { showToast("Already in list", "error"); return; }
    listWidgetData[field].push(val);
    addInput.value = "";
    renderListWidget(field);
    autoSaveListField(field);
  };

  addBtn.addEventListener("click", doAdd);
  addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
}


// ── Populate Form ──────────────────────────────────────────────────

function getFieldEl(name) {
  return document.querySelector(`[data-field="${name}"]`);
}

async function populateForm(data) {
  currentUid = String(data.uniqueId || "");
  currentFirebaseUid = data.uid;
  fieldUid.textContent = data.uid || "";
  document.getElementById("field-uniqueId").textContent = data.uniqueId ?? "—";

  // Collect all Firebase UIDs from list fields to resolve in one batch
  const allUids = new Set();
  for (const field of ARRAY_FIELDS) {
    const arr = data[field];
    if (Array.isArray(arr)) arr.forEach((uid) => allUids.add(uid));
  }

  // Resolve Firebase UIDs -> ShyTalk uniqueIds + displayNames
  let uidToInfo = {};
  if (allUids.size > 0) {
    try {
      const result = await apiCall("POST", "/api/resolve/uids-to-uniqueIds", { uids: [...allUids] });
      uidToInfo = result.mapping;
    } catch (err) {
      console.error("Failed to resolve UIDs:", err);
    }
  }

  // Save raw Firebase UID arrays for save-time conversion
  rawListData = {};
  for (const field of ARRAY_FIELDS) {
    rawListData[field] = Array.isArray(data[field]) ? [...data[field]] : [];
  }

  // Replace Firebase UIDs with "uniqueId (displayName)" for display
  for (const field of ARRAY_FIELDS) {
    if (Array.isArray(data[field])) {
      data[field] = data[field].map((uid) => {
        const info = uidToInfo[uid];
        if (info && info.uniqueId != null) {
          const name = info.displayName ? ` (${info.displayName})` : "";
          return `${info.uniqueId}${name}`;
        }
        return uid;
      });
    }
  }

  loadedData = { ...data };

  // Populate list widgets
  for (const field of ARRAY_FIELDS) {
    listWidgetData[field] = Array.isArray(data[field]) ? [...data[field]] : [];
    renderListWidget(field);
  }

  // Populate regular fields
  for (const el of $$("[data-field]")) {
    const field = el.dataset.field;
    const val = data[field];

    if (ARRAY_FIELDS.includes(field)) continue; // handled by list widgets
    if (BOOLEAN_FIELDS.includes(field)) {
      el.checked = val === true;
    } else if (TIMESTAMP_FIELDS.includes(field)) {
      el.value = isoToLocal(val);
    } else if (field === "email") {
      realEmail = val ?? "";
      emailRevealed = false;
      emailToggle.textContent = "Show";
      emailInput.value = maskEmail(realEmail);
      emailInput.readOnly = true;
    } else {
      el.value = val ?? "";
    }
  }

  // Read-only timestamps (in Account Info section of moderation sub-tab)
  $("#field-createdAt").textContent = data.createdAt ? new Date(data.createdAt).toLocaleString() : "\u2014";
  $("#field-lastSeenAt").textContent = data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString() : "\u2014";

  userForm.classList.add("visible");
}

// --- Track modifications ---
function getFieldValue(field) {
  // List fields are stored in listWidgetData, not in DOM elements
  if (ARRAY_FIELDS.includes(field)) {
    const items = listWidgetData[field] || [];
    return items.map((s) => s.replace(/\s*\(.*\)$/, "").trim()).filter(Boolean);
  }

  if (field === "email") return realEmail || null;

  const el = getFieldEl(field);
  if (!el) return undefined;

  if (BOOLEAN_FIELDS.includes(field)) return el.checked;
  if (TIMESTAMP_FIELDS.includes(field)) {
    if (!el.value) return null;
    return new Date(el.value).toISOString();
  }
  return el.value || null;
}

function getOriginalValue(field) {
  const val = loadedData[field];
  if (BOOLEAN_FIELDS.includes(field)) return val === true;
  if (ARRAY_FIELDS.includes(field)) {
    return Array.isArray(val) ? val.map((s) => s.replace(/\s*\(.*\)$/, "")) : [];
  }
  if (TIMESTAMP_FIELDS.includes(field)) return val || null;
  return val ?? null;
}

function valuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

const READONLY_FIELDS = [];


// ── Auto-Save Infrastructure ──────────────────────────────────────


// ══════════════════════════════════════════════════════════════
// AUTO-SAVE INFRASTRUCTURE
// ══════════════════════════════════════════════════════════════

const ECONOMY_FIELDS = ["isSuperShy", "superShyExpiry", "loginStreak", "pityCounter"];

const autoSaveState = {
  pendingNotifyFields: [],
  notifyTimer: null,
  NOTIFY_DEBOUNCE_MS: 30000,
};

function isFieldChanged(field) {
  const current = getFieldValue(field);
  const original = getOriginalValue(field);
  if (TIMESTAMP_FIELDS.includes(field)) {
    const toMinuteEpoch = (v) => {
      if (!v) return null;
      const ms = typeof v === "number" ? v : new Date(v).getTime();
      return isNaN(ms) ? null : Math.floor(ms / 60000);
    };
    return toMinuteEpoch(current) !== toMinuteEpoch(original);
  }
  return !valuesEqual(current, original);
}

function showFieldFeedback(fieldEl, status, previousValue) {
  // Find or create feedback span next to the field element
  let container = fieldEl.parentElement;
  let feedback = container.querySelector(".field-feedback");
  if (feedback) {
    feedback.remove();
  }
  feedback = document.createElement("span");
  feedback.className = "field-feedback";

  if (status === "saving") {
    const text = document.createElement("span");
    text.textContent = "Saving\u2026";
    feedback.appendChild(text);
    feedback.classList.add("visible");
    container.appendChild(feedback);
    return;
  }

  if (status === "saved") {
    feedback.classList.add("saved");
    const tick = document.createElement("span");
    tick.textContent = "\u2713 Saved";
    feedback.appendChild(tick);

    if (previousValue !== undefined) {
      const undoLink = document.createElement("span");
      undoLink.className = "undo-link";
      undoLink.textContent = "Undo";
      undoLink.addEventListener("click", () => {
        undoFieldSave(fieldEl, previousValue);
      });
      feedback.appendChild(undoLink);
    }

    feedback.classList.add("visible");
    container.appendChild(feedback);

    // Fade out after 5s
    setTimeout(() => {
      feedback.classList.remove("visible");
      setTimeout(() => { if (feedback.parentElement) feedback.remove(); }, 400);
    }, 5000);
    return;
  }

  if (status === "failed") {
    feedback.classList.add("failed");
    const text = document.createElement("span");
    text.textContent = "\u2717 Save failed";
    feedback.appendChild(text);
    feedback.classList.add("visible");
    container.appendChild(feedback);

    // Fade out after 8s
    setTimeout(() => {
      feedback.classList.remove("visible");
      setTimeout(() => { if (feedback.parentElement) feedback.remove(); }, 400);
    }, 8000);
    return;
  }
}

function getEconomyFieldValue(fieldName) {
  if (fieldName === "isSuperShy") return $("#eco-super-shy").value === "true";
  if (fieldName === "superShyExpiry") {
    const isSuperShy = $("#eco-super-shy").value === "true";
    const expiryVal = $("#eco-super-shy-expiry").value;
    return isSuperShy && expiryVal ? new Date(expiryVal).getTime() : null;
  }
  if (fieldName === "loginStreak") return parseInt($("#eco-streak").value) || 0;
  if (fieldName === "pityCounter") return parseInt($("#eco-pity").value) || 0;
  return undefined;
}

function getEconomyFieldEl(fieldName) {
  if (fieldName === "isSuperShy") return document.getElementById("eco-super-shy");
  if (fieldName === "superShyExpiry") return document.getElementById("eco-super-shy-expiry");
  if (fieldName === "loginStreak") return document.getElementById("eco-streak");
  if (fieldName === "pityCounter") return document.getElementById("eco-pity");
  return null;
}

function isEconomyFieldChanged(fieldName) {
  const v = getEconomyFieldValue(fieldName);
  const orig = loadedData[fieldName];
  if (fieldName === "isSuperShy") return !!v !== !!orig;
  if (fieldName === "loginStreak" || fieldName === "pityCounter") return (Number(v) || 0) !== (Number(orig) || 0);
  if (fieldName === "superShyExpiry") {
    const normV = v ? Math.floor(v / 60000) : null;
    const normO = orig ? Math.floor(orig / 60000) : null;
    return normV !== normO;
  }
  return v !== orig;
}

async function autoSaveField(fieldEl) {
  if (!currentUid) return;

  const field = fieldEl.dataset ? fieldEl.dataset.field : null;
  if (!field) return;
  if (READONLY_FIELDS.includes(field)) return;

  // Skip list (array) fields — they need uniqueId resolution
  if (ARRAY_FIELDS.includes(field)) return;

  const current = getFieldValue(field);
  const original = getOriginalValue(field);

  // Reject empty required fields
  if (field === "displayName" && (typeof current !== "string" || current.trim().length === 0)) {
    fieldEl.classList.add("field-save-failed");
    showFieldFeedback(fieldEl, "failed");
    showToast("Display name cannot be empty", "error");
    return;
  }

  // Check if actually changed
  if (TIMESTAMP_FIELDS.includes(field)) {
    const toMinuteEpoch = (v) => {
      if (!v) return null;
      const ms = typeof v === "number" ? v : new Date(v).getTime();
      return isNaN(ms) ? null : Math.floor(ms / 60000);
    };
    if (toMinuteEpoch(current) === toMinuteEpoch(original)) return;
  } else {
    if (valuesEqual(current, original)) return;
  }

  const previousValue = original;
  fieldEl.classList.add("field-saving");
  showFieldFeedback(fieldEl, "saving");

  try {
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [field]: current }, { skipTabAbort: true });
    fieldEl.classList.remove("field-saving");
    fieldEl.classList.remove("field-save-failed");
    loadedData[field] = current;
    showFieldFeedback(fieldEl, "saved", previousValue);
    queueNotifyField(field);
  } catch (err) {
    if (err.name === "AbortError") return;
    fieldEl.classList.remove("field-saving");
    fieldEl.classList.add("field-save-failed");
    showFieldFeedback(fieldEl, "failed");
    showToast("Auto-save failed: " + err.message, "error");
  }
}

async function autoSaveEconomyField(fieldName) {
  if (!currentUid) return;
  if (!isEconomyFieldChanged(fieldName)) return;

  const el = getEconomyFieldEl(fieldName);
  if (!el) return;

  const value = getEconomyFieldValue(fieldName);
  const previousValue = loadedData[fieldName];

  el.classList.add("field-saving");
  showFieldFeedback(el, "saving");

  try {
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [fieldName]: value }, { skipTabAbort: true });
    el.classList.remove("field-saving");
    el.classList.remove("field-save-failed");
    loadedData[fieldName] = value;
    showFieldFeedback(el, "saved", previousValue);
    queueNotifyField(fieldName);
  } catch (err) {
    el.classList.remove("field-saving");
    el.classList.add("field-save-failed");
    showFieldFeedback(el, "failed");
    showToast("Auto-save failed: " + err.message, "error");
  }
}

async function undoFieldSave(fieldEl, previousValue) {
  if (!currentUid) return;

  // Determine field name — could be data-field or economy field
  const field = fieldEl.dataset ? fieldEl.dataset.field : null;
  const ecoFieldName = ECONOMY_FIELDS.find(f => getEconomyFieldEl(f) === fieldEl);

  const fieldName = field || ecoFieldName;
  if (!fieldName) return;

  fieldEl.classList.add("field-saving");
  showFieldFeedback(fieldEl, "saving");

  try {
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [fieldName]: previousValue }, { skipTabAbort: true });
    fieldEl.classList.remove("field-saving");
    loadedData[fieldName] = previousValue;

    // Restore the form field value
    if (ecoFieldName) {
      if (ecoFieldName === "isSuperShy") {
        $("#eco-super-shy").value = previousValue ? "true" : "false";
        $("#eco-super-shy-expiry").disabled = !previousValue;
      } else if (ecoFieldName === "superShyExpiry") {
        if (previousValue) {
          const d = new Date(previousValue);
          const pad = n => String(n).padStart(2, '0');
          $("#eco-super-shy-expiry").value = d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        } else {
          $("#eco-super-shy-expiry").value = "";
        }
      } else if (ecoFieldName === "loginStreak") {
        $("#eco-streak").value = previousValue || 0;
      } else if (ecoFieldName === "pityCounter") {
        $("#eco-pity").value = previousValue || 0;
      }
    } else if (BOOLEAN_FIELDS.includes(fieldName)) {
      fieldEl.checked = previousValue === true;
    } else if (TIMESTAMP_FIELDS.includes(fieldName)) {
      fieldEl.value = isoToLocal(previousValue);
    } else if (fieldName === "email") {
      realEmail = previousValue || "";
      emailInput.value = emailRevealed ? realEmail : maskEmail(realEmail);
    } else {
      fieldEl.value = previousValue ?? "";
    }

    showFieldFeedback(fieldEl, "saved");
    showToast("Undo successful");
  } catch (err) {
    fieldEl.classList.remove("field-saving");
    showFieldFeedback(fieldEl, "failed");
    showToast("Undo failed: " + err.message, "error");
  }
}

function queueNotifyField(fieldName) {
  if (!autoSaveState.pendingNotifyFields.includes(fieldName)) {
    autoSaveState.pendingNotifyFields.push(fieldName);
  }
  if (autoSaveState.notifyTimer) {
    clearTimeout(autoSaveState.notifyTimer);
  }
  autoSaveState.notifyTimer = setTimeout(flushNotifications, autoSaveState.NOTIFY_DEBOUNCE_MS);
}

async function flushNotifications() {
  if (autoSaveState.notifyTimer) {
    clearTimeout(autoSaveState.notifyTimer);
    autoSaveState.notifyTimer = null;
  }
  if (!currentUid || autoSaveState.pendingNotifyFields.length === 0) return;
  const fields = [...autoSaveState.pendingNotifyFields];
  autoSaveState.pendingNotifyFields = [];
  try {
    await apiCall("POST", "/api/user/" + currentUid + "/notify-changes", { fields: fields }, { skipTabAbort: true });
  } catch (err) {
    console.warn("Failed to send change notification PM:", err);
  }
}

// Character counter config: field → max length
var CHAR_LIMITS = { displayName: 20, description: 200 };

function updateCharCounter(field, len) {
  var counter = document.getElementById('counter-' + field);
  if (!counter) return;
  var max = CHAR_LIMITS[field];
  counter.textContent = len + '/' + max;
  counter.classList.remove('near-limit', 'at-limit');
  if (len >= max) counter.classList.add('at-limit');
  else if (len >= max * 0.9) counter.classList.add('near-limit');
}

// Attach input listeners for character counters
document.addEventListener('input', function(e) {
  var el = e.target;
  var field = el.dataset ? el.dataset.field : null;
  if (field && CHAR_LIMITS[field]) {
    updateCharCounter(field, (el.value || '').length);
  }
});

function attachAutoSaveListeners() {
  // Remove any previous auto-save listeners by using a flag
  if (window._autoSaveListenersAttached) return;
  window._autoSaveListenersAttached = true;

  // For data-field elements: blur for text inputs, change for checkboxes/selects
  document.addEventListener("blur", (e) => {
    const el = e.target;
    const field = el.dataset ? el.dataset.field : null;
    if (!field) return;
    if (ARRAY_FIELDS.includes(field)) return;
    if (el.type === "checkbox" || el.tagName === "SELECT") return;
    autoSaveField(el);
  }, true); // useCapture for blur since it doesn't bubble

  document.addEventListener("change", (e) => {
    const el = e.target;
    const field = el.dataset ? el.dataset.field : null;
    if (!field) return;
    if (ARRAY_FIELDS.includes(field)) return;
    if (el.type === "checkbox" || el.tagName === "SELECT") {
      autoSaveField(el);
    }
  });

  // Economy field auto-save
  const ecoSuperShy = document.getElementById("eco-super-shy");
  if (ecoSuperShy) {
    ecoSuperShy.addEventListener("change", () => {
      autoSaveEconomyField("isSuperShy");
    });
  }

  const ecoExpiry = document.getElementById("eco-super-shy-expiry");
  if (ecoExpiry) {
    ecoExpiry.addEventListener("change", () => {
      autoSaveEconomyField("superShyExpiry");
    });
  }

  const ecoStreak = document.getElementById("eco-streak");
  if (ecoStreak) {
    ecoStreak.addEventListener("blur", () => {
      autoSaveEconomyField("loginStreak");
    });
  }

  const ecoPity = document.getElementById("eco-pity");
  if (ecoPity) {
    ecoPity.addEventListener("blur", () => {
      autoSaveEconomyField("pityCounter");
    });
  }
}

// Attach auto-save listeners once on page load
attachAutoSaveListeners();

// --- Clear buttons ---
for (const btn of $$("[data-clear]")) {
  btn.addEventListener("click", () => {
    const field = btn.dataset.clear;
    if (field === "email") {
      realEmail = "";
      emailInput.value = "";
      emailRevealed = true;
      emailToggle.textContent = "Hide";
      emailInput.readOnly = false;
      autoSaveField(emailInput);
      return;
    }
    const el = getFieldEl(field);
    if (!el) return;
    el.value = "";
    if (CHAR_LIMITS[field]) updateCharCounter(field, 0);
    autoSaveField(el);
  });
}


// ── User Subtab Switching ──────────────────────────────────────────

// Sub-tab switching
function switchUserSubtab(subtab) {
  document.querySelectorAll(".user-subtab").forEach(b => b.classList.toggle("active", b.dataset.subtab === subtab));
  document.querySelectorAll(".user-subpanel").forEach(p => p.classList.toggle("visible", p.dataset.subtab === subtab));
  if (subtab === "security") loadSecurityPanel();
  if (subtab === "identity") loadIdentitySubtabGraph();
}

// ── Identity Subtab Graph (Users > Identity subtab) ──────────
// Note: Distinct from loadIdentityGraph() in the Bans section — this one
// renders a visual node-graph into #identity-graph-container rather than
// a tabular view into #ig-table-body.
async function loadIdentitySubtabGraph() {

// ── Search ──────────────────────────────────────────────────────────

async function doSearchFinal() {
  const q = searchUid.value.trim();
  if (!q) return;
  // Flush any pending change notifications before switching users
  await flushNotifications();
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";
  userForm.classList.remove("visible");
  document.getElementById("user-subtabs").style.display = "none";
  document.getElementById("profile-preview").style.display = "none";
  try {
    const data = await apiCall("GET", `/api/search/uniqueId/${q}`, null, { skipTabAbort: true });
    await populateFormFull(data);
    sessionStorage.setItem("admin_user_search", q);
  } catch (err) {
    if (err.name === "AbortError") return; // Tab switch — silently bail
    showToast(err.message, "error");
    sessionStorage.removeItem("admin_user_search");
  }
  searchBtn.disabled = false;
  searchBtn.textContent = "Search";
}

searchBtn.addEventListener("click", doSearchFinal);
searchUid.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearchFinal(); });


// ── Suspension Controls ──────────────────────────────────────────

// --- Suspension section ---
const suspensionSection = $("#suspension-section");
const suspensionStatus = $("#suspension-status");
const suspendReason = $("#suspend-reason");
const suspendEndDate = $("#suspend-end-date");
const suspendCanAppeal = $("#suspend-can-appeal");
const suspendBtn = $("#suspend-btn");
const unsuspendBtn = $("#unsuspend-btn");

function populateSuspensionSection(data) {
  suspensionSection.style.display = "block";

  const preSuspensionInfo = $("#pre-suspension-info");
  const preSuspensionPhoto = $("#pre-suspension-photo");
  const preSuspensionName = $("#pre-suspension-name");
  const preSuspensionCover = $("#pre-suspension-cover");

  if (data.isSuspended) {
    const since = data.suspensionStartDate ? new Date(data.suspensionStartDate).toLocaleString() : "unknown";
    const until = data.suspensionEndDate ? new Date(data.suspensionEndDate).toLocaleString() : "permanent";
    const reason = data.suspensionReason || "No reason provided";
    suspensionStatus.className = "suspension-status suspended";
    suspensionStatus.textContent = `Suspended since ${since}, until ${until}. Reason: ${reason}`;
    suspendBtn.style.display = "none";
    unsuspendBtn.style.display = "";

    // Show original profile data from _preSuspension
    if (data._preSuspension) {
      preSuspensionInfo.style.display = "block";
      preSuspensionName.textContent = data._preSuspension.displayName || "Unknown";
      if (data._preSuspension.profilePhotoUrl) {
        preSuspensionPhoto.src = data._preSuspension.profilePhotoUrl;
        preSuspensionPhoto.style.display = "block";
      } else {
        preSuspensionPhoto.style.display = "none";
      }
      if (data._preSuspension.coverPhotoUrl) {
        preSuspensionCover.style.display = "block";
      } else {
        preSuspensionCover.style.display = "none";
      }
    } else {
      preSuspensionInfo.style.display = "none";
    }
  } else {
    suspensionStatus.className = "suspension-status not-suspended";
    suspensionStatus.textContent = "Not Suspended";
    suspendBtn.style.display = "";
    unsuspendBtn.style.display = "none";
    preSuspensionInfo.style.display = "none";
  }

  suspendReason.value = "";
  suspendEndDate.value = "";
  suspendCanAppeal.checked = false;
}

// Duration preset buttons
for (const btn of $$(".duration-presets button")) {
  btn.addEventListener("click", () => {
    const days = Number(btn.dataset.days);
    if (days === 0) {
      suspendEndDate.value = "";
    } else {
      const d = new Date(Date.now() + days * 86400000);
      const pad = (n) => String(n).padStart(2, "0");
      suspendEndDate.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  });
}

suspendBtn.addEventListener("click", async () => {
  const reason = suspendReason.value.trim();
  if (!reason) { showToast("Reason is required", "error"); return; }

  const endDateVal = suspendEndDate.value;
  const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;

  suspendBtn.disabled = true;
  try {
    await apiCall("POST", `/api/user/${currentUid}/suspend`, {
      reason,
      endDate,
      canAppeal: suspendCanAppeal.checked,
    });
    showToast("User suspended");
    // Refresh all user data (fields, preview, suspension section)
    const data = await apiCall("GET", `/api/user/${currentUid}`);
    await populateFormFull(data);
    populateSuspensionSection(data);
  } catch (err) {
    showToast(err.message, "error");
  }
  suspendBtn.disabled = false;
});

unsuspendBtn.addEventListener("click", async () => {
  unsuspendBtn.disabled = true;
  try {
    await apiCall("POST", `/api/user/${currentUid}/unsuspend`);
    showToast("User unsuspended");
    // Refresh all user data (fields, preview, suspension section)
    const data = await apiCall("GET", `/api/user/${currentUid}`);
    await populateFormFull(data);
    populateSuspensionSection(data);
  } catch (err) {
    showToast(err.message, "error");
  }
  unsuspendBtn.disabled = false;
});

document.getElementById("reset-device-binding-btn").addEventListener("click", async () => {
  if (!currentUid) { showToast("No user loaded", "error"); return; }
  if (!confirm("Remove all device bindings for this user? They will be able to sign in from any device.")) return;
  const btn = document.getElementById("reset-device-binding-btn");
  btn.disabled = true; btn.textContent = "Resetting...";
  try {
    const result = await apiCall("POST", `/api/cleanup/device-binding/${currentUid}`);
    showToast("Removed " + (result.deleted || 0) + " device binding(s)", "success");
    if (typeof populateDeviceBindingCard === "function") populateDeviceBindingCard(currentUid);
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Reset Device Binding";
  }
});


// ── Account Deletion ──────────────────────────────────────────────

// --- Account Deletion section ---
const deletionStatusBadge = $("#deletion-status-badge");
const deletionNotScheduled = $("#deletion-not-scheduled");
const scheduleDeletionBtn = $("#schedule-deletion-btn");
const cancelDeletionBtn = $("#cancel-deletion-btn");

function populateDeletionSection(data) {
  if (data.deletionScheduledAt) {
    const executeDate = new Date(data.deletionExecuteAt).toLocaleDateString();
    const msRemaining = data.deletionExecuteAt - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));
    deletionStatusBadge.textContent = `Deletion scheduled — ${daysRemaining} days remaining (${executeDate})`;
    deletionStatusBadge.style.display = "block";
    deletionNotScheduled.style.display = "none";
    scheduleDeletionBtn.style.display = "none";
    cancelDeletionBtn.style.display = "";
  } else {
    deletionStatusBadge.style.display = "none";
    deletionNotScheduled.style.display = "block";
    scheduleDeletionBtn.style.display = "";
    cancelDeletionBtn.style.display = "none";
  }
}

scheduleDeletionBtn.addEventListener("click", async () => {
  const reason = prompt("Enter reason for account deletion (optional):");
  if (reason === null) return; // cancelled
  if (!confirm("Are you sure you want to schedule this account for deletion?")) return;
  try {
    const uid = currentUid;
    await apiCall("POST", `/api/user/${uid}/delete`, { reason });
    alert("Account deletion scheduled.");
    const freshData = await apiCall("GET", `/api/user/${uid}`);
    populateDeletionSection(freshData);
  } catch (err) {
    alert("Failed to schedule deletion: " + (err.message || err));
  }
});

cancelDeletionBtn.addEventListener("click", async () => {
  if (!confirm("Cancel the scheduled account deletion?")) return;
  try {
    const uid = currentUid;
    await apiCall("POST", `/api/user/${uid}/cancel-delete`);
    alert("Account deletion cancelled.");
    const freshData = await apiCall("GET", `/api/user/${uid}`);
    populateDeletionSection(freshData);
  } catch (err) {
    alert("Failed to cancel deletion: " + (err.message || err));
  }
});

// Hook into populateForm to also populate suspension section
const _originalPopulateForm = populateForm;
async function populateFormWithSuspension(data) {
  await _originalPopulateForm(data);
  populateSuspensionSection(data);
}

// Hook into populateFormFull to also populate deletion section
const _origPopulateFullForDeletion = populateFormFull;
populateFormFull = async function(data) {
  await _origPopulateFullForDeletion(data);
  populateDeletionSection(data);
};
// (doSearch / doSearchUpdated removed — doSearchFinal is the authoritative handler)


// ── GCS + Warnings + Report History ──────────────────────────────

// --- GCS Helpers ---
function gcsClass(score) {
  if (score >= 80) return "gcs-green";
  if (score >= 60) return "gcs-yellow";
  if (score >= 40) return "gcs-orange";
  if (score >= 20) return "gcs-red";
  return "gcs-darkred";
}

function gcsEmoji(score) {
  if (score >= 80) return "\u{1F60A}";
  if (score >= 60) return "\u{1F610}";
  if (score >= 40) return "\u{1F61F}";
  if (score >= 20) return "\u{1F620}";
  return "\u{1F621}";
}

function computeDisplayScore(floor, lastDeductionAt) {
  if (!lastDeductionAt) return Math.min(100, floor);
  const deductionTime = new Date(lastDeductionAt).getTime();
  const monthsSince = (Date.now() - deductionTime) / (30 * 24 * 60 * 60 * 1000);
  return Math.min(100, Math.floor(floor + 2 * monthsSince));
}

// --- GCS section in Users tab ---
const gcsSection = $("#gcs-section");
const gcsBadgeUser = $("#gcs-badge-user");
const gcsFloor = $("#gcs-floor");
const gcsWarnings = $("#gcs-warnings");
const gcsLastDeduction = $("#gcs-last-deduction");
const resetGcsBtn = $("#reset-gcs-btn");
const reportHistorySection = $("#report-history-section");
const reportHistoryList = $("#report-history-list");

function populateGcsSection(data) {
  gcsSection.style.display = "block";
  const floor = data.gcsScore ?? data.goodCharacterScore ?? 100;
  const lastDeduction = data.gcsLastDeductionAt ?? data.goodCharacterLastDeductionAt ?? null;
  const display = data.gcsDisplayScore ?? computeDisplayScore(floor, lastDeduction);
  gcsBadgeUser.className = `gcs-badge ${gcsClass(display)}`;
  gcsBadgeUser.textContent = `${gcsEmoji(display)} ${display}`;
  gcsFloor.textContent = floor;
  gcsWarnings.textContent = data.warningCount || 0;
  gcsLastDeduction.textContent = lastDeduction ? new Date(lastDeduction).toLocaleString() : "Never";
}

resetGcsBtn.addEventListener("click", async () => {
  if (!currentUid) return;
  if (!confirm("Reset this user's GCS to 100 and clear all warnings?")) return;
  resetGcsBtn.disabled = true;
  try {
    await apiCall("POST", `/api/user/${currentUid}/reset-gcs`);
    showToast("GCS reset to 100");
    const data = await apiCall("GET", `/api/user/${currentUid}`);
    populateGcsSection(data);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    resetGcsBtn.disabled = false;
  }
});

async function loadReportHistory(uid) {
  if (!uid || uid === "undefined" || uid === "null") return;
  reportHistorySection.style.display = "block";
  reportHistoryList.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading...</div>';
  try {
    const result = await apiCall("GET", `/api/reports?status=resolved&userId=${uid}`);
    const allReports = Array.isArray(result) ? result : (result.users ? result.users.flatMap((u) => u.reports) : []);
    if (allReports.length === 0) {
      reportHistoryList.innerHTML = '<div style="color:var(--text2);font-size:12px;font-style:italic;">No report history</div>';
      return;
    }
    reportHistoryList.innerHTML = "";
    for (const r of allReports.slice(0, 10)) {
      const div = document.createElement("div");
      div.className = "report-history-item";
      div.innerHTML = `
        <strong>${escapeHtml(r.reason || "Unknown")}</strong> — ${escapeHtml(r.resolvedAction || "?")}
        ${r.severity ? `(Severity: ${r.severity})` : ""}
        <br><span style="color:var(--text2)">${r.adminNote ? escapeHtml(r.adminNote) : ""}</span>
        <br><span style="color:var(--text2);font-size:11px">${r.resolvedAt ? escapeHtml(new Date(r.resolvedAt).toLocaleString()) : ""}</span>
      `;
      reportHistoryList.appendChild(div);
    }
  } catch (err) {
    reportHistoryList.innerHTML = `<div style="color:var(--danger);font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

// --- Direct Warning + Warning History ---
const directWarnReason = $("#direct-warn-reason");
const directWarnNote = $("#direct-warn-note");
const directWarnBtn = $("#direct-warn-btn");
const warningHistoryList = document.getElementById("warning-history-list");
const warningLoadMoreBtn = document.getElementById("warning-load-more-btn");
let _warningLastTimestamp = null;

function resetWarningForm() {
  directWarnReason.value = "";
  directWarnNote.value = "";
  document.querySelector('input[name="direct-warn-severity"][value="3"]').checked = true;
}

async function loadWarningHistory(uid, append) {
  if (!append) {
    warningHistoryList.textContent = "";
    var loadingDiv = document.createElement("div");
    loadingDiv.style.cssText = "color:var(--text2);font-size:13px;font-style:italic;";
    loadingDiv.textContent = "Loading...";
    warningHistoryList.appendChild(loadingDiv);
    _warningLastTimestamp = null;
  }
  try {
    var url = "/api/user/" + uid + "/warnings?limit=20";
    if (_warningLastTimestamp) url += "&startAfter=" + _warningLastTimestamp;
    var data = await apiCall("GET", url);
    var warnings = data.warnings || [];

    if (!append) warningHistoryList.textContent = "";

    if (warnings.length === 0 && !append) {
      var emptyDiv = document.createElement("div");
      emptyDiv.style.cssText = "color:var(--text2);font-size:13px;font-style:italic;";
      emptyDiv.textContent = "No warnings";
      warningHistoryList.appendChild(emptyDiv);
      warningLoadMoreBtn.style.display = "none";
      return;
    }

    for (var i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      warningHistoryList.appendChild(renderWarningItem(w, uid));
      _warningLastTimestamp = w.createdAt;
    }

    warningLoadMoreBtn.style.display = data.hasMore ? "block" : "none";
  } catch (err) {
    if (!append) warningHistoryList.textContent = "";
    var errDiv = document.createElement("div");
    errDiv.style.cssText = "color:var(--danger);font-size:12px;";
    errDiv.textContent = err.message;
    warningHistoryList.appendChild(errDiv);
    warningLoadMoreBtn.style.display = "none";
  }
}

function renderWarningItem(w, uid) {
  var item = document.createElement("div");
  item.className = "warning-item" + (w.revoked ? " revoked" : "");
  item.dataset.warningId = w.id;

  var header = document.createElement("div");
  header.className = "warning-item-header";

  var left = document.createElement("div");
  var badge = document.createElement("span");
  badge.className = "warning-source-badge " + (w.source || "direct");
  badge.textContent = w.source || "direct";
  left.appendChild(badge);
  var sev = document.createElement("span");
  sev.style.cssText = "margin-left:8px;color:var(--text2);font-size:12px;";
  sev.textContent = "Severity " + w.severity + " (-" + (w.gcsDeduction || 0) + " GCS)";
  left.appendChild(sev);
  header.appendChild(left);

  var right = document.createElement("div");
  right.style.cssText = "display:flex;align-items:center;gap:6px;";
  var dateSpan = document.createElement("span");
  dateSpan.style.cssText = "color:var(--text2);font-size:11px;";
  dateSpan.textContent = w.createdAt ? new Date(w.createdAt).toLocaleString() : "";
  right.appendChild(dateSpan);
  if (!w.revoked) {
    var revokeBtn = document.createElement("button");
    revokeBtn.className = "btn-revoke-warning";
    revokeBtn.textContent = "Revoke";
    revokeBtn.addEventListener("click", function() { revokeWarning(uid, w.id, w.gcsDeduction || 0, revokeBtn); });
    right.appendChild(revokeBtn);
  } else {
    var revokedSpan = document.createElement("span");
    revokedSpan.style.cssText = "color:var(--text2);font-size:11px;font-style:italic;";
    revokedSpan.textContent = "Revoked";
    right.appendChild(revokedSpan);
  }
  header.appendChild(right);
  item.appendChild(header);

  var reason = document.createElement("div");
  reason.style.marginTop = "4px";
  reason.textContent = w.reason || "";
  item.appendChild(reason);

  if (w.adminNote) {
    var note = document.createElement("div");
    note.style.cssText = "color:var(--text2);font-size:12px;margin-top:2px;font-style:italic;";
    note.textContent = "Note: " + w.adminNote;
    item.appendChild(note);
  }

  var meta = document.createElement("div");
  meta.style.cssText = "color:var(--text2);font-size:11px;margin-top:2px;";
  meta.textContent = "By: " + (w.issuedByName || w.issuedBy || "System") + " | GCS: " + (w.gcsBefore || "?") + " \u2192 " + (w.gcsAfter ?? "?");
  item.appendChild(meta);

  return item;
}

async function revokeWarning(uid, warningId, deduction, btn) {
  if (!confirm("Revoke this warning? +" + deduction + " GCS will be restored.")) return;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    await apiCall("POST", "/api/user/" + uid + "/warnings/" + warningId + "/revoke");
    showToast("Warning revoked, +" + deduction + " GCS restored");
    var data = await apiCall("GET", "/api/user/" + uid);
    populateGcsSection(data);
    loadWarningHistory(uid, false);
  } catch (err) {
    showToast(err.message, "error");
    btn.disabled = false;
    btn.textContent = "Revoke";
  }
}

warningLoadMoreBtn.addEventListener("click", function() {
  if (currentUid) loadWarningHistory(currentUid, true);
});

directWarnBtn.addEventListener("click", async () => {
  if (!currentUid) return;
  const reason = directWarnReason.value;
  if (!reason) { showToast("Select a reason", "error"); return; }
  const severity = parseInt(document.querySelector('input[name="direct-warn-severity"]:checked')?.value || "3");
  const adminNote = directWarnNote.value.trim() || undefined;

  if (!confirm(`Issue a warning to this user for "${reason}" (severity ${severity}, -${severity * 5} GCS)?`)) return;

  directWarnBtn.disabled = true;
  directWarnBtn.textContent = "Issuing...";
  try {
    const result = await apiCall("POST", `/api/user/${currentUid}/warn`, { reason, severity, adminNote });
    showToast("Warning issued successfully");
    if (result.autoEscalateSuggested) {
      showToast("This user has 5+ warnings. Consider suspending.", "error");
    }
    // Refresh GCS display and warning history
    const data = await apiCall("GET", `/api/user/${currentUid}`);
    populateGcsSection(data);
    loadWarningHistory(currentUid, false);
    loadReportHistory(currentUid);
    directWarnReason.value = "";
    directWarnNote.value = "";
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    directWarnBtn.disabled = false;
    directWarnBtn.textContent = "Issue Warning";
  }
});

// Hook GCS + report history + direct warn into form populate
const _origPopulateWithSuspension = populateFormWithSuspension;
async function populateFormFull(data) {
  await _origPopulateWithSuspension(data);
  populateGcsSection(data);
  resetWarningForm();
  loadWarningHistory(String(data.uniqueId || data.uid), false);
  loadReportHistory(String(data.uniqueId || data.uid));
  // Suspended banner — auto-hide when timed suspension expires
  var banner = document.getElementById("suspended-banner");
  if (window._suspensionTimer) { clearTimeout(window._suspensionTimer); window._suspensionTimer = null; }
  if (data.isSuspended) {
    banner.style.display = "block";
    if (data.suspensionEndDate) {
      var msLeft = new Date(data.suspensionEndDate).getTime() - Date.now();
      if (msLeft <= 0) {
        banner.style.display = "none";
      } else {
        window._suspensionTimer = setTimeout(function() {
          banner.style.display = "none";
        }, msLeft);
      }
    }
  } else {
    banner.style.display = "none";
  }
  // Show sub-tabs and default to Profile
  document.getElementById("user-subtabs").style.display = "flex";
  switchUserSubtab("profile");
}

// Sub-tab switching
function switchUserSubtab(subtab) {
  document.querySelectorAll(".user-subtab").forEach(b => b.classList.toggle("active", b.dataset.subtab === subtab));
  document.querySelectorAll(".user-subpanel").forEach(p => p.classList.toggle("visible", p.dataset.subtab === subtab));
  if (subtab === "security") loadSecurityPanel();
  if (subtab === "identity") loadIdentitySubtabGraph();
}

// ── Identity Subtab Graph (Users > Identity subtab) ──────────
// Note: Distinct from loadIdentityGraph() in the Bans section — this one
// renders a visual node-graph into #identity-graph-container rather than
// a tabular view into #ig-table-body.
async function loadIdentitySubtabGraph() {
  const uid = currentUid;
  if (!uid) return;
  const container = document.getElementById("identity-graph-container");
  const empty = document.getElementById("identity-graph-empty");
  container.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading identity graph…</div>';
  container.style.display = "block";
  empty.style.display = "none";
  try {
    const data = await apiCall("GET", `/api/admin/identity-graph/${uid}`);
    renderIdentitySubtabGraph(data);
  } catch (err) {
    // Try bans/graph endpoint as fallback
    try {
      const data = await apiCall("GET", `/api/admin/bans/graph/${uid}`);
      renderIdentitySubtabGraph(data);
    } catch (err2) {
      container.style.display = "none";
      empty.style.display = "block";
    }
  }
}

function renderIdentitySubtabGraph(data) {
  const container = document.getElementById("identity-graph-container");
  const empty = document.getElementById("identity-graph-empty");
  const nodes = (data && data.nodes) || [];
  const edges = (data && data.edges) || [];
  if (nodes.length === 0) {
    container.style.display = "none";
    empty.style.display = "block";
    return;
  }
  container.style.display = "block";
  empty.style.display = "none";
  container.innerHTML = "";

  // Node color by type
  const NODE_COLORS = { account: "#7c5cfc", device: "#3498db", network: "#27ae60" };

  // Simple rendered layout: SVG with rectangles and lines
  const SVG_W = Math.max(800, nodes.length * 140);
  const SVG_H = 400;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(SVG_W));
  svg.setAttribute("height", String(SVG_H));
  svg.style.display = "block";
  svg.style.minWidth = SVG_W + "px";

  // Position nodes in a grid
  const positions = {};
  const COLS = Math.ceil(Math.sqrt(nodes.length));
  nodes.forEach((n, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    positions[n.id] = { x: 80 + col * 140, y: 80 + row * 120 };
  });

  // Draw edges first (behind nodes)
  edges.forEach((e) => {
    const a = positions[e.source];
    const b = positions[e.target];
    if (!a || !b) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("stroke", "#666");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("class", "graph-edge graph-link");
    line.setAttribute("data-type", e.type || "link");
    svg.appendChild(line);
  });

  // Draw nodes
  nodes.forEach((n) => {
    const pos = positions[n.id];
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "graph-node" + (n.suspended ? " suspended" : ""));
    g.setAttribute("data-type", n.type || "unknown");
    g.setAttribute("data-id", n.id);
    g.style.cursor = "pointer";

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(pos.x - 50));
    rect.setAttribute("y", String(pos.y - 20));
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "40");
    rect.setAttribute("rx", "6");
    rect.setAttribute("fill", NODE_COLORS[n.type] || "#888");
    rect.setAttribute("stroke", n.suspended ? "#e74c3c" : "#333");
    rect.setAttribute("stroke-width", n.suspended ? "3" : "1");
    g.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(pos.x));
    text.setAttribute("y", String(pos.y + 5));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#fff");
    text.setAttribute("font-size", "12");
    text.textContent = (n.label || n.id || "").toString().slice(0, 12);
    g.appendChild(text);

    // Multi-account warning icon on devices linked to multiple accounts
    if (n.type === "device" && n.linkedAccounts && n.linkedAccounts.length > 1) {
      const warn = document.createElementNS("http://www.w3.org/2000/svg", "text");
      warn.setAttribute("class", "warning-icon");
      warn.setAttribute("x", String(pos.x + 40));
      warn.setAttribute("y", String(pos.y - 10));
      warn.setAttribute("font-size", "16");
      warn.textContent = "⚠";
      g.appendChild(warn);
    }

    g.addEventListener("click", () => {
      const panel = document.getElementById("node-metadata-panel");
      const title = document.getElementById("node-metadata-title");
      const body = document.getElementById("node-metadata-body");
      title.textContent = (n.type || "node") + ": " + (n.label || n.id);
      body.textContent = JSON.stringify(n.metadata || n, null, 2);
      panel.style.display = "block";
      panel.dataset.nodeId = n.id;
    });

    svg.appendChild(g);
  });

  container.appendChild(svg);

  // Multi-account alert summary
  const multiDevices = nodes.filter((n) => n.type === "device" && n.linkedAccounts && n.linkedAccounts.length > 1);
  if (multiDevices.length > 0) {
    const alert = document.createElement("div");
    alert.className = "multi-account-alert";
    alert.style.cssText = "margin-top:12px;padding:10px 14px;background:rgba(231,76,60,0.1);border:1px solid #e74c3c;border-radius:6px;color:#e74c3c;font-size:13px;";
    alert.textContent = "⚠ This device is linked to multiple accounts (" + multiDevices[0].linkedAccounts.length + ")";
    container.appendChild(alert);
  }
}

// Identity suspend dialog wiring
function showIdentitySuspendDialog() {
  const dialog = document.getElementById("identity-suspend-dialog");
  dialog.style.display = "flex";
  updateCascadePreview();
}
function hideIdentitySuspendDialog() {
  const dialog = document.getElementById("identity-suspend-dialog");
  dialog.style.display = "none";
}
function updateCascadePreview() {
  const preview = document.querySelector("#identity-suspend-dialog .cascade-preview");
  if (!preview) return;
  // Read current graph from container
  const container = document.getElementById("identity-graph-container");
  const nodes = container ? container.querySelectorAll(".graph-node") : [];
  const counts = { account: 0, device: 0, network: 0 };
  nodes.forEach((n) => {
    const type = n.getAttribute("data-type");
    if (type && counts[type] !== undefined) counts[type]++;
  });
  preview.textContent = "This will also affect " + counts.account + " account(s), " +
    counts.device + " device(s), and " + counts.network + " network(s).";
}

// Note: inside an ES <script type="module">, DOMContentLoaded has already
// fired by the time this code runs (modules are deferred), so a
// DOMContentLoaded listener registered here will never fire. Run the
// setup function immediately instead.
(function wireUpDynamicUI() {
  const suspendBtn = document.getElementById("identity-suspend-btn");
  if (suspendBtn) suspendBtn.addEventListener("click", showIdentitySuspendDialog);

  const cancelBtn = document.querySelector("#identity-suspend-dialog .btn-cancel-suspend");
  if (cancelBtn) cancelBtn.addEventListener("click", hideIdentitySuspendDialog);

  const confirmBtn = document.querySelector("#identity-suspend-dialog .btn-confirm-suspend");
  if (confirmBtn) confirmBtn.addEventListener("click", async () => {
    const uid = currentUid;
    if (!uid) { hideIdentitySuspendDialog(); return; }
    const duration = document.getElementById("identity-suspend-duration").value;
    const scope = document.getElementById("identity-suspend-scope").value;
    const reason = document.getElementById("identity-suspend-reason").value || "Admin suspend";
    try {
      await apiCall("POST", `/api/admin/identity-graph/${uid}/suspend-all`, { duration, scope, reason });
      showToast("Identity suspended");
      hideIdentitySuspendDialog();
      loadIdentitySubtabGraph();
    } catch (err) {
      showToast("Suspend failed: " + err.message, "error");
    }
  });

  const unsuspendAll = document.getElementById("identity-unsuspend-all-btn");
  if (unsuspendAll) unsuspendAll.addEventListener("click", async () => {
    const uid = currentUid;
    if (!uid) return;
    try {
      await apiCall("POST", `/api/admin/identity-graph/${uid}/unsuspend-all`, {});
      showToast("Identity unsuspended");
      loadIdentitySubtabGraph();
    } catch (err) {
      showToast("Unsuspend failed: " + err.message, "error");
    }
  });

  const nodeUnsuspend = document.getElementById("node-unsuspend-btn");
  if (nodeUnsuspend) nodeUnsuspend.addEventListener("click", async () => {
    const uid = currentUid;
    const panel = document.getElementById("node-metadata-panel");
    const nodeId = panel && panel.dataset.nodeId;
    if (!uid || !nodeId) return;
    try {
      await apiCall("POST", `/api/admin/identity-graph/${uid}/node/${nodeId}/unsuspend`, {});
      showToast("Node unsuspended");
      // Update the specific node in-place rather than re-rendering the
      // whole graph so Playwright locators that target the clicked node
      // by index don't resolve to a different node after re-render.
      const container = document.getElementById("identity-graph-container");
      if (container) {
        const nodeEl = container.querySelector('.graph-node[data-id="' + nodeId + '"]');
        if (nodeEl) {
          nodeEl.classList.remove("suspended");
          const rect = nodeEl.querySelector("rect");
          if (rect) {
            rect.setAttribute("stroke", "#333");
            rect.setAttribute("stroke-width", "1");
          }
        }
      }
    } catch (err) {
      showToast("Unsuspend failed: " + err.message, "error");
    }
  });

  const durationSel = document.getElementById("identity-suspend-duration");
  if (durationSel) durationSel.addEventListener("change", updateCascadePreview);

  const auditSearchBtn = document.getElementById("audit-log-search-btn");
  if (auditSearchBtn) auditSearchBtn.addEventListener("click", () => loadAuditLogMain());

// ── Security Panel ──────────────────────────────────────────────────

// ── Security panel ──────────────────────────────────────────
async function loadSecurityPanel() {
  const uid = currentUid;
  if (!uid) return;
  try {
    const [authRes, otpRes] = await Promise.all([
      apiCall("GET", `/api/user/${uid}/auth-status`),
      apiCall("GET", "/api/metrics/otp"),
    ]);
    // PIN status
    document.getElementById("pin-set").textContent = authRes.pinSet ? "Yes" : "No";
    document.getElementById("pin-set-at").textContent = authRes.pinSetAt ? new Date(authRes.pinSetAt).toLocaleString() : "—";
    document.getElementById("pin-attempts").textContent = authRes.pinAttempts;
    document.getElementById("pin-locked-until").textContent = authRes.pinLockedUntil ? new Date(authRes.pinLockedUntil).toLocaleString() : "—";
    document.getElementById("pin-lockout-count").textContent = authRes.pinLockoutCount;
    document.getElementById("pin-is-locked").textContent = authRes.isLocked ? "YES" : "No";
    document.getElementById("pin-is-locked").style.color = authRes.isLocked ? "var(--danger, #f44)" : "inherit";
    document.getElementById("reset-pin-lockout-btn").style.display = (authRes.pinAttempts > 0 || authRes.isLocked) ? "inline-block" : "none";

    // Biometric keys
    const keysList = document.getElementById("biometric-keys-list");
    if (authRes.biometricKeys.length === 0) {
      keysList.innerHTML = '<p style="color:var(--text2)">No biometric keys registered</p>';
    } else {
      keysList.innerHTML = authRes.biometricKeys.map(k => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <strong>Device:</strong> ${escapeHtml(k.deviceId)}<br>
            <small style="color:var(--text2)">Registered: ${escapeHtml(new Date(k.createdAt).toLocaleString())}</small>
          </div>
          <button class="btn btn-danger btn-sm" onclick="revokeBiometricKey('${escapeHtml(uid)}','${escapeHtml(k.deviceId)}')">Revoke</button>
        </div>
      `).join("");
    }

    // OTP metrics
    document.getElementById("otp-count").textContent = otpRes.count;
    document.getElementById("otp-date").textContent = otpRes.date || "—";
    document.getElementById("otp-limit").textContent = otpRes.limit;
  } catch (err) {
    console.error("Failed to load security panel:", err);
  }
}

async function resetPinLockout() {
  if (!currentUid || !confirm("Reset PIN lockout for this user?")) return;
  const uid = currentUid;
  try {
    await apiCall("POST", `/api/user/${uid}/reset-pin-lockout`);
    showToast("PIN lockout reset");
    loadSecurityPanel();
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
}

async function revokeBiometricKey(uniqueId, deviceId) {
  if (!confirm(`Revoke biometric key for device ${deviceId}?`)) return;
  try {
    await apiCall("DELETE", `/api/user/${uniqueId}/biometric-keys/${deviceId}`);
    showToast("Biometric key revoked");
    loadSecurityPanel();
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
}
// Expose functions used by inline onclick attributes (module scope isn't global)
window.resetPinLockout = resetPinLockout;
window.revokeBiometricKey = revokeBiometricKey;

document.querySelectorAll(".user-subtab").forEach(btn => {
  btn.addEventListener("click", () => switchUserSubtab(btn.dataset.subtab));
});

// ── Economy Admin ──────────────────────────────────────────────────

// --- Economy Admin ---
let _ecoCoins = 0;
let _ecoBeans = 0;

function populateEconomySection(data) {
  _ecoCoins = data.shyCoins || 0;
  _ecoBeans = data.shyBeans || 0;
  $("#eco-coins-display").textContent = _ecoCoins;
  $("#eco-beans-display").textContent = _ecoBeans;
  $("#eco-coins-amount").value = "";
  $("#eco-beans-amount").value = "";
  $("#eco-super-shy").value = data.isSuperShy ? "true" : "false";
  const isSuperShy = data.isSuperShy === true;
  const isUnlimited = isSuperShy && !data.superShyExpiry;
  $("#eco-super-shy-unlimited").checked = isUnlimited;
  $("#eco-super-shy-unlimited").disabled = !isSuperShy;
  $("#eco-super-shy-expiry").disabled = !isSuperShy || isUnlimited;
  if (isSuperShy && data.superShyExpiry) {
    // Convert timestamp to datetime-local format (local time, not UTC)
    const d = new Date(data.superShyExpiry);
    const pad = n => String(n).padStart(2, '0');
    $("#eco-super-shy-expiry").value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    $("#eco-super-shy-expiry").value = "";
  }
  $("#eco-streak").value = data.loginStreak || 0;
  $("#eco-pity").value = data.pityCounter || 0;
}

// Toggle Super Shy Expiry enabled/disabled based on Super Shy value
var _prevExpiryValue = "";
$("#eco-super-shy").addEventListener("change", () => {
  const isSuperShy = $("#eco-super-shy").value === "true";
  const unlimitedCb = $("#eco-super-shy-unlimited");
  unlimitedCb.disabled = !isSuperShy;
  if (!isSuperShy) {
    unlimitedCb.checked = false;
    $("#eco-super-shy-expiry").value = "";
    $("#eco-super-shy-expiry").disabled = true;
  } else {
    $("#eco-super-shy-expiry").disabled = unlimitedCb.checked;
  }
  // Auto-save handled by attachAutoSaveListeners
});

// Unlimited checkbox: toggle expiry field
$("#eco-super-shy-unlimited").addEventListener("change", () => {
  const unlimited = $("#eco-super-shy-unlimited").checked;
  const expiryEl = $("#eco-super-shy-expiry");
  if (unlimited) {
    _prevExpiryValue = expiryEl.value;
    expiryEl.value = "";
    expiryEl.disabled = true;
    autoSaveEconomyField("superShyExpiry");
  } else {
    expiryEl.disabled = false;
    if (_prevExpiryValue) {
      expiryEl.value = _prevExpiryValue;
    } else {
      // Unix epoch: 1970-01-01T00:00
      expiryEl.value = "1970-01-01T00:00";
    }
    autoSaveEconomyField("superShyExpiry");
  }
});

// Economy field change tracking removed — auto-save handles this

// Apply coins add/deduct (uses dedicated audit endpoint)
$("#eco-coins-apply").addEventListener("click", async () => {
  if (!currentUid) return;
  const op = $("#eco-coins-op").value;
  const amount = parseInt($("#eco-coins-amount").value) || 0;
  if (amount <= 0) { showToast("Enter a positive amount", "error"); return; }
  try {
    const result = await apiCall("POST", `/api/users/${currentUid}/adjust-balance`, {
      currency: "COINS", amount, operation: op
    });
    _ecoCoins = result.newBalance;
    $("#eco-coins-display").textContent = _ecoCoins;
    $("#eco-coins-amount").value = "";
    showToast(`${op === "add" ? "Added" : "Deducted"} ${amount} coins (now ${_ecoCoins})`);
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Apply beans add/deduct (uses dedicated audit endpoint)
$("#eco-beans-apply").addEventListener("click", async () => {
  if (!currentUid) return;
  const op = $("#eco-beans-op").value;
  const amount = parseInt($("#eco-beans-amount").value) || 0;
  if (amount <= 0) { showToast("Enter a positive amount", "error"); return; }
  try {
    const result = await apiCall("POST", `/api/users/${currentUid}/adjust-balance`, {
      currency: "BEANS", amount, operation: op
    });
    _ecoBeans = result.newBalance;
    $("#eco-beans-display").textContent = _ecoBeans;
    $("#eco-beans-amount").value = "";
    showToast(`${op === "add" ? "Added" : "Deducted"} ${amount} beans (now ${_ecoBeans})`);
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Hook economy into full populate
const _origPopulateFull = populateFormFull;
populateFormFull = async function(data) {
  await _origPopulateFull(data);
  populateEconomySection(data);
  // Load gift catalog first so backpack rendering has category/name data
  await populateGiftSelect();
  await loadBackpack(String(data.uniqueId || data.uid));
};

// Economy getModifiedFields override removed — economy fields now auto-save individually

// Backpack management
let _backpackItems = [];
let _giftCatalog = [];
let _backpackEdits = {};

async function loadBackpack(uid) {
  const container = document.getElementById("backpack-grid");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  const loading = document.createElement("p");
  loading.style.cssText = "color:var(--text2);grid-column:1/-1;text-align:center;";
  loading.textContent = "Loading backpack...";
  container.appendChild(loading);
  _backpackEdits = {};
  try {
    const data = await apiCall("GET", "/api/users/" + uid + "/backpack");
    _backpackItems = Array.isArray(data) ? data : (data.items || []);
    renderBackpack();
    populateCategoryFilter();
  } catch (err) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const errEl = document.createElement("p");
    errEl.style.color = "var(--danger)";
    errEl.textContent = err.message;
    container.appendChild(errEl);
  }
}

function renderBackpack() {
  const container = document.getElementById("backpack-grid");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  const searchText = (document.getElementById("backpack-search")?.value || "").toLowerCase();
  const catFilter = document.getElementById("backpack-category-filter")?.value || "";

  const catalogMap = {};
  _giftCatalog.forEach(function(g) { catalogMap[g.id] = g; });

  let filtered = _backpackItems;
  if (searchText) {
    filtered = filtered.filter(function(item) {
      const gift = catalogMap[item.giftId] || {};
      const name = (gift.name || item.giftName || item.giftId || "").toLowerCase();
      return name.includes(searchText) || (item.giftId || "").toLowerCase().includes(searchText);
    });
  }
  if (catFilter) {
    filtered = filtered.filter(function(item) {
      const gift = catalogMap[item.giftId] || {};
      return gift.category === catFilter;
    });
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "grid-column:1/-1;text-align:center;color:var(--text2);padding:24px;";
    empty.textContent = _backpackItems.length === 0 ? "Backpack is empty" : "No matching gifts";
    container.appendChild(empty);
    return;
  }

  filtered.forEach(function(item) {
    const gift = catalogMap[item.giftId] || {};
    const editedQty = _backpackEdits[item.giftId];
    const displayQty = editedQty !== undefined ? editedQty : item.quantity;
    if (displayQty <= 0 && editedQty === undefined) return;

    const card = document.createElement("div");
    card.className = "backpack-item";
    card.dataset.giftId = item.giftId;

    // Remove button (X)
    const removeBtn = document.createElement("button");
    removeBtn.className = "backpack-remove-btn";
    removeBtn.textContent = "\u00D7";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove item");
    removeBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      autoSaveBackpackItem(item.giftId, 0, item.quantity);
    });
    card.appendChild(removeBtn);

    // Quantity badge
    const badge = document.createElement("span");
    badge.className = "backpack-qty-badge";
    badge.textContent = String(displayQty);
    card.appendChild(badge);

    // Gift icon
    const img = document.createElement("img");
    img.src = gift.iconUrl || "";
    img.alt = gift.name || item.giftName || item.giftId;
    img.loading = "lazy";
    img.onerror = function() { this.style.display = "none"; };
    card.appendChild(img);

    // Gift name
    const nameEl = document.createElement("div");
    nameEl.className = "backpack-item-name";
    nameEl.textContent = gift.name || item.giftName || item.giftId;
    nameEl.title = gift.name || item.giftName || item.giftId;
    card.appendChild(nameEl);

    // Edit overlay
    const overlay = document.createElement("div");
    overlay.className = "backpack-edit-overlay";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "0";
    qtyInput.value = String(displayQty);
    qtyInput.style.cssText = "width:100%;text-align:center;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;";
    qtyInput.addEventListener("blur", function() {
      const newQty = Math.max(0, parseInt(qtyInput.value, 10) || 0);
      card.classList.remove("editing");
      if (newQty !== item.quantity) {
        autoSaveBackpackItem(item.giftId, newQty, item.quantity);
      }
    });
    qtyInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") { qtyInput.blur(); }
      if (e.key === "Escape") { card.classList.remove("editing"); }
    });
    overlay.appendChild(qtyInput);
    card.appendChild(overlay);

    // Click to toggle edit
    card.addEventListener("click", function(e) {
      if (e.target === removeBtn) return;
      document.querySelectorAll(".backpack-item.editing").forEach(function(other) {
        if (other !== card) other.classList.remove("editing");
      });
      card.classList.toggle("editing");
      if (card.classList.contains("editing")) {
        qtyInput.focus();
        qtyInput.select();
      }
    });

    container.appendChild(card);
  });
}

async function autoSaveBackpackItem(giftId, newQty, originalQty) {
  try {
    var gift = _giftCatalog.find(function(g) { return g.id === giftId; });
    await apiCall("POST", "/api/users/" + currentUid + "/backpack", { giftId: giftId, quantity: newQty, giftName: gift ? gift.name : giftId });
    const item = _backpackItems.find(function(i) { return i.giftId === giftId; });
    if (item) {
      if (newQty <= 0) {
        _backpackItems = _backpackItems.filter(function(i) { return i.giftId !== giftId; });
      } else {
        item.quantity = newQty;
      }
    }
    delete _backpackEdits[giftId];
    renderBackpack();
    showBackpackToast("Saved", giftId, originalQty, newQty);
  } catch (err) {
    showToast("Failed to save: " + err.message, "error");
  }
}

function showBackpackToast(msg, giftId, oldQty, newQty) {
  const gift = _giftCatalog.find(function(g) { return g.id === giftId; });
  const name = gift ? gift.name : giftId;
  if (newQty <= 0) {
    showToast(name + " removed (was " + oldQty + ")");
  } else {
    showToast(name + ": " + oldQty + " \u2192 " + newQty);
  }
}

function populateCategoryFilter() {
  const select = document.getElementById("backpack-category-filter");
  if (!select) return;
  while (select.options.length > 1) select.remove(1);
  const categories = new Set();
  _giftCatalog.forEach(function(g) { if (g.category) categories.add(g.category); });
  [...categories].sort().forEach(function(cat) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

async function populateGiftSelect() {
  const select = document.getElementById("backpack-gift-select");
  if (!select) return;
  try {
    const raw = await apiCall("GET", "/api/gifts/all");
    _giftCatalog = Array.isArray(raw) ? raw : (raw.gifts || []);
    while (select.options.length > 1) select.remove(1);
    _giftCatalog.forEach(function(g) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name || g.id;
      select.appendChild(opt);
    });
  } catch (err) {
    // Gift catalog not available
  }
}

// Search & filter triggers
document.getElementById("backpack-search")?.addEventListener("input", renderBackpack);
document.getElementById("backpack-category-filter")?.addEventListener("change", renderBackpack);

// Add gift to backpack (immediate)
$("#backpack-add-btn").addEventListener("click", async () => {
  const giftId = $("#backpack-gift-select").value;
  const qty = parseInt($("#backpack-qty").value) || 0;
  if (!giftId || !currentUid || qty <= 0) { showToast("Select a gift and enter a quantity", "error"); return; }
  try {
    const existing = _backpackItems.find(i => i.giftId === giftId);
    const newQty = (existing ? existing.quantity : 0) + qty;
    const giftInfo = _giftCatalog.find(g => g.id === giftId);
    await apiCall("POST", `/api/users/${currentUid}/backpack`, { giftId, quantity: newQty, giftName: giftInfo ? giftInfo.name : giftId });
    showToast(`Added ${qty} (total now ${newQty})`);
    loadBackpack(currentUid);
    $("#backpack-qty").value = "1";
    $("#backpack-gift-select").value = "";
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Clear all backpack items with destructive protection
$("#backpack-clear-btn").addEventListener("click", () => {
  if (_backpackItems.length === 0) { showToast("Backpack is already empty", "error"); return; }
  showClearAllConfirmation();
});

function showClearAllConfirmation() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;";

  const dialog = document.createElement("div");
  dialog.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;";

  const title = document.createElement("h3");
  title.style.cssText = "color:var(--danger);margin:0 0 12px 0;";
  title.textContent = "Clear All Items?";
  dialog.appendChild(title);

  const warning = document.createElement("p");
  warning.style.cssText = "color:var(--text2);margin:0 0 20px 0;font-size:14px;";
  warning.textContent = "This will permanently remove all items from this user's backpack. This action cannot be undone.";
  dialog.appendChild(warning);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

  const cancelBtn = document.createElement("button");
  cancelBtn.style.cssText = "padding:8px 20px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", function() { document.body.removeChild(overlay); });
  btnRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.style.cssText = "padding:8px 20px;background:var(--danger);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;opacity:0.5;";
  confirmBtn.disabled = true;
  let countdown = 5;
  confirmBtn.textContent = "Confirm (" + countdown + ")";

  const timer = setInterval(function() {
    countdown--;
    if (countdown <= 0) {
      clearInterval(timer);
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = "1";
      confirmBtn.textContent = "Confirm Clear All";
    } else {
      confirmBtn.textContent = "Confirm (" + countdown + ")";
    }
  }, 1000);

  confirmBtn.addEventListener("click", async function() {
    if (confirmBtn.disabled) return;
    clearInterval(timer);
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Clearing...";
    await clearAllBackpack();
    document.body.removeChild(overlay);
  });
  btnRow.appendChild(confirmBtn);

  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);

  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) {
      clearInterval(timer);
      document.body.removeChild(overlay);
    }
  });

  document.body.appendChild(overlay);
}

async function clearAllBackpack() {
  let cleared = 0;
  let errors = 0;
  for (const item of _backpackItems) {
    try {
      await apiCall("POST", "/api/users/" + currentUid + "/backpack", { giftId: item.giftId, quantity: 0, silent: true });
      cleared++;
    } catch (err) {
      errors++;
    }
  }
  _backpackItems = [];
  _backpackEdits = {};
  renderBackpack();
  if (errors > 0) {
    showToast("Cleared " + cleared + ", failed " + errors, "error");
  } else {
    showToast("Backpack cleared (" + cleared + " items removed)");
  }
}

// Transaction history
$("#tx-load-btn").addEventListener("click", async () => {
  if (!currentUid) return;
  const typeFilter = $("#tx-type-filter").value;
  const txList = $("#tx-list");
  txList.innerHTML = '<p style="color:var(--text2)">Loading...</p>';
  try {
    const url = typeFilter
      ? `/api/users/${currentUid}/transactions?type=${typeFilter}`
      : `/api/users/${currentUid}/transactions`;
    const data = await apiCall("GET", url);
    const txs = Array.isArray(data) ? data : (data.transactions || []);
    if (txs.length === 0) {
      txList.innerHTML = '<p style="color:var(--text2)">No transactions found</p>';
    } else {
      txList.innerHTML = txs.map(tx => {
        const date = tx.timestamp ? escapeHtml(new Date(tx.timestamp).toLocaleString()) : "—";
        const details = tx.details || tx.giftName || "";
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:var(--accent)">${escapeHtml(tx.type)}</span>
            <span style="color:var(--text2)">${date}</span>
          </div>
          <div>${tx.amount > 0 ? "+" : ""}${escapeHtml(String(tx.amount))} ${escapeHtml(tx.currency || "COINS")} → Balance: ${escapeHtml(String(tx.balanceAfter ?? "?"))}</div>
          ${details ? `<div style="color:var(--text2)">${escapeHtml(details)}</div>` : ""}
        </div>`;
      }).join("");
    }
  } catch (err) {
    txList.innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
});

// --- Gift Catalog Management (batch-edit) ---

// ── Setup Functions (called from init) ──────────────────────────


function setupAutoSaveListeners() { /* wired by attachAutoSaveListeners in auto-save section */ }
function setupEconomyListeners() { /* wired by economy admin section */ }
function setupSuspensionListeners() { /* wired by suspension section */ }
function setupAccountDeletionListeners() { /* wired by account deletion section */ }
function setupWarningListeners() { /* wired by warnings section */ }
function setupSecurityListeners() { /* wired by security section */ }