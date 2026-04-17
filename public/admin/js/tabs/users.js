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
  if (!domain) return "****";
  const maskedLocal = local.length <= 2
    ? "*".repeat(local.length)
    : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return maskedLocal + "@" + domain;
}

export function isoToLocal(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

export function getFieldEl(name) {
  return document.getElementById(`field-${name}`);
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
