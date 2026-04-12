const {
  showToast,
  showConfirm,
  showScreen,
  registerScreen,
} = require('../../../public/js/core/ui');

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------
beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// DOM mock factory
// ---------------------------------------------------------------------------

/**
 * Create a fake element with just enough surface area for the tests.
 */
function makeFakeElement(tagOrId = '') {
  return {
    _tag: tagOrId,
    textContent: '',
    className: '',
    style: {},
    dataset: {},
    innerHTML: '',
    classList: {
      _classes: new Set(),
      add(c) {
        this._classes.add(c);
        // keep className in sync for assertions
      },
      remove(c) {
        this._classes.delete(c);
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    _children: [],
    _listeners: {},
    appendChild(child) {
      this._children.push(child);
      return child;
    },
    remove: jest.fn(),
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    },
    _emit(evt) {
      (this._listeners[evt] || []).forEach((fn) => fn());
    },
  };
}

// ---------------------------------------------------------------------------
// showToast
// ---------------------------------------------------------------------------

describe('showToast', () => {
  let mockToast;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    mockToast = makeFakeElement('toast');

    global.document = {
      getElementById: jest.fn((id) => (id === 'toast' ? mockToast : null)),
      createElement: jest.fn(() => makeFakeElement()),
      body: { appendChild: jest.fn() },
      querySelectorAll: jest.fn(() => []),
    };
  });

  test('1. sets toast textContent and className', () => {
    showToast('Hello world', 'success');
    expect(mockToast.textContent).toBe('Hello world');
    expect(mockToast.className).toBe('toast success visible');
  });

  test('2. with type "error" uses 7000ms timeout', () => {
    showToast('Oops', 'error');
    expect(mockToast.className).toBe('toast error visible');

    jest.advanceTimersByTime(6999);
    expect(mockToast.className).toBe('toast error visible');

    jest.advanceTimersByTime(1);
    expect(mockToast.className).toBe('toast error');
  });

  test('3. with default type uses 4000ms timeout', () => {
    showToast('Done');
    expect(mockToast.className).toBe('toast success visible');

    jest.advanceTimersByTime(3999);
    expect(mockToast.className).toBe('toast success visible');

    jest.advanceTimersByTime(1);
    expect(mockToast.className).toBe('toast success');
  });

  test('4. does nothing if #toast element does not exist', () => {
    global.document.getElementById = jest.fn(() => null);
    // Should not throw
    expect(() => showToast('msg')).not.toThrow();
    // fetch was not called — nothing happened
    expect(global.document.getElementById).toHaveBeenCalledWith('toast');
  });
});

// ---------------------------------------------------------------------------
// showConfirm
// ---------------------------------------------------------------------------

describe('showConfirm', () => {
  /**
   * Build the overlay tree that showConfirm creates via document.createElement
   * calls and return the named elements so tests can trigger events.
   *
   * showConfirm creates (in order):
   *   overlay, dialog, h3, p, buttons, cancelBtn, okBtn
   *
   * We track created elements in an array and wire up a querySelector mock
   * on the overlay to find .confirm-ok / .confirm-cancel if needed.
   */
  let createdElements;
  let overlay, _dialog, okBtn, cancelBtn;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    createdElements = [];

    global.document = {
      getElementById: jest.fn(() => null),
      createElement: jest.fn(() => {
        const el = makeFakeElement();
        createdElements.push(el);
        return el;
      }),
      body: { appendChild: jest.fn() },
      querySelectorAll: jest.fn(() => []),
    };
  });

  /**
   * Call showConfirm and capture the created elements.
   * showConfirm creates: overlay(0), dialog(1), h3(2), p(3), buttons(4),
   *                      cancelBtn(5), okBtn(6)
   */
  async function callShowConfirm() {
    const promise = showConfirm('Are you sure?', 'This cannot be undone.');
    // Give microtasks a tick to let the promise body run
    await Promise.resolve();
    overlay = createdElements[0];
    _dialog = createdElements[1];
    okBtn = createdElements[6];
    cancelBtn = createdElements[5];
    return promise;
  }

  test('5. creates overlay with .confirm-overlay class', async () => {
    const promise = callShowConfirm();
    await Promise.resolve();
    expect(createdElements[0].className).toBe('confirm-overlay');
    // resolve to avoid hanging
    okBtn._emit('click');
    await promise;
  });

  test('6. creates dialog with .confirm-ok and .confirm-cancel buttons', async () => {
    const promise = callShowConfirm();
    await Promise.resolve();
    // cancelBtn is index 5, okBtn is index 6
    expect(createdElements[5].className).toBe('confirm-cancel');
    expect(createdElements[6].className).toBe('confirm-ok');
    okBtn._emit('click');
    await promise;
  });

  test('7. resolves true when .confirm-ok is clicked', async () => {
    const promise = callShowConfirm();
    await Promise.resolve();
    okBtn._emit('click');
    const result = await promise;
    expect(result).toBe(true);
  });

  test('8. resolves false when .confirm-cancel is clicked', async () => {
    const promise = callShowConfirm();
    await Promise.resolve();
    cancelBtn._emit('click');
    const result = await promise;
    expect(result).toBe(false);
  });

  test('9. overlay.remove() is called on resolve', async () => {
    const promise = callShowConfirm();
    await Promise.resolve();
    okBtn._emit('click');
    await promise;
    expect(overlay.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// showScreen / registerScreen
// ---------------------------------------------------------------------------

describe('showScreen / registerScreen', () => {
  function makeScreenEl() {
    return makeFakeElement();
  }

  test('10. registerScreen + showScreen adds active class to named screen', () => {
    const el = makeScreenEl();
    registerScreen('login', el);
    showScreen('login');
    expect(el.classList._classes.has('active')).toBe(true);
  });

  test('11. showScreen removes active class from all other screens', () => {
    const loginEl = makeScreenEl();
    const dashEl = makeScreenEl();
    registerScreen('login2', loginEl);
    registerScreen('dash2', dashEl);

    // First activate login2
    showScreen('login2');
    expect(loginEl.classList._classes.has('active')).toBe(true);
    expect(dashEl.classList._classes.has('active')).toBe(false);

    // Switch to dash2
    showScreen('dash2');
    expect(dashEl.classList._classes.has('active')).toBe(true);
    expect(loginEl.classList._classes.has('active')).toBe(false);
  });
});
