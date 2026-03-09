const mockDocGet = jest.fn();
const mockQueryGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
    })),
  },
}));

const { getDoc, queryDocs } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getDoc', () => {
  test('returns { id, ...data } when document exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({ name: 'Test', value: 42 }),
    });

    const result = await getDoc('collection/doc-1');
    expect(result).toEqual({ id: 'doc-1', name: 'Test', value: 42 });
  });

  test('returns null when document does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const result = await getDoc('collection/nonexistent');
    expect(result).toBeNull();
  });
});

describe('queryDocs', () => {
  test('returns array of { id, ...data } from query results', async () => {
    const mockRef = {
      get: mockQueryGet,
    };
    mockQueryGet.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ name: 'Alice' }) },
        { id: 'b', data: () => ({ name: 'Bob' }) },
      ],
    });

    const results = await queryDocs(mockRef);
    expect(results).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });

  test('returns empty array when query has no results', async () => {
    const mockRef = {
      get: mockQueryGet,
    };
    mockQueryGet.mockResolvedValue({ docs: [] });

    const results = await queryDocs(mockRef);
    expect(results).toEqual([]);
  });
});
