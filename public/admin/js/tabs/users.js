/**
 * Users tab — full module (PR C migration).
 *
 * Migrated from the inline script block in index.html.
 * The most complex admin tab: 5 subtabs (Profile, Moderation, Security,
 * Economy, Identity), auto-save, list widgets, user search, evidence
 * lightbox, nationality dropdown, email masking, GCS, warnings, etc.
 *
 * Migration is done in chunks — functions are added here and removed
 * from the inline script in the same commit.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let currentUid = null;         // uniqueId of the user being edited
let currentFirebaseUid = null; // Firebase UID (for Firestore access)
let loadedData = {};           // Original user data from API
let rawListData = {};          // Original Firebase UIDs for list fields
let listWidgetData = {};       // Current items for each list widget
let emailRevealed = false;     // Whether email field is unmasked

// Tab-level AbortController — cancelled on tab deactivation
let tabAbortController = new AbortController();

// ── DOM refs (set in init) ─────────────────────────────────────────

let searchUidEl, searchBtnEl, userFormEl;

// ── Dependencies (injected via init) ───────────────────────────────

let _switchTab = () => {};
let _getCurrentTab = () => '';

// ── Forward declarations (populated by later chunks) ───────────────
// Stubs replaced with real implementations as each subtab migrates.

let _populateFormFull = async (/* data */) => {};
let _flushNotifications = async () => {};
let _loadSecurityPanel = async () => {};
let _loadIdentitySubtabGraph = async () => {};

/**
 * Register a function from a later migration chunk.
 * Called internally as each subtab's code is added to this module.
 */
export function _register(name, fn) {
  const map = {
    populateFormFull: (f) => { _populateFormFull = f; },
    flushNotifications: (f) => { _flushNotifications = f; },
    loadSecurityPanel: (f) => { _loadSecurityPanel = f; },
    loadIdentitySubtabGraph: (f) => { _loadIdentitySubtabGraph = f; },
  };
  if (map[name]) map[name](fn);
}

// ── Evidence helpers ───────────────────────────────────────────────

function isVideoUrl(url) {
  return /\.(mp4|mov|webm|avi|mkv|3gp)(\?|$)/i.test(url) ||
    url.toLowerCase().includes("content-type%3dvideo") ||
    url.toLowerCase().includes("contenttype%3dvideo");
}

export function renderEvidence(evidenceUrls) {
  if (!evidenceUrls || evidenceUrls.length === 0) return "";
  const thumbs = evidenceUrls.map(url => {
    const escaped = escapeHtml(url);
    if (isVideoUrl(url)) {
      return `<div class="evidence-thumb" data-evidence-url="${escaped}" data-evidence-type="video">
        <video src="${escaped}" muted preload="metadata"></video>
        <span class="video-badge">&#9654;</span>
      </div>`;
    }
    return `<div class="evidence-thumb" data-evidence-url="${escaped}" data-evidence-type="image">
      <img src="${escaped}" alt="Evidence">
    </div>`;
  }).join("");
  return `<div class="evidence-grid">${thumbs}</div>`;
}

export function openEvidenceLightbox(url, type) {
  const existing = document.querySelector(".evidence-lightbox");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "evidence-lightbox";
  const content = type === "video"
    ? `<video src="${escapeHtml(url)}" controls autoplay style="max-width:90vw;max-height:90vh;border-radius:8px;"></video>`
    : `<img src="${escapeHtml(url)}" style="max-width:90vw;max-height:90vh;border-radius:8px;" alt="Evidence">`;
  overlay.innerHTML = `<button class="evidence-lightbox-close" aria-label="Close">&times;</button>${content}`;
  document.body.appendChild(overlay);
  const onKey = (e) => { if (e.key === "Escape") closeLightbox(); };
  const closeLightbox = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  overlay.querySelector(".evidence-lightbox-close").addEventListener("click", closeLightbox);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeLightbox(); });
  document.addEventListener("keydown", onKey);
  if (type === "video") {
    const video = overlay.querySelector("video");
    if (video) {
      video.addEventListener("error", () => {
        video.replaceWith(Object.assign(document.createElement("div"), {
          style: "color:#fff;text-align:center;padding:32px;",
          innerHTML: `<p style="margin-bottom:12px;">This video could not be played.</p><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#4fc3f7;">Open in new tab</a>`
        }));
      });
    }
  }
}

// ── Utility functions ──────────────────────────────────────────────

const COUNTRY_CODES = [
  "AF","AL","DZ","AD","AO","AG","AR","AM","AU","AT","AZ","BS","BH","BD","BB","BY","BE","BZ","BJ","BT","BO","BA","BW","BR","BN","BG","BF","BI","CV","KH","CM","CA","CF","TD","CL","CN","CO","KM","CG","CD","CR","CI","HR","CU","CY","CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","SZ","ET","FJ","FI","FR","GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN","HU","IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MG","MW","MY","MV","ML","MT","MH","MR","MU","MX","FM","MD","MC","MN","ME","MA","MZ","MM","NA","NR","NP","NL","NZ","NI","NE","NG","MK","NO","OM","PK","PW","PA","PG","PY","PE","PH","PL","PT","QA","RO","RU","RW","KN","LC","VC","WS","SM","ST","SA","SN","RS","SC","SL","SG","SK","SI","SB","SO","ZA","SS","ES","LK","SD","SR","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TO","TT","TN","TR","TM","TV","UG","UA","AE","GB","US","UY","UZ","VU","VE","VN","YE","ZM","ZW"
];

export function codeToFlag(code) {
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 0))}@${domain}`;
}

export function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getFieldEl(name) {
  return document.querySelector(`[data-field="${name}"]`);
}

// ── User subtab switching ──────────────────────────────────────────

export function switchUserSubtab(subtab) {
  document.querySelectorAll(".user-subtab").forEach(b =>
    b.classList.toggle("active", b.dataset.subtab === subtab));
  document.querySelectorAll(".user-subpanel").forEach(p =>
    p.classList.toggle("visible", p.dataset.subtab === subtab));
  if (subtab === "security") _loadSecurityPanel();
  if (subtab === "identity") _loadIdentitySubtabGraph();
}

// ── Search ─────────────────────────────────────────────────────────

async function doSearchFinal() {
  const q = searchUidEl.value.trim();
  if (!q) return;
  await _flushNotifications();
  searchBtnEl.disabled = true;
  searchBtnEl.textContent = "Searching...";
  userFormEl.classList.remove("visible");
  document.getElementById("user-subtabs").style.display = "none";
  document.getElementById("profile-preview").style.display = "none";
  try {
    const data = await apiCall("GET", `/api/search/uniqueId/${q}`);
    await _populateFormFull(data);
    sessionStorage.setItem("admin_user_search", q);
  } catch (err) {
    if (err.name === "AbortError") return;
    showToast(err.message, "error");
    sessionStorage.removeItem("admin_user_search");
  }
  searchBtnEl.disabled = false;
  searchBtnEl.textContent = "Search";
}

/**
 * Programmatic user search — used by Reports, Suggestions, and
 * Identity graph tabs to navigate to a specific user.
 */
export function searchUserByUniqueId(uid) {
  if (searchUidEl) {
    searchUidEl.value = uid;
    doSearchFinal();
  }
}

/** Return the unique ID of the currently loaded user. */
export function getCurrentUid() {
  return currentUid;
}

// ── Getters / setters for shared state ─────────────────────────────

export function getState() {
  return {
    currentUid, currentFirebaseUid, loadedData, rawListData,
    listWidgetData, emailRevealed, tabAbortController,
  };
}

export function setState(patch) {
  if ("currentUid" in patch) currentUid = patch.currentUid;
  if ("currentFirebaseUid" in patch) currentFirebaseUid = patch.currentFirebaseUid;
  if ("loadedData" in patch) loadedData = patch.loadedData;
  if ("rawListData" in patch) rawListData = patch.rawListData;
  if ("listWidgetData" in patch) listWidgetData = patch.listWidgetData;
  if ("emailRevealed" in patch) emailRevealed = patch.emailRevealed;
}

// ── Nationality dropdown builder ───────────────────────────────────

function buildNationalityDropdown() {
  const nationalitySelect = document.getElementById("nationality-select");
  if (!nationalitySelect || nationalitySelect.options.length > 1) return;
  const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "\u2014 None \u2014";
  nationalitySelect.appendChild(noneOpt);
  for (const code of COUNTRY_CODES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${codeToFlag(code)} \u2014 ${countryNames.of(code)}`;
    nationalitySelect.appendChild(opt);
  }
}

// ── Tab lifecycle ──────────────────────────────────────────────────

export function init(deps) {
  _switchTab = deps.switchTab || _switchTab;
  _getCurrentTab = deps.getCurrentTab || _getCurrentTab;

  // Cache DOM refs
  searchUidEl = document.getElementById("search-uid");
  searchBtnEl = document.getElementById("search-btn");
  userFormEl = document.getElementById("user-form");

  // Wire search
  if (searchBtnEl) searchBtnEl.addEventListener("click", doSearchFinal);
  if (searchUidEl) searchUidEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearchFinal();
  });

  // Wire subtab buttons
  document.querySelectorAll(".user-subtab").forEach(btn => {
    btn.addEventListener("click", () => switchUserSubtab(btn.dataset.subtab));
  });

  // Build nationality dropdown
  buildNationalityDropdown();
}

export function activate() {
  // No-op for now — inline code still handles tab activation.
  // Will restore saved search when inline code is removed.
}

export function deactivate() {
  tabAbortController.abort();
  tabAbortController = new AbortController();
}

// ═══════════════════════════════════════════════════════════════════
// CHUNK 2: Profile subtab — form population, auto-save, field helpers
// ═══════════════════════════════════════════════════════════════════

// ── Field constants ────────────────────────────────────────────────

const ARRAY_FIELDS = ["blockedUserIds", "followingIds", "followerIds"];
const BOOLEAN_FIELDS = ["hideFollowing", "hideOnlineStatus", "hideAge"];
const TIMESTAMP_FIELDS = ["dateOfBirth", "createdAt", "lastSeenAt"];
const NULLABLE_FIELDS = [
  "avatarUrl", "profilePhotoUrl", "coverPhotoUrl", "description",
  "nationality", "email", "dateOfBirth"
];
const READONLY_FIELDS = [];
const ECONOMY_FIELDS = ["isSuperShy", "superShyExpiry", "loginStreak", "pityCounter"];
const CHAR_LIMITS = { displayName: 20, description: 200 };

const autoSaveState = {
  pendingNotifyFields: [],
  notifyTimer: null,
  NOTIFY_DEBOUNCE_MS: 30000,
};

// ── DOM refs for profile (set in init) ─────────────────────────────

let emailInput, emailToggle, realEmail = "", fieldUid;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── List widget helpers ────────────────────────────────────────────

function getListWidget(field) {
  const map = { blockedUserIds: "list-blockedUserIds", followingIds: "list-followingIds", followerIds: "list-followerIds" };
  return $(`#${map[field]}`);
}

const _listSavePending = {};

async function autoSaveListField(field) {
  if (!currentUid) return;
  _listSavePending[field] = true;
  if (_listSavePending[field + "_busy"]) return;
  _listSavePending[field + "_busy"] = true;
  try {
    while (_listSavePending[field]) {
      _listSavePending[field] = false;
      const items = (listWidgetData[field] || [])
        .map((s) => s.replace(/\s*\(.*\)$/, "").trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n));
      await apiCall("PATCH", `/api/user/${currentUid}`, { [field]: items });
    }
  } catch (err) {
    showToast(`Failed to save ${field}: ${err.message}`, "error");
  } finally {
    _listSavePending[field + "_busy"] = false;
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

// ── Form population ────────────────────────────────────────────────

export async function populateForm(data) {
  currentUid = String(data.uniqueId || "");
  currentFirebaseUid = data.uid;
  if (fieldUid) fieldUid.textContent = data.uid || "";
  const uniqueIdEl = document.getElementById("field-uniqueId");
  if (uniqueIdEl) uniqueIdEl.textContent = data.uniqueId ?? "\u2014";

  // Resolve Firebase UIDs -> uniqueIds + displayNames
  const allUids = new Set();
  for (const field of ARRAY_FIELDS) {
    const arr = data[field];
    if (Array.isArray(arr)) arr.forEach((uid) => allUids.add(uid));
  }

  let uidToInfo = {};
  if (allUids.size > 0) {
    try {
      const result = await apiCall("POST", "/api/resolve/uids-to-uniqueIds", { uids: [...allUids] });
      uidToInfo = result.mapping;
    } catch (err) {
      console.error("Failed to resolve UIDs:", err);
    }
  }

  rawListData = {};
  for (const field of ARRAY_FIELDS) {
    rawListData[field] = Array.isArray(data[field]) ? [...data[field]] : [];
  }

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

  for (const field of ARRAY_FIELDS) {
    listWidgetData[field] = Array.isArray(data[field]) ? [...data[field]] : [];
    renderListWidget(field);
  }

  for (const el of $$(("[data-field]"))) {
    const field = el.dataset.field;
    const val = data[field];
    if (ARRAY_FIELDS.includes(field)) continue;
    if (BOOLEAN_FIELDS.includes(field)) {
      el.checked = val === true;
    } else if (TIMESTAMP_FIELDS.includes(field)) {
      el.value = isoToLocal(val);
    } else if (field === "email") {
      realEmail = val ?? "";
      emailRevealed = false;
      if (emailToggle) emailToggle.textContent = "Show";
      if (emailInput) { emailInput.value = maskEmail(realEmail); emailInput.readOnly = true; }
    } else {
      el.value = val ?? "";
    }
  }

  // Read-only timestamps
  const createdAtEl = $("#field-createdAt");
  if (createdAtEl) createdAtEl.textContent = data.createdAt ? new Date(data.createdAt).toLocaleString() : "\u2014";
  const lastSeenEl = $("#field-lastSeenAt");
  if (lastSeenEl) lastSeenEl.textContent = data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString() : "\u2014";

  if (userFormEl) userFormEl.classList.add("visible");
}

// ── Field value helpers ────────────────────────────────────────────

export function getFieldValue(field) {
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

export function getOriginalValue(field) {
  const val = loadedData[field];
  if (BOOLEAN_FIELDS.includes(field)) return val === true;
  if (ARRAY_FIELDS.includes(field)) {
    return Array.isArray(val) ? val.map((s) => s.replace(/\s*\(.*\)$/, "")) : [];
  }
  if (TIMESTAMP_FIELDS.includes(field)) return val || null;
  return val ?? null;
}

export function valuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function isFieldChanged(field) {
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

// ── Auto-save feedback ─────────────────────────────────────────────

export function showFieldFeedback(fieldEl, status, previousValue) {
  let container = fieldEl.parentElement;
  let feedback = container.querySelector(".field-feedback");
  if (feedback) feedback.remove();
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
      undoLink.addEventListener("click", () => undoFieldSave(fieldEl, previousValue));
      feedback.appendChild(undoLink);
    }
    feedback.classList.add("visible");
    container.appendChild(feedback);
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
    setTimeout(() => {
      feedback.classList.remove("visible");
      setTimeout(() => { if (feedback.parentElement) feedback.remove(); }, 400);
    }, 8000);
  }
}

// ── Economy field helpers ──────────────────────────────────────────

export function getEconomyFieldValue(fieldName) {
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

export function getEconomyFieldEl(fieldName) {
  if (fieldName === "isSuperShy") return document.getElementById("eco-super-shy");
  if (fieldName === "superShyExpiry") return document.getElementById("eco-super-shy-expiry");
  if (fieldName === "loginStreak") return document.getElementById("eco-streak");
  if (fieldName === "pityCounter") return document.getElementById("eco-pity");
  return null;
}

export function isEconomyFieldChanged(fieldName) {
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

// ── Auto-save field ────────────────────────────────────────────────

export async function autoSaveField(fieldEl) {
  if (!currentUid) return;
  const field = fieldEl.dataset ? fieldEl.dataset.field : null;
  if (!field) return;
  if (READONLY_FIELDS.includes(field)) return;
  if (ARRAY_FIELDS.includes(field)) return;

  const current = getFieldValue(field);
  const original = getOriginalValue(field);

  if (field === "displayName" && (typeof current !== "string" || current.trim().length === 0)) {
    fieldEl.classList.add("field-save-failed");
    showFieldFeedback(fieldEl, "failed");
    showToast("Display name cannot be empty", "error");
    return;
  }

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
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [field]: current });
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

export async function autoSaveEconomyField(fieldName) {
  if (!currentUid) return;
  if (!isEconomyFieldChanged(fieldName)) return;
  const el = getEconomyFieldEl(fieldName);
  if (!el) return;
  const value = getEconomyFieldValue(fieldName);
  const previousValue = loadedData[fieldName];

  el.classList.add("field-saving");
  showFieldFeedback(el, "saving");

  try {
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [fieldName]: value });
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

// ── Undo field save ────────────────────────────────────────────────

export async function undoFieldSave(fieldEl, previousValue) {
  if (!currentUid) return;
  const field = fieldEl.dataset ? fieldEl.dataset.field : null;
  const ecoFieldName = ECONOMY_FIELDS.find(f => getEconomyFieldEl(f) === fieldEl);
  const fieldName = field || ecoFieldName;
  if (!fieldName) return;

  fieldEl.classList.add("field-saving");
  showFieldFeedback(fieldEl, "saving");

  try {
    await apiCall("PATCH", "/api/user/" + currentUid + "?silent=true", { [fieldName]: previousValue });
    fieldEl.classList.remove("field-saving");
    loadedData[fieldName] = previousValue;

    if (ecoFieldName) {
      if (ecoFieldName === "isSuperShy") {
        $("#eco-super-shy").value = previousValue ? "true" : "false";
        $("#eco-super-shy-expiry").disabled = !previousValue;
      } else if (ecoFieldName === "superShyExpiry") {
        if (previousValue) {
          const d = new Date(previousValue);
          const pad = n => String(n).padStart(2, "0");
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
      if (emailInput) emailInput.value = emailRevealed ? realEmail : maskEmail(realEmail);
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

// ── Change notification batching ───────────────────────────────────

export function queueNotifyField(fieldName) {
  if (!autoSaveState.pendingNotifyFields.includes(fieldName)) {
    autoSaveState.pendingNotifyFields.push(fieldName);
  }
  if (autoSaveState.notifyTimer) clearTimeout(autoSaveState.notifyTimer);
  autoSaveState.notifyTimer = setTimeout(flushNotifications, autoSaveState.NOTIFY_DEBOUNCE_MS);
}

export async function flushNotifications() {
  if (autoSaveState.notifyTimer) {
    clearTimeout(autoSaveState.notifyTimer);
    autoSaveState.notifyTimer = null;
  }
  if (!currentUid || autoSaveState.pendingNotifyFields.length === 0) return;
  const fields = [...autoSaveState.pendingNotifyFields];
  autoSaveState.pendingNotifyFields = [];
  try {
    await apiCall("POST", "/api/user/" + currentUid + "/notify-changes", { fields: fields });
  } catch (err) {
    console.warn("Failed to send change notification PM:", err);
  }
}

// Wire flushNotifications into the forward declaration
_register("flushNotifications", flushNotifications);

// ── Character counter ──────────────────────────────────────────────

export function updateCharCounter(field, len) {
  const counter = document.getElementById("counter-" + field);
  if (!counter) return;
  const max = CHAR_LIMITS[field];
  counter.textContent = len + "/" + max;
  counter.classList.remove("near-limit", "at-limit");
  if (len >= max) counter.classList.add("at-limit");
  else if (len >= max * 0.9) counter.classList.add("near-limit");
}

// ── Auto-save listener attachment ──────────────────────────────────

export function attachAutoSaveListeners() {
  if (window._autoSaveListenersAttached) return;
  window._autoSaveListenersAttached = true;

  document.addEventListener("blur", (e) => {
    const el = e.target;
    const field = el.dataset ? el.dataset.field : null;
    if (!field) return;
    if (ARRAY_FIELDS.includes(field)) return;
    if (el.type === "checkbox" || el.tagName === "SELECT") return;
    autoSaveField(el);
  }, true);

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
  if (ecoSuperShy) ecoSuperShy.addEventListener("change", () => autoSaveEconomyField("isSuperShy"));

  const ecoExpiry = document.getElementById("eco-super-shy-expiry");
  if (ecoExpiry) ecoExpiry.addEventListener("change", () => autoSaveEconomyField("superShyExpiry"));

  const ecoStreak = document.getElementById("eco-streak");
  if (ecoStreak) ecoStreak.addEventListener("blur", () => autoSaveEconomyField("loginStreak"));

  const ecoPity = document.getElementById("eco-pity");
  if (ecoPity) ecoPity.addEventListener("blur", () => autoSaveEconomyField("pityCounter"));

  // Character counter input listener
  document.addEventListener("input", (e) => {
    const el = e.target;
    const field = el.dataset ? el.dataset.field : null;
    if (field && CHAR_LIMITS[field]) {
      updateCharCounter(field, (el.value || "").length);
    }
  });
}

// ── Email toggle + clear buttons wiring ────────────────────────────

export function wireEmailAndClearButtons() {
  emailInput = document.getElementById("email-input") || $("[data-field='email']");
  emailToggle = document.getElementById("email-toggle");
  fieldUid = document.getElementById("field-uid");

  if (emailToggle) {
    emailToggle.addEventListener("click", () => {
      emailRevealed = !emailRevealed;
      emailToggle.textContent = emailRevealed ? "Hide" : "Show";
      if (emailInput) {
        emailInput.value = emailRevealed ? realEmail : maskEmail(realEmail);
        emailInput.readOnly = !emailRevealed;
      }
    });
  }

  if (emailInput) {
    emailInput.addEventListener("input", () => {
      if (emailRevealed) realEmail = emailInput.value;
    });
  }

  // Clear buttons
  for (const btn of $$("[data-clear]")) {
    btn.addEventListener("click", () => {
      const field = btn.dataset.clear;
      if (field === "email") {
        realEmail = "";
        if (emailInput) { emailInput.value = ""; emailInput.readOnly = false; }
        emailRevealed = true;
        if (emailToggle) emailToggle.textContent = "Hide";
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

  // List widget add buttons
  for (const field of ["blockedUserIds", "followingIds", "followerIds"]) {
    const widget = getListWidget(field);
    if (!widget) continue;
    const addInput = widget.querySelector(".list-add input");
    const addBtn = widget.querySelector(".list-add button");
    const doAdd = () => {
      const val = addInput.value.trim();
      if (!val) return;
      if (!listWidgetData[field]) listWidgetData[field] = [];
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
}
