jest.mock('../../../public/js/core/api', () => ({
  resetAbortController: jest.fn(),
}));

// Top-level require omitted — each describe uses jest.isolateModules for
// fresh module state. The api mock is still registered above (jest.mock).

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _makeFakePanel(id) {
  return {
    id,
    style: {},
    _classes: new Set(),
    classList: {
      add(c) {
        this._classes.add(c);
      },
      remove(c) {
        this._classes.delete(c);
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    dataset: {},
    offsetHeight: 0,
  };
}

function makeFakeButton(tabId) {
  const btn = {
    dataset: { tab: tabId },
    _classes: new Set(),
    offsetHeight: 0,
  };
  btn.classList = {
    add(c) {
      btn._classes.add(c);
    },
    remove(c) {
      btn._classes.delete(c);
    },
    contains(c) {
      return btn._classes.has(c);
    },
  };
  return btn;
}

// ---------------------------------------------------------------------------
// Per-test state reset
// ---------------------------------------------------------------------------

// tabs.js holds module-level state (_panelMap, _modules, _initialised, _activeTab).
// We can't easily reset it between tests without re-requiring the module.
// Instead we use jest.isolateModules() per test group, OR we accept that state
// accumulates and design tests to be independent by using unique tab IDs.
//
// For simplicity, all tests run against a fresh isolateModules() context.

function buildTabsContext() {
  let tabs;
  let api;
  jest.isolateModules(() => {
    jest.mock('../../../public/js/core/api', () => ({
      resetAbortController: jest.fn(),
    }));
    api = require('../../../public/js/core/api');
    tabs = require('../../../public/js/core/tabs');
  });
  return { tabs, api };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('configure', () => {
  test('1. configure stores the panel map', async () => {
    const { tabs } = buildTabsContext();
    const panels = { reports: 'reports-panel', gifts: 'gifts-panel' };

    // Set up a minimal DOM so show() doesn't blow up when it looks up panels
    global.document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => ({ forEach: jest.fn() })),
    };
    global.sessionStorage = { setItem: jest.fn(), getItem: jest.fn() };

    tabs.configure({ panelMap: panels });

    // Verify that showing a tab mapped in panelMap looks up the correct panel ID
    const mod = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.register('reports', mod);
    await tabs.show('reports');

    // getElementById should have been called with 'reports-panel'
    const calls = global.document.getElementById.mock.calls.map((c) => c[0]);
    expect(calls).toContain('reports-panel');
  });
});

describe('register', () => {
  test('2. register stores a tab module', async () => {
    const { tabs } = buildTabsContext();

    global.document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => ({ forEach: jest.fn() })),
    };
    global.sessionStorage = { setItem: jest.fn(), getItem: jest.fn() };

    const mod = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.configure({ panelMap: {} });
    tabs.register('myTab', mod);
    await tabs.show('myTab');

    // If the module was stored, activate should have been called
    expect(mod.activate).toHaveBeenCalled();
  });
});

describe('show', () => {
  function setupDom(tabBtns = []) {
    global.document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => ({ forEach: (fn) => tabBtns.forEach(fn) })),
    };
    global.sessionStorage = { setItem: jest.fn(), getItem: jest.fn() };
  }

  test('3. show calls resetAbortController', async () => {
    const { tabs, api } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    await tabs.show('overview');
    expect(api.resetAbortController).toHaveBeenCalled();
  });

  test('4. show calls init on first activation', async () => {
    const { tabs } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    const mod = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.register('settings', mod);
    await tabs.show('settings');
    expect(mod.init).toHaveBeenCalledTimes(1);
  });

  test('5. show calls activate on every activation', async () => {
    const { tabs } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    const mod = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    const other = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.register('tabA', mod);
    tabs.register('tabB', other);

    await tabs.show('tabA');
    // Switch away and back
    await tabs.show('tabB');
    await tabs.show('tabA');

    expect(mod.activate).toHaveBeenCalledTimes(2);
  });

  test('6. show calls deactivate on the previous tab', async () => {
    const { tabs } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    const modA = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    const modB = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.register('alpha', modA);
    tabs.register('beta', modB);

    await tabs.show('alpha');
    expect(modA.deactivate).not.toHaveBeenCalled();

    await tabs.show('beta');
    expect(modA.deactivate).toHaveBeenCalledTimes(1);
  });

  test('7. show does not call init on subsequent activations (init is idempotent)', async () => {
    const { tabs } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    const mod = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    const other = { init: jest.fn(), activate: jest.fn(), deactivate: jest.fn() };
    tabs.register('main', mod);
    tabs.register('side', other);

    await tabs.show('main');
    await tabs.show('side');
    await tabs.show('main');

    // init should only have been called once
    expect(mod.init).toHaveBeenCalledTimes(1);
  });

  test('8. show toggles active class on tab buttons', async () => {
    const { tabs } = buildTabsContext();
    const btnA = makeFakeButton('tabX');
    const btnB = makeFakeButton('tabY');

    global.document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => ({ forEach: (fn) => [btnA, btnB].forEach(fn) })),
    };
    global.sessionStorage = { setItem: jest.fn(), getItem: jest.fn() };

    tabs.configure({ panelMap: {} });
    await tabs.show('tabX');

    expect(btnA._classes.has('active')).toBe(true);
    expect(btnB._classes.has('active')).toBe(false);
  });

  test('9. show saves tab to sessionStorage', async () => {
    const { tabs } = buildTabsContext();
    setupDom();
    tabs.configure({ panelMap: {} });
    await tabs.show('reportTab');
    expect(global.sessionStorage.setItem).toHaveBeenCalledWith('activeTab', 'reportTab');
  });
});

describe('getActiveTab', () => {
  test('10. getActiveTab returns the current tab', async () => {
    const { tabs } = buildTabsContext();
    global.document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => ({ forEach: jest.fn() })),
    };
    global.sessionStorage = { setItem: jest.fn(), getItem: jest.fn() };

    tabs.configure({ panelMap: {} });
    expect(tabs.getActiveTab()).toBeNull();

    await tabs.show('dashboard');
    expect(tabs.getActiveTab()).toBe('dashboard');
  });
});
