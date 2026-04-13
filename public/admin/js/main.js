/**
 * Admin panel entry point.
 *
 * Wires Firebase Auth, creates the admin state store, configures
 * core modules (api, tabs, ui), and handles the auth state flow
 * (admin claim check, access-denied inline error, dashboard show).
 *
 * All 15 tab modules are imported and initialized here.
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

// ── Tab modules (loaded but not initialized — inline script still authoritative) ──
// users.js excluded from PR B — auto-extraction produced broken module.
// Will be properly hand-written in PR C.
// import * as tabUsers from '/admin/js/tabs/users.js';
import * as tabAppeals from '/admin/js/tabs/appeals.js';
import * as tabReports from '/admin/js/tabs/reports.js';
import * as tabGifts from '/admin/js/tabs/gifts.js';
import * as tabEconomyConfig from '/admin/js/tabs/economy-config.js';
import * as tabMaintenance from '/admin/js/tabs/maintenance.js';
import * as tabSpinMonitor from '/admin/js/tabs/spin-monitor.js';
import * as tabBanners from '/admin/js/tabs/banners.js';
import * as tabFunFacts from '/admin/js/tabs/fun-facts.js';
import * as tabBackups from '/admin/js/tabs/backups.js';
import * as tabLogs from '/admin/js/tabs/logs.js';
import * as tabDevices from '/admin/js/tabs/devices.js';
import * as tabStartingScreens from '/admin/js/tabs/starting-screens.js';
import * as tabSuggestions from '/admin/js/tabs/suggestions.js';
import * as tabAuditLog from '/admin/js/tabs/audit-log.js';

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
// Tab modules are imported above but NOT initialized yet.
// The inline script block still handles all tab logic.
// PR C will call initAllTabs() and remove the inline code.
//
// Tab module references are available for import by other modules:
// TAB_MODULES will be populated in PR C when imports are enabled.
export const TAB_MODULES = {};

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
