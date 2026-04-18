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

// ===============================================================
// CHUNK 3: Moderation subtab - suspension, GCS, warnings, deletion
// ===============================================================

// -- GCS helpers ------------------------------------------------

export function gcsClass(score) {
  if (score >= 80) return "gcs-green";
  if (score >= 60) return "gcs-yellow";
  if (score >= 40) return "gcs-orange";
  if (score >= 20) return "gcs-red";
  return "gcs-darkred";
}

export function gcsEmoji(score) {
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

// -- Suspension section -----------------------------------------

export function populateSuspensionSection(data) {
  const suspensionSection = $("#suspension-section");
  const suspensionStatus = $("#suspension-status");
  const suspendBtn = $("#suspend-btn");
  const unsuspendBtn = $("#unsuspend-btn");
  if (suspensionSection) suspensionSection.style.display = "block";
  if (data.isSuspended) {
    const since = data.suspensionStartDate ? new Date(data.suspensionStartDate).toLocaleString() : "unknown";
    const until = data.suspensionEndDate ? new Date(data.suspensionEndDate).toLocaleString() : "permanent";
    if (suspensionStatus) { suspensionStatus.className = "suspension-status suspended"; suspensionStatus.textContent = "Suspended since " + since + ", until " + until + ". Reason: " + (data.suspensionReason || "No reason provided"); }
    if (suspendBtn) suspendBtn.style.display = "none";
    if (unsuspendBtn) unsuspendBtn.style.display = "";
    const preSuspensionInfo = $("#pre-suspension-info");
    if (data._preSuspension && preSuspensionInfo) preSuspensionInfo.style.display = "block";
    else if (preSuspensionInfo) preSuspensionInfo.style.display = "none";
  } else {
    if (suspensionStatus) { suspensionStatus.className = "suspension-status not-suspended"; suspensionStatus.textContent = "Not Suspended"; }
    if (suspendBtn) suspendBtn.style.display = "";
    if (unsuspendBtn) unsuspendBtn.style.display = "none";
    const preSuspensionInfo = $("#pre-suspension-info");
    if (preSuspensionInfo) preSuspensionInfo.style.display = "none";
  }
  const suspendReason = $("#suspend-reason"); if (suspendReason) suspendReason.value = "";
  const suspendEndDate = $("#suspend-end-date"); if (suspendEndDate) suspendEndDate.value = "";
  const suspendCanAppeal = $("#suspend-can-appeal"); if (suspendCanAppeal) suspendCanAppeal.checked = false;
}

// -- Deletion section -------------------------------------------

export function populateDeletionSection(data) {
  const deletionStatusBadge = $("#deletion-status-badge");
  const deletionNotScheduled = $("#deletion-not-scheduled");
  const scheduleDeletionBtn = $("#schedule-deletion-btn");
  const cancelDeletionBtn = $("#cancel-deletion-btn");
  if (data.deletionScheduledAt) {
    const executeDate = new Date(data.deletionExecuteAt).toLocaleDateString();
    const msRemaining = data.deletionExecuteAt - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));
    if (deletionStatusBadge) { deletionStatusBadge.textContent = "Deletion scheduled \u2014 " + daysRemaining + " days remaining (" + executeDate + ")"; deletionStatusBadge.style.display = "block"; }
    if (deletionNotScheduled) deletionNotScheduled.style.display = "none";
    if (scheduleDeletionBtn) scheduleDeletionBtn.style.display = "none";
    if (cancelDeletionBtn) cancelDeletionBtn.style.display = "";
  } else {
    if (deletionStatusBadge) deletionStatusBadge.style.display = "none";
    if (deletionNotScheduled) deletionNotScheduled.style.display = "block";
    if (scheduleDeletionBtn) scheduleDeletionBtn.style.display = "";
    if (cancelDeletionBtn) cancelDeletionBtn.style.display = "none";
  }
}

// -- GCS section ------------------------------------------------

export function populateGcsSection(data) {
  const gcsSection = $("#gcs-section");
  const gcsBadgeUser = $("#gcs-badge-user");
  const gcsFloor = $("#gcs-floor");
  const gcsWarnings = $("#gcs-warnings");
  const gcsLastDeduction = $("#gcs-last-deduction");
  if (gcsSection) gcsSection.style.display = "block";
  const floor = data.gcsScore ?? data.goodCharacterScore ?? 100;
  const lastDeduction = data.gcsLastDeductionAt ?? data.goodCharacterLastDeductionAt ?? null;
  const display = data.gcsDisplayScore ?? computeDisplayScore(floor, lastDeduction);
  if (gcsBadgeUser) { gcsBadgeUser.className = "gcs-badge " + gcsClass(display); gcsBadgeUser.textContent = gcsEmoji(display) + " " + display; }
  if (gcsFloor) gcsFloor.textContent = floor;
  if (gcsWarnings) gcsWarnings.textContent = data.warningCount || 0;
  if (gcsLastDeduction) gcsLastDeduction.textContent = lastDeduction ? new Date(lastDeduction).toLocaleString() : "Never";
}

// -- Report history ---------------------------------------------

export async function loadReportHistory(uid) {
  if (!uid || uid === "undefined" || uid === "null") return;
  const reportHistorySection = $("#report-history-section");
  const reportHistoryList = $("#report-history-list");
  if (reportHistorySection) reportHistorySection.style.display = "block";
  if (!reportHistoryList) return;
  reportHistoryList.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading...</div>';
  try {
    const result = await apiCall("GET", "/api/reports?status=resolved&userId=" + uid);
    const allReports = Array.isArray(result) ? result : (result.users ? result.users.flatMap((u) => u.reports) : []);
    if (allReports.length === 0) { reportHistoryList.innerHTML = '<div style="color:var(--text2);font-size:12px;font-style:italic;">No report history</div>'; return; }
    reportHistoryList.innerHTML = "";
    for (const r of allReports.slice(0, 10)) {
      const div = document.createElement("div");
      div.className = "report-history-item";
      div.innerHTML = "<strong>" + escapeHtml(r.reason || "Unknown") + "</strong> \u2014 " + escapeHtml(r.resolvedAction || "?") + (r.severity ? " (Severity: " + r.severity + ")" : "") + "<br><span style=\"color:var(--text2)\">" + (r.adminNote ? escapeHtml(r.adminNote) : "") + "</span><br><span style=\"color:var(--text2);font-size:11px\">" + (r.resolvedAt ? escapeHtml(new Date(r.resolvedAt).toLocaleString()) : "") + "</span>";
      reportHistoryList.appendChild(div);
    }
  } catch (err) {
    reportHistoryList.innerHTML = '<div style="color:var(--danger);font-size:12px;">' + escapeHtml(err.message) + "</div>";
  }
}

// -- Warning system ---------------------------------------------

let _warningLastTimestamp = null;

export function resetWarningForm() {
  const directWarnReason = $("#direct-warn-reason");
  const directWarnNote = $("#direct-warn-note");
  if (directWarnReason) directWarnReason.value = "";
  if (directWarnNote) directWarnNote.value = "";
  const defaultSev = document.querySelector('input[name="direct-warn-severity"][value="3"]');
  if (defaultSev) defaultSev.checked = true;
}

export async function loadWarningHistory(uid, append) {
  const warningHistoryList = document.getElementById("warning-history-list");
  const warningLoadMoreBtn = document.getElementById("warning-load-more-btn");
  if (!warningHistoryList) return;
  if (!append) {
    warningHistoryList.textContent = "";
    _warningLastTimestamp = null;
    const ld = document.createElement("div");
    ld.style.cssText = "color:var(--text2);font-size:13px;font-style:italic;";
    ld.textContent = "Loading...";
    warningHistoryList.appendChild(ld);
  }
  try {
    let url = "/api/user/" + uid + "/warnings?limit=20";
    if (_warningLastTimestamp) url += "&startAfter=" + _warningLastTimestamp;
    const data = await apiCall("GET", url);
    const warnings = data.warnings || [];
    if (!append) warningHistoryList.textContent = "";
    if (warnings.length === 0 && !append) {
      const ed = document.createElement("div");
      ed.style.cssText = "color:var(--text2);font-size:13px;font-style:italic;";
      ed.textContent = "No warnings";
      warningHistoryList.appendChild(ed);
      if (warningLoadMoreBtn) warningLoadMoreBtn.style.display = "none";
      return;
    }
    for (const w of warnings) {
      warningHistoryList.appendChild(renderWarningItem(w, uid));
      _warningLastTimestamp = w.createdAt;
    }
    if (warningLoadMoreBtn) warningLoadMoreBtn.style.display = data.hasMore ? "block" : "none";
  } catch (err) {
    if (!append) warningHistoryList.textContent = "";
    const ed = document.createElement("div");
    ed.style.cssText = "color:var(--danger);font-size:12px;";
    ed.textContent = err.message;
    warningHistoryList.appendChild(ed);
    if (warningLoadMoreBtn) warningLoadMoreBtn.style.display = "none";
  }
}

function renderWarningItem(w, uid) {
  const item = document.createElement("div");
  item.className = "warning-item" + (w.revoked ? " revoked" : "");
  item.dataset.warningId = w.id;
  const header = document.createElement("div"); header.className = "warning-item-header";
  const left = document.createElement("div");
  const badge = document.createElement("span"); badge.className = "warning-source-badge " + (w.source || "direct"); badge.textContent = w.source || "direct"; left.appendChild(badge);
  const sev = document.createElement("span"); sev.style.cssText = "margin-left:8px;color:var(--text2);font-size:12px;"; sev.textContent = "Severity " + w.severity + " (-" + (w.gcsDeduction || 0) + " GCS)"; left.appendChild(sev);
  header.appendChild(left);
  const right = document.createElement("div"); right.style.cssText = "display:flex;align-items:center;gap:6px;";
  const dateSpan = document.createElement("span"); dateSpan.style.cssText = "color:var(--text2);font-size:11px;"; dateSpan.textContent = w.createdAt ? new Date(w.createdAt).toLocaleString() : ""; right.appendChild(dateSpan);
  if (!w.revoked) { const rb = document.createElement("button"); rb.className = "btn-revoke-warning"; rb.textContent = "Revoke"; rb.addEventListener("click", () => revokeWarning(uid, w.id, w.gcsDeduction || 0, rb)); right.appendChild(rb); }
  else { const rs = document.createElement("span"); rs.style.cssText = "color:var(--text2);font-size:11px;font-style:italic;"; rs.textContent = "Revoked"; right.appendChild(rs); }
  header.appendChild(right); item.appendChild(header);
  const reason = document.createElement("div"); reason.style.marginTop = "4px"; reason.textContent = w.reason || ""; item.appendChild(reason);
  if (w.adminNote) { const note = document.createElement("div"); note.style.cssText = "color:var(--text2);font-size:12px;margin-top:2px;font-style:italic;"; note.textContent = "Note: " + w.adminNote; item.appendChild(note); }
  const meta = document.createElement("div"); meta.style.cssText = "color:var(--text2);font-size:11px;margin-top:2px;"; meta.textContent = "By: " + (w.issuedByName || w.issuedBy || "System") + " | GCS: " + (w.gcsBefore || "?") + " \u2192 " + (w.gcsAfter ?? "?"); item.appendChild(meta);
  return item;
}

export async function revokeWarning(uid, warningId, deduction, btn) {
  if (!confirm("Revoke this warning? +" + deduction + " GCS will be restored.")) return;
  btn.disabled = true; btn.textContent = "...";
  try {
    await apiCall("POST", "/api/user/" + uid + "/warnings/" + warningId + "/revoke");
    showToast("Warning revoked, +" + deduction + " GCS restored");
    const data = await apiCall("GET", "/api/user/" + uid);
    populateGcsSection(data);
    loadWarningHistory(uid, false);
  } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.textContent = "Revoke"; }
}

// -- populateFormFull - master form populator --------------------

export async function populateFormFull(data) {
  await populateForm(data);
  populateSuspensionSection(data);
  populateGcsSection(data);
  resetWarningForm();
  loadWarningHistory(String(data.uniqueId || data.uid), false);
  loadReportHistory(String(data.uniqueId || data.uid));
  populateDeletionSection(data);
  const banner = document.getElementById("suspended-banner");
  if (window._suspensionTimer) { clearTimeout(window._suspensionTimer); window._suspensionTimer = null; }
  if (data.isSuspended) {
    if (banner) banner.style.display = "block";
    if (data.suspensionEndDate) {
      const msLeft = new Date(data.suspensionEndDate).getTime() - Date.now();
      if (msLeft <= 0) { if (banner) banner.style.display = "none"; }
      else { window._suspensionTimer = setTimeout(() => { if (banner) banner.style.display = "none"; }, msLeft); }
    }
  } else { if (banner) banner.style.display = "none"; }
  document.getElementById("user-subtabs").style.display = "flex";
  switchUserSubtab("profile");
}

// Wire populateFormFull into the forward declaration
_register("populateFormFull", populateFormFull);

// ===============================================================
// CHUNK 4: Security subtab
// ===============================================================

export async function loadSecurityPanel() {
  const uid = currentUid;
  if (!uid) return;
  try {
    const [authRes, otpRes] = await Promise.all([
      apiCall("GET", `/api/user/${uid}/auth-status`),
      apiCall("GET", "/api/metrics/otp"),
    ]);
    // PIN status
    const pinSet = document.getElementById("pin-set");
    if (pinSet) pinSet.textContent = authRes.pinSet ? "Yes" : "No";
    const pinSetAt = document.getElementById("pin-set-at");
    if (pinSetAt) pinSetAt.textContent = authRes.pinSetAt ? new Date(authRes.pinSetAt).toLocaleString() : "\u2014";
    const pinAttempts = document.getElementById("pin-attempts");
    if (pinAttempts) pinAttempts.textContent = authRes.pinAttempts;
    const pinLockedUntil = document.getElementById("pin-locked-until");
    if (pinLockedUntil) pinLockedUntil.textContent = authRes.pinLockedUntil ? new Date(authRes.pinLockedUntil).toLocaleString() : "\u2014";
    const pinLockoutCount = document.getElementById("pin-lockout-count");
    if (pinLockoutCount) pinLockoutCount.textContent = authRes.pinLockoutCount;
    const pinIsLocked = document.getElementById("pin-is-locked");
    if (pinIsLocked) { pinIsLocked.textContent = authRes.isLocked ? "YES" : "No"; pinIsLocked.style.color = authRes.isLocked ? "var(--danger, #f44)" : "inherit"; }
    const resetBtn = document.getElementById("reset-pin-lockout-btn");
    if (resetBtn) resetBtn.style.display = (authRes.pinAttempts > 0 || authRes.isLocked) ? "inline-block" : "none";

    // Biometric keys
    const keysList = document.getElementById("biometric-keys-list");
    if (keysList) {
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
    }

    // OTP metrics
    const otpCount = document.getElementById("otp-count");
    if (otpCount) otpCount.textContent = otpRes.count;
    const otpDate = document.getElementById("otp-date");
    if (otpDate) otpDate.textContent = otpRes.date || "\u2014";
    const otpLimit = document.getElementById("otp-limit");
    if (otpLimit) otpLimit.textContent = otpRes.limit;
  } catch (err) {
    console.error("Failed to load security panel:", err);
  }
}

export async function resetPinLockout() {
  if (!currentUid || !confirm("Reset PIN lockout for this user?")) return;
  try {
    await apiCall("POST", `/api/user/${currentUid}/reset-pin-lockout`);
    showToast("PIN lockout reset");
    loadSecurityPanel();
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
}

export async function revokeBiometricKey(uniqueId, deviceId) {
  if (!confirm("Revoke biometric key for device " + deviceId + "?")) return;
  try {
    await apiCall("DELETE", `/api/user/${uniqueId}/biometric-keys/${deviceId}`);
    showToast("Biometric key revoked");
    loadSecurityPanel();
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
}

// Wire loadSecurityPanel into the forward declaration
_register("loadSecurityPanel", loadSecurityPanel);

// Expose for inline onclick attributes
export function wireSecurityGlobals() {
  window.resetPinLockout = resetPinLockout;
  window.revokeBiometricKey = revokeBiometricKey;
}

// ===============================================================
// CHUNK 5: Economy subtab - coins, beans, backpack, transactions
// ===============================================================

let _ecoCoins = 0;
let _ecoBeans = 0;
let _backpackItems = [];
let _giftCatalog = [];
let _backpackEdits = {};
let _prevExpiryValue = "";

export function populateEconomySection(data) {
  _ecoCoins = data.shyCoins || 0;
  _ecoBeans = data.shyBeans || 0;
  const cd = $("#eco-coins-display"); if (cd) cd.textContent = _ecoCoins;
  const bd = $("#eco-beans-display"); if (bd) bd.textContent = _ecoBeans;
  const ca = $("#eco-coins-amount"); if (ca) ca.value = "";
  const ba = $("#eco-beans-amount"); if (ba) ba.value = "";
  const ss = $("#eco-super-shy"); if (ss) ss.value = data.isSuperShy ? "true" : "false";
  const isSuperShy = data.isSuperShy === true;
  const isUnlimited = isSuperShy && !data.superShyExpiry;
  const ul = $("#eco-super-shy-unlimited"); if (ul) { ul.checked = isUnlimited; ul.disabled = !isSuperShy; }
  const ex = $("#eco-super-shy-expiry"); if (ex) { ex.disabled = !isSuperShy || isUnlimited; }
  if (isSuperShy && data.superShyExpiry) {
    const d = new Date(data.superShyExpiry);
    const pad = n => String(n).padStart(2, "0");
    if (ex) ex.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else { if (ex) ex.value = ""; }
  const st = $("#eco-streak"); if (st) st.value = data.loginStreak || 0;
  const pt = $("#eco-pity"); if (pt) pt.value = data.pityCounter || 0;
}

export async function loadBackpack(uid) {
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

export function renderBackpack() {
  const container = document.getElementById("backpack-grid");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  const searchText = (document.getElementById("backpack-search")?.value || "").toLowerCase();
  const catFilter = document.getElementById("backpack-category-filter")?.value || "";
  const catalogMap = {};
  _giftCatalog.forEach(function(g) { catalogMap[g.id] = g; });
  let filtered = _backpackItems;
  if (searchText) { filtered = filtered.filter(function(item) { const gift = catalogMap[item.giftId] || {}; const name = (gift.name || item.giftName || item.giftId || "").toLowerCase(); return name.includes(searchText) || (item.giftId || "").toLowerCase().includes(searchText); }); }
  if (catFilter) { filtered = filtered.filter(function(item) { const gift = catalogMap[item.giftId] || {}; return gift.category === catFilter; }); }
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "grid-column:1/-1;text-align:center;color:var(--text2);padding:24px;";
    empty.textContent = _backpackItems.length === 0 ? "Backpack is empty" : "No matching gifts";
    container.appendChild(empty); return;
  }
  filtered.forEach(function(item) {
    const gift = catalogMap[item.giftId] || {};
    const editedQty = _backpackEdits[item.giftId];
    const displayQty = editedQty !== undefined ? editedQty : item.quantity;
    if (displayQty <= 0 && editedQty === undefined) return;
    const card = document.createElement("div"); card.className = "backpack-item"; card.dataset.giftId = item.giftId;
    const removeBtn = document.createElement("button"); removeBtn.className = "backpack-remove-btn"; removeBtn.textContent = "\u00D7"; removeBtn.title = "Remove"; removeBtn.setAttribute("aria-label", "Remove item");
    removeBtn.addEventListener("click", function(e) { e.stopPropagation(); autoSaveBackpackItem(item.giftId, 0, item.quantity); });
    card.appendChild(removeBtn);
    const badge = document.createElement("span"); badge.className = "backpack-qty-badge"; badge.textContent = String(displayQty); card.appendChild(badge);
    const img = document.createElement("img"); img.src = gift.iconUrl || ""; img.alt = gift.name || item.giftName || item.giftId; img.loading = "lazy"; img.onerror = function() { this.style.display = "none"; }; card.appendChild(img);
    const nameEl = document.createElement("div"); nameEl.className = "backpack-item-name"; nameEl.textContent = gift.name || item.giftName || item.giftId; nameEl.title = gift.name || item.giftName || item.giftId; card.appendChild(nameEl);
    const overlay = document.createElement("div"); overlay.className = "backpack-edit-overlay";
    const qtyInput = document.createElement("input"); qtyInput.type = "number"; qtyInput.min = "0"; qtyInput.value = String(displayQty);
    qtyInput.style.cssText = "width:100%;text-align:center;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;";
    qtyInput.addEventListener("blur", function() { const newQty = Math.max(0, parseInt(qtyInput.value, 10) || 0); card.classList.remove("editing"); if (newQty !== item.quantity) autoSaveBackpackItem(item.giftId, newQty, item.quantity); });
    qtyInput.addEventListener("keydown", function(e) { if (e.key === "Enter") qtyInput.blur(); if (e.key === "Escape") card.classList.remove("editing"); });
    overlay.appendChild(qtyInput); card.appendChild(overlay);
    card.addEventListener("click", function(e) { if (e.target === removeBtn) return; document.querySelectorAll(".backpack-item.editing").forEach(function(other) { if (other !== card) other.classList.remove("editing"); }); card.classList.toggle("editing"); if (card.classList.contains("editing")) { qtyInput.focus(); qtyInput.select(); } });
    container.appendChild(card);
  });
}

export async function autoSaveBackpackItem(giftId, newQty, originalQty) {
  try {
    const gift = _giftCatalog.find(function(g) { return g.id === giftId; });
    await apiCall("POST", "/api/users/" + currentUid + "/backpack", { giftId: giftId, quantity: newQty, giftName: gift ? gift.name : giftId });
    const item = _backpackItems.find(function(i) { return i.giftId === giftId; });
    if (item) { if (newQty <= 0) { _backpackItems = _backpackItems.filter(function(i) { return i.giftId !== giftId; }); } else { item.quantity = newQty; } }
    delete _backpackEdits[giftId]; renderBackpack();
    const name = gift ? gift.name : giftId;
    if (newQty <= 0) showToast(name + " removed (was " + originalQty + ")"); else showToast(name + ": " + originalQty + " \u2192 " + newQty);
  } catch (err) { showToast("Failed to save: " + err.message, "error"); }
}

export function populateCategoryFilter() {
  const select = document.getElementById("backpack-category-filter"); if (!select) return;
  while (select.options.length > 1) select.remove(1);
  const categories = new Set(); _giftCatalog.forEach(function(g) { if (g.category) categories.add(g.category); });
  [...categories].sort().forEach(function(cat) { const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat; select.appendChild(opt); });
}

export async function populateGiftSelect() {
  const select = document.getElementById("backpack-gift-select"); if (!select) return;
  try { const raw = await apiCall("GET", "/api/gifts/all"); _giftCatalog = Array.isArray(raw) ? raw : (raw.gifts || []); while (select.options.length > 1) select.remove(1); _giftCatalog.forEach(function(g) { const opt = document.createElement("option"); opt.value = g.id; opt.textContent = g.name || g.id; select.appendChild(opt); }); }
  catch (err) { /* Gift catalog not available */ }
}

function showClearAllConfirmation() {
  const overlay = document.createElement("div"); overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;";
  const dialog = document.createElement("div"); dialog.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;";
  const title = document.createElement("h3"); title.style.cssText = "color:var(--danger);margin:0 0 12px 0;"; title.textContent = "Clear All Items?"; dialog.appendChild(title);
  const warning = document.createElement("p"); warning.style.cssText = "color:var(--text2);margin:0 0 20px 0;font-size:14px;"; warning.textContent = "This will permanently remove all items from this user's backpack. This action cannot be undone."; dialog.appendChild(warning);
  const btnRow = document.createElement("div"); btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";
  const cancelBtn = document.createElement("button"); cancelBtn.style.cssText = "padding:8px 20px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:14px;"; cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", function() { document.body.removeChild(overlay); }); btnRow.appendChild(cancelBtn);
  const confirmBtn = document.createElement("button"); confirmBtn.style.cssText = "padding:8px 20px;background:var(--danger);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;opacity:0.5;"; confirmBtn.disabled = true;
  let countdown = 5; confirmBtn.textContent = "Confirm (" + countdown + ")";
  const timer = setInterval(function() { countdown--; if (countdown <= 0) { clearInterval(timer); confirmBtn.disabled = false; confirmBtn.style.opacity = "1"; confirmBtn.textContent = "Confirm Clear All"; } else { confirmBtn.textContent = "Confirm (" + countdown + ")"; } }, 1000);
  confirmBtn.addEventListener("click", async function() { if (confirmBtn.disabled) return; clearInterval(timer); confirmBtn.disabled = true; confirmBtn.textContent = "Clearing..."; await clearAllBackpack(); document.body.removeChild(overlay); });
  btnRow.appendChild(confirmBtn); dialog.appendChild(btnRow); overlay.appendChild(dialog);
  overlay.addEventListener("click", function(e) { if (e.target === overlay) { clearInterval(timer); document.body.removeChild(overlay); } });
  document.body.appendChild(overlay);
}

async function clearAllBackpack() {
  let cleared = 0, errors = 0;
  for (const item of _backpackItems) { try { await apiCall("POST", "/api/users/" + currentUid + "/backpack", { giftId: item.giftId, quantity: 0, silent: true }); cleared++; } catch (err) { errors++; } }
  _backpackItems = []; _backpackEdits = {}; renderBackpack();
  if (errors > 0) showToast("Cleared " + cleared + ", failed " + errors, "error"); else showToast("Backpack cleared (" + cleared + " items removed)");
}

export function wireEconomyListeners() {
  const ecoSuperShy = $("#eco-super-shy");
  if (ecoSuperShy) ecoSuperShy.addEventListener("change", () => { const isSS = ecoSuperShy.value === "true"; const ul = $("#eco-super-shy-unlimited"); if (ul) ul.disabled = !isSS; if (!isSS) { if (ul) ul.checked = false; const ex = $("#eco-super-shy-expiry"); if (ex) { ex.value = ""; ex.disabled = true; } } else { const ex = $("#eco-super-shy-expiry"); if (ex && ul) ex.disabled = ul.checked; } });
  const unlimitedCb = $("#eco-super-shy-unlimited");
  if (unlimitedCb) unlimitedCb.addEventListener("change", () => { const unlimited = unlimitedCb.checked; const expiryEl = $("#eco-super-shy-expiry"); if (!expiryEl) return; if (unlimited) { _prevExpiryValue = expiryEl.value; expiryEl.value = ""; expiryEl.disabled = true; autoSaveEconomyField("superShyExpiry"); } else { expiryEl.disabled = false; expiryEl.value = _prevExpiryValue || "1970-01-01T00:00"; autoSaveEconomyField("superShyExpiry"); } });
  const coinsApply = $("#eco-coins-apply");
  if (coinsApply) coinsApply.addEventListener("click", async () => { if (!currentUid) return; const op = $("#eco-coins-op")?.value; const amount = parseInt($("#eco-coins-amount")?.value) || 0; if (amount <= 0) { showToast("Enter a positive amount", "error"); return; } try { const result = await apiCall("POST", `/api/users/${currentUid}/adjust-balance`, { currency: "COINS", amount, operation: op }); _ecoCoins = result.newBalance; const cd = $("#eco-coins-display"); if (cd) cd.textContent = _ecoCoins; const ca = $("#eco-coins-amount"); if (ca) ca.value = ""; showToast((op === "add" ? "Added" : "Deducted") + " " + amount + " coins (now " + _ecoCoins + ")"); } catch (err) { showToast(err.message, "error"); } });
  const beansApply = $("#eco-beans-apply");
  if (beansApply) beansApply.addEventListener("click", async () => { if (!currentUid) return; const op = $("#eco-beans-op")?.value; const amount = parseInt($("#eco-beans-amount")?.value) || 0; if (amount <= 0) { showToast("Enter a positive amount", "error"); return; } try { const result = await apiCall("POST", `/api/users/${currentUid}/adjust-balance`, { currency: "BEANS", amount, operation: op }); _ecoBeans = result.newBalance; const bd = $("#eco-beans-display"); if (bd) bd.textContent = _ecoBeans; const ba = $("#eco-beans-amount"); if (ba) ba.value = ""; showToast((op === "add" ? "Added" : "Deducted") + " " + amount + " beans (now " + _ecoBeans + ")"); } catch (err) { showToast(err.message, "error"); } });
  const bpSearch = document.getElementById("backpack-search"); if (bpSearch) bpSearch.addEventListener("input", renderBackpack);
  const bpCatFilter = document.getElementById("backpack-category-filter"); if (bpCatFilter) bpCatFilter.addEventListener("change", renderBackpack);
  const addBtn = $("#backpack-add-btn");
  if (addBtn) addBtn.addEventListener("click", async () => { const giftId = $("#backpack-gift-select")?.value; const qty = parseInt($("#backpack-qty")?.value) || 0; if (!giftId || !currentUid || qty <= 0) { showToast("Select a gift and enter a quantity", "error"); return; } try { const existing = _backpackItems.find(i => i.giftId === giftId); const newQty = (existing ? existing.quantity : 0) + qty; const giftInfo = _giftCatalog.find(g => g.id === giftId); await apiCall("POST", `/api/users/${currentUid}/backpack`, { giftId, quantity: newQty, giftName: giftInfo ? giftInfo.name : giftId }); showToast("Added " + qty + " (total now " + newQty + ")"); loadBackpack(currentUid); const bpQty = $("#backpack-qty"); if (bpQty) bpQty.value = "1"; const bpSel = $("#backpack-gift-select"); if (bpSel) bpSel.value = ""; } catch (err) { showToast(err.message, "error"); } });
  const clearBtn = $("#backpack-clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", () => { if (_backpackItems.length === 0) { showToast("Backpack is already empty", "error"); return; } showClearAllConfirmation(); });
  const txLoadBtn = $("#tx-load-btn");
  if (txLoadBtn) txLoadBtn.addEventListener("click", async () => { if (!currentUid) return; const typeFilter = $("#tx-type-filter")?.value; const txList = $("#tx-list"); if (!txList) return; txList.innerHTML = '<p style="color:var(--text2)">Loading...</p>'; try { const url = typeFilter ? `/api/users/${currentUid}/transactions?type=${typeFilter}` : `/api/users/${currentUid}/transactions`; const data = await apiCall("GET", url); const txs = Array.isArray(data) ? data : (data.transactions || []); if (txs.length === 0) { txList.innerHTML = '<p style="color:var(--text2)">No transactions found</p>'; } else { txList.innerHTML = txs.map(tx => { const date = tx.timestamp ? escapeHtml(new Date(tx.timestamp).toLocaleString()) : "\u2014"; const details = tx.details || tx.giftName || ""; return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><div style="display:flex;justify-content:space-between"><span style="color:var(--accent)">' + escapeHtml(tx.type) + '</span><span style="color:var(--text2)">' + date + '</span></div><div>' + (tx.amount > 0 ? "+" : "") + escapeHtml(String(tx.amount)) + " " + escapeHtml(tx.currency || "COINS") + " \u2192 Balance: " + escapeHtml(String(tx.balanceAfter ?? "?")) + "</div>" + (details ? '<div style="color:var(--text2)">' + escapeHtml(details) + "</div>" : "") + "</div>"; }).join(""); } } catch (err) { txList.innerHTML = '<p style="color:var(--danger)">' + escapeHtml(err.message) + "</p>"; } });
}

// ===============================================================
// CHUNK 6: Identity Graph subtab
// ===============================================================

export async function loadIdentitySubtabGraph() {
  const uid = currentUid;
  if (!uid) return;
  const container = document.getElementById("identity-graph-container");
  const empty = document.getElementById("identity-graph-empty");
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading identity graph\u2026</div>';
  container.style.display = "block";
  if (empty) empty.style.display = "none";
  try { const data = await apiCall("GET", `/api/admin/identity-graph/${uid}`); renderIdentitySubtabGraph(data); }
  catch (err) { container.style.display = "none"; if (empty) empty.style.display = "block"; }
}

function renderIdentitySubtabGraph(data) {
  const container = document.getElementById("identity-graph-container");
  const empty = document.getElementById("identity-graph-empty");
  const nodes = (data && data.nodes) || [];
  const edges = (data && data.edges) || [];
  if (nodes.length === 0) { if (container) container.style.display = "none"; if (empty) empty.style.display = "block"; return; }
  if (container) { container.style.display = "block"; container.innerHTML = ""; }
  if (empty) empty.style.display = "none";
  const NODE_COLORS = { account: "#7c5cfc", device: "#3498db", network: "#27ae60" };
  const SVG_W = Math.max(800, nodes.length * 140); const SVG_H = 400;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(SVG_W)); svg.setAttribute("height", String(SVG_H)); svg.style.display = "block"; svg.style.minWidth = SVG_W + "px";
  const positions = {}; const COLS = Math.ceil(Math.sqrt(nodes.length));
  nodes.forEach((n, i) => { const col = i % COLS; const row = Math.floor(i / COLS); positions[n.id] = { x: 80 + col * 140, y: 80 + row * 120 }; });
  edges.forEach((e) => { const a = positions[e.source]; const b = positions[e.target]; if (!a || !b) return; const line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("x1", String(a.x)); line.setAttribute("y1", String(a.y)); line.setAttribute("x2", String(b.x)); line.setAttribute("y2", String(b.y)); line.setAttribute("stroke", "#666"); line.setAttribute("stroke-width", "2"); line.setAttribute("class", "graph-edge graph-link"); line.setAttribute("data-type", e.type || "link"); svg.appendChild(line); });
  nodes.forEach((n) => {
    const pos = positions[n.id]; const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "graph-node" + (n.suspended ? " suspended" : "")); g.setAttribute("data-type", n.type || "unknown"); g.setAttribute("data-id", n.id); g.style.cursor = "pointer";
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect"); rect.setAttribute("x", String(pos.x - 50)); rect.setAttribute("y", String(pos.y - 20)); rect.setAttribute("width", "100"); rect.setAttribute("height", "40"); rect.setAttribute("rx", "6"); rect.setAttribute("fill", NODE_COLORS[n.type] || "#888"); rect.setAttribute("stroke", n.suspended ? "#e74c3c" : "#333"); rect.setAttribute("stroke-width", n.suspended ? "3" : "1"); g.appendChild(rect);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.setAttribute("x", String(pos.x)); text.setAttribute("y", String(pos.y + 5)); text.setAttribute("text-anchor", "middle"); text.setAttribute("fill", "#fff"); text.setAttribute("font-size", "12"); text.textContent = (n.label || n.id || "").toString().slice(0, 12); g.appendChild(text);
    if (n.type === "device" && n.linkedAccounts && n.linkedAccounts.length > 1) { const warn = document.createElementNS("http://www.w3.org/2000/svg", "text"); warn.setAttribute("class", "warning-icon"); warn.setAttribute("x", String(pos.x + 40)); warn.setAttribute("y", String(pos.y - 10)); warn.setAttribute("font-size", "16"); warn.textContent = "\u26A0"; g.appendChild(warn); }
    g.addEventListener("click", () => { const panel = document.getElementById("node-metadata-panel"); const titleEl = document.getElementById("node-metadata-title"); const body = document.getElementById("node-metadata-body"); if (titleEl) titleEl.textContent = (n.type || "node") + ": " + (n.label || n.id); if (body) body.textContent = JSON.stringify(n.metadata || n, null, 2); if (panel) { panel.style.display = "block"; panel.dataset.nodeId = n.id; } });
    svg.appendChild(g);
  });
  container.appendChild(svg);
  const multiDevices = nodes.filter((n) => n.type === "device" && n.linkedAccounts && n.linkedAccounts.length > 1);
  if (multiDevices.length > 0) { const alert = document.createElement("div"); alert.className = "multi-account-alert"; alert.style.cssText = "margin-top:12px;padding:10px 14px;background:rgba(231,76,60,0.1);border:1px solid #e74c3c;border-radius:6px;color:#e74c3c;font-size:13px;"; alert.textContent = "\u26A0 This device is linked to multiple accounts (" + multiDevices[0].linkedAccounts.length + ")"; container.appendChild(alert); }
}

function showIdentitySuspendDialog() { const d = document.getElementById("identity-suspend-dialog"); if (d) { d.style.display = "flex"; updateCascadePreview(); } }
function hideIdentitySuspendDialog() { const d = document.getElementById("identity-suspend-dialog"); if (d) d.style.display = "none"; }
function updateCascadePreview() {
  const preview = document.querySelector("#identity-suspend-dialog .cascade-preview"); if (!preview) return;
  const container = document.getElementById("identity-graph-container"); const nodes = container ? container.querySelectorAll(".graph-node") : [];
  const counts = { account: 0, device: 0, network: 0 }; nodes.forEach((n) => { const type = n.getAttribute("data-type"); if (type && counts[type] !== undefined) counts[type]++; });
  preview.textContent = "This will also affect " + counts.account + " account(s), " + counts.device + " device(s), and " + counts.network + " network(s).";
}

export function wireIdentityListeners() {
  const suspendBtn = document.getElementById("identity-suspend-btn"); if (suspendBtn) suspendBtn.addEventListener("click", showIdentitySuspendDialog);
  const cancelBtn = document.querySelector("#identity-suspend-dialog .btn-cancel-suspend"); if (cancelBtn) cancelBtn.addEventListener("click", hideIdentitySuspendDialog);
  const confirmBtn = document.querySelector("#identity-suspend-dialog .btn-confirm-suspend");
  if (confirmBtn) confirmBtn.addEventListener("click", async () => { const uid = currentUid; if (!uid) { hideIdentitySuspendDialog(); return; } const duration = document.getElementById("identity-suspend-duration")?.value; const scope = document.getElementById("identity-suspend-scope")?.value; const reason = document.getElementById("identity-suspend-reason")?.value || "Admin suspend"; try { await apiCall("POST", `/api/admin/identity-graph/${uid}/suspend-all`, { duration, scope, reason }); showToast("Identity suspended"); hideIdentitySuspendDialog(); loadIdentitySubtabGraph(); } catch (err) { showToast("Suspend failed: " + err.message, "error"); } });
  const unsuspendAll = document.getElementById("identity-unsuspend-all-btn");
  if (unsuspendAll) unsuspendAll.addEventListener("click", async () => { const uid = currentUid; if (!uid) return; try { await apiCall("POST", `/api/admin/identity-graph/${uid}/unsuspend-all`, {}); showToast("Identity unsuspended"); loadIdentitySubtabGraph(); } catch (err) { showToast("Unsuspend failed: " + err.message, "error"); } });
  const nodeUnsuspend = document.getElementById("node-unsuspend-btn");
  if (nodeUnsuspend) nodeUnsuspend.addEventListener("click", async () => { const uid = currentUid; const panel = document.getElementById("node-metadata-panel"); const nodeId = panel && panel.dataset.nodeId; if (!uid || !nodeId) return; try { await apiCall("POST", `/api/admin/identity-graph/${uid}/node/${nodeId}/unsuspend`, {}); showToast("Node unsuspended"); const container = document.getElementById("identity-graph-container"); if (container) { const nodeEl = container.querySelector('.graph-node[data-id="' + nodeId + '"]'); if (nodeEl) { nodeEl.classList.remove("suspended"); const rect = nodeEl.querySelector("rect"); if (rect) { rect.setAttribute("stroke", "#333"); rect.setAttribute("stroke-width", "1"); } } } } catch (err) { showToast("Unsuspend failed: " + err.message, "error"); } });
  const durationSel = document.getElementById("identity-suspend-duration"); if (durationSel) durationSel.addEventListener("change", updateCascadePreview);
}

// Wire forward declarations
_register("loadIdentitySubtabGraph", loadIdentitySubtabGraph);
