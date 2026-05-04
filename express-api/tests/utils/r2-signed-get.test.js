/**
 * Tests for the R2 signed-GET URL helper. Used by the admin
 * age-verification image-url endpoint so the admin browser can preview
 * the submitted ID directly from R2 without streaming through Express.
 *
 * Mirrors `r2-signed-put.test.js` — same presigner mock, same shape.
 */

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const original = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...original,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
  };
});

const { getSignedGetUrl, bucketName } = require('../../src/utils/r2');

beforeEach(() => {
  mockGetSignedUrl.mockClear();
  mockGetSignedUrl.mockResolvedValue('https://r2-signed-get/abc?expires=5m');
});

describe('getSignedGetUrl', () => {
  test('returns the signed URL string from the presigner', async () => {
    const url = await getSignedGetUrl('age-verification/u1/abc.jpg');
    expect(url).toBe('https://r2-signed-get/abc?expires=5m');
  });

  test('passes bucket + key to GetObjectCommand', async () => {
    await getSignedGetUrl('age-verification/u1/abc.jpg');

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, command] = mockGetSignedUrl.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: bucketName,
      Key: 'age-verification/u1/abc.jpg',
    });
  });

  test('default expiry is 5 minutes', async () => {
    await getSignedGetUrl('age-verification/u1/abc.jpg');
    const [, , options] = mockGetSignedUrl.mock.calls[0];
    expect(options).toEqual({ expiresIn: 300 });
  });

  test('caller can override expiry but not exceed 1 hour (defense-in-depth)', async () => {
    await getSignedGetUrl('age-verification/u1/abc.jpg', 600);
    const [, , options] = mockGetSignedUrl.mock.calls[0];
    expect(options).toEqual({ expiresIn: 600 });
  });

  test('rejects expiry > 1 hour', async () => {
    await expect(getSignedGetUrl('age-verification/u1/abc.jpg', 7200)).rejects.toThrow(
      /expiresInSec/,
    );
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects expiry <= 0', async () => {
    await expect(getSignedGetUrl('age-verification/u1/abc.jpg', 0)).rejects.toThrow(/expiresInSec/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects empty key', async () => {
    await expect(getSignedGetUrl('')).rejects.toThrow(/key/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects non-string key', async () => {
    await expect(getSignedGetUrl(undefined)).rejects.toThrow(/key/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});
