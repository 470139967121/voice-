/* eslint-disable sonarjs/no-clear-text-protocols -- test URLs are intentionally HTTP */
const { configure, apiCall, resetAbortController } = require('../../../public/js/core/api');

// Mock global fetch
global.fetch = jest.fn();

const TEST_API_BASE = 'http://test:3000';

beforeEach(() => {
  jest.clearAllMocks();
  configure({ apiBase: TEST_API_BASE, getToken: () => Promise.resolve('test-token') });
});

function mockFetchOk(body = { success: true }, contentType = 'application/json') {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status, body = { error: 'Bad request' }, contentType = 'application/json') {
  global.fetch.mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => contentType },
    json: () => Promise.resolve(body),
  });
}

describe('apiCall', () => {
  test('1. sends correct method, URL, and Authorization header', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/users');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test:3000/api/users');
    expect(opts.method).toBe('GET');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });

  test('2. sends JSON Content-Type and stringified body when body is an object', async () => {
    mockFetchOk();
    await apiCall('POST', '/api/users', { name: 'Alice' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ name: 'Alice' }));
  });

  test('3. does NOT set Content-Type when body is FormData', async () => {
    mockFetchOk();
    const form = new FormData();
    form.append('key', 'value');
    await apiCall('POST', '/api/upload', form);
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBe(form);
  });

  test('4. returns parsed JSON on success (200)', async () => {
    mockFetchOk({ id: 1, name: 'Alice' });
    const result = await apiCall('GET', '/api/users/1');
    expect(result).toEqual({ id: 1, name: 'Alice' });
  });

  test('5. throws Error with error message from response on non-ok status', async () => {
    mockFetchError(400, { error: 'Invalid input' });
    await expect(apiCall('POST', '/api/users', { name: '' })).rejects.toThrow('Invalid input');
  });

  test('5b. throws HTTP status fallback when response has no error field', async () => {
    mockFetchError(500, {});
    await expect(apiCall('GET', '/api/broken')).rejects.toThrow('HTTP 500');
  });

  test('6. throws when response content-type is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: () => Promise.resolve({}),
    });
    await expect(apiCall('GET', '/api/html')).rejects.toThrow('server returned non-JSON response');
  });

  test('7. apiCall uses AbortController signal by default', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  test('8. apiCall skips AbortController when skipTabAbort is true', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/items', null, { skipTabAbort: true });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeUndefined();
  });

  test('9. apiCall uses custom signal when provided', async () => {
    mockFetchOk();
    const customController = new AbortController();
    await apiCall('GET', '/api/items', null, { signal: customController.signal });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBe(customController.signal);
  });

  test('10. resetAbortController creates a new controller (old signal is aborted)', async () => {
    // Capture the old signal by making a call first
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, optsBeforeReset] = global.fetch.mock.calls[0];
    const oldSignal = optsBeforeReset.signal;

    // Signal is not yet aborted
    expect(oldSignal.aborted).toBe(false);

    // Reset — this aborts the old controller and creates a new one
    resetAbortController();

    expect(oldSignal.aborted).toBe(true);

    // New call gets a new (non-aborted) signal
    jest.clearAllMocks();
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, optsAfterReset] = global.fetch.mock.calls[0];
    const newSignal = optsAfterReset.signal;

    expect(newSignal).not.toBe(oldSignal);
    expect(newSignal.aborted).toBe(false);
  });

  test('11. configure sets apiBase correctly (URL prefix)', async () => {
    configure({ apiBase: 'http://other-host:9000', getToken: () => Promise.resolve('tok') });
    mockFetchOk();
    await apiCall('GET', '/ping');
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('http://other-host:9000/ping');
  });

  test('12. configure sets getToken correctly (token appears in Authorization header)', async () => {
    configure({ apiBase: 'http://test:3000', getToken: () => Promise.resolve('my-custom-token') });
    mockFetchOk();
    await apiCall('GET', '/secure');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-custom-token');
  });
});
