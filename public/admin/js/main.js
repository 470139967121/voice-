/**
 * Admin panel entry point.
 *
 * Wires Firebase Auth, creates the admin state store, configures
 * core modules (api, tabs, ui), and handles the auth state flow
 * (admin claim check, access-denied inline error, dashboard show).
 *
 * Tab modules are pre-loaded via dynamic import (non-blocking).
 * Each tab exports init(deps), activate(), deactivate().
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
// Firestore SDK deferred — will be imported when inline code is removed (PR C).
// Importing it here causes duplicate Firestore init conflicts with the inline block.
// import { getFirestore, collection, query, orderBy, limit, where, onSnapshot, getDocs, doc }
//   from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

import { createStore } from '/js/core/state.js';
import { createAuthStateHandler } from '/js/core/auth.js';
import * as api from '/js/core/api.js';
import { showScreen, registerScreen } from '/js/core/ui.js';
import * as tabs from '/js/core/tabs.js';

// ── Tab modules (deferred via dynamic import to avoid blocking inline script) ──
// Static imports here create a dependency chain: inline script imports from main.js,
// so the browser must fetch+parse all 15 tab modules before the inline script can run.
// Dynamic imports let the admin panel become interactive immediately while modules
// load in the background. PR C will wire them into the tab system.

// ── Config ──────────────────────────────────────────────────────
const CONFIG = window.SHYTALK_CONFIG || {};
const FIREBASE_CONFIG = CONFIG.FIREBASE_CONFIG || {};
const API_BASE = CONFIG.API_BASE || '';

// ── Admin state store ───────────────────────────────────────────
export const store = createStore({
  currentUser: null,
  currentUid: null,
  currentFirebaseUid: null,
  currentTab: 'users',
});

// ── Firebase Auth ───────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

if (CONFIG.USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

// Re-export auth utilities for the inline script block during transition.
export { auth, signInWithEmailAndPassword, signOut };

// ── Configure core modules ──────────────────────────────────────
api.configure({
  apiBase: API_BASE,
  getToken: () => {
    const user = store.get('currentUser');
    return user ? user.getIdToken() : Promise.resolve(null);
  },
});

const PANEL_MAP = {
  users:              'user-form',
  appeals:            'appeals-panel',
  reports:            'reports-panel',
  gifts:              'gifts-panel',
  economy:            'economy-panel',
  maintenance:        'maintenance-panel',
  monitor:            'monitor-panel',
  banners:            'banners-panel',
  funfacts:           'funfacts-panel',
  backups:            'backups-panel',
  logs:               'logs-panel',
  devices:            'devices-panel',
  'starting-screens': 'starting-screens-panel',
  suggestions:        'suggestions-panel',
  'audit-log':        'audit-log-panel',
};

tabs.configure({ panelMap: PANEL_MAP });

// ── Screens ─────────────────────────────────────────────────────
// These are registered once the DOM is ready (this script runs as
// type="module" which is deferred, so DOM is available).
registerScreen('loading', document.getElementById('loading-screen'));
registerScreen('login', document.getElementById('login-screen'));
registerScreen('dashboard', document.getElementById('dashboard-screen'));

// ── Auth state handler ──────────────────────────────────────────
// NOTE: During PR A transition, the inline script block still has its
// own onAuthStateChanged handler that does the actual dashboard setup.
// This handler in main.js is NOT wired yet — it will be wired in PR B
// when the inline auth block is removed. For now, main.js just sets up
// the infrastructure; the inline block remains authoritative for auth flow.

// ── Tab Registry (prepared for PR C switchover) ───────────────────
// Tab modules load lazily via dynamic import() to avoid blocking the inline script.
// PR C will wire these into the tab system. For now they pre-load silently.
export const TAB_MODULES = {};

// Pre-load tab modules in the background after the critical path completes.
const _tabPaths = {
  users: '/admin/js/tabs/users.js',
  appeals: '/admin/js/tabs/appeals.js',
  reports: '/admin/js/tabs/reports.js',
  gifts: '/admin/js/tabs/gifts.js',
  economy: '/admin/js/tabs/economy-config.js',
  maintenance: '/admin/js/tabs/maintenance.js',
  monitor: '/admin/js/tabs/spin-monitor.js',
  banners: '/admin/js/tabs/banners.js',
  funfacts: '/admin/js/tabs/fun-facts.js',
  backups: '/admin/js/tabs/backups.js',
  logs: '/admin/js/tabs/logs.js',
  devices: '/admin/js/tabs/devices.js',
  'starting-screens': '/admin/js/tabs/starting-screens.js',
  suggestions: '/admin/js/tabs/suggestions.js',
  'audit-log': '/admin/js/tabs/audit-log.js',
};
for (const [key, path] of Object.entries(_tabPaths)) {
  import(path).then(m => { TAB_MODULES[key] = m; }).catch(() => {});
}

export const authHandler = createAuthStateHandler({
  requireClaim: 'admin',
  onAccessDenied: () => {
    const loginError = document.getElementById('login-error');
    if (loginError) {
      loginError.textContent = 'Access denied \u2014 admin privileges required. If you have a portal account, go to /portal/ instead.';
      loginError.style.display = 'block';
    }
    showScreen('login');
  },
  onReady: (user) => {
    if (user) {
      store.set('currentUser', user);
      showScreen('dashboard');
      const saved = sessionStorage.getItem('admin_tab') || 'users';
      tabs.show(saved);
    } else {
      store.set('currentUser', null);
      showScreen('login');
    }
  },
});
