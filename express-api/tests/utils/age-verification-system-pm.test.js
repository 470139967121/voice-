/**
 * Tests for the age-verification system-PM templates (PR 5/14).
 *
 * Wraps `sendSystemPm` with the three approved/rejected/dob-modified
 * shapes. Tests pin (a) the template content (so a copy change has to
 * touch the test, surfacing reviewer attention) and (b) that the
 * helper actually delegates to `sendSystemPm` with the right uid +
 * text so admin-route integration is end-to-end.
 *
 * i18n: this PR ships English-only. PR 13 of the multi-PR plan adds
 * 20 locales.
 */

const mockSendSystemPm = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: (...args) => mockSendSystemPm(...args),
}));

const {
  sendAgeVerificationApprovedPm,
  sendAgeVerificationRejectedPm,
  sendAgeVerificationDobModifiedPm,
} = require('../../src/utils/age-verification-system-pm');

beforeEach(() => {
  mockSendSystemPm.mockClear();
});

describe('sendAgeVerificationApprovedPm', () => {
  test('sends a positive confirmation with method', async () => {
    await sendAgeVerificationApprovedPm('u1', 'passport');
    expect(mockSendSystemPm).toHaveBeenCalledTimes(1);
    const [recipient, text] = mockSendSystemPm.mock.calls[0];
    expect(recipient).toBe('u1');
    expect(text).toMatch(/approved/i);
    // Method name appears so the user knows which ID type unlocked
    // their account; helps if they have multiple submissions over
    // time.
    expect(text).toMatch(/passport/i);
  });

  test('substitutes the friendly method label, not the raw id-method key', async () => {
    // Internal id-method keys are `passport` / `drivers-license` /
    // `national-id`. The user-facing PM should read like English,
    // not like the API enum.
    await sendAgeVerificationApprovedPm('u1', 'drivers-license');
    const [, text] = mockSendSystemPm.mock.calls[0];
    expect(text).toMatch(/driver's licen[cs]e/i);
    expect(text).not.toMatch(/drivers-license/);
  });

  test("throws on unknown method (defence vs caller bypassing the audit helper's enum)", async () => {
    await expect(sendAgeVerificationApprovedPm('u1', 'birth-certificate')).rejects.toThrow(
      /method/i,
    );
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});

describe('sendAgeVerificationRejectedPm', () => {
  test('sends rejection with admin-supplied reason', async () => {
    await sendAgeVerificationRejectedPm('u1', 'Image was unreadable');
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'u1',
      expect.stringMatching(/(rejected|wasn't approved)/i),
    );
    const [, text] = mockSendSystemPm.mock.calls[0];
    expect(text).toContain('Image was unreadable');
    // Re-submission encouragement so the user knows they CAN retry
    expect(text).toMatch(/(submit|try again|resubmit)/i);
  });

  test('refuses blank reason (admin policy enforced upstream + here)', async () => {
    await expect(sendAgeVerificationRejectedPm('u1', '')).rejects.toThrow();
    await expect(sendAgeVerificationRejectedPm('u1', '   ')).rejects.toThrow();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});

describe('sendAgeVerificationDobModifiedPm', () => {
  test('approved-after-modify variant when ageVerified=true', async () => {
    await sendAgeVerificationDobModifiedPm('u1', {
      ageVerified: true,
      method: 'passport',
      reason: 'ID showed different DOB than profile',
    });
    expect(mockSendSystemPm).toHaveBeenCalledTimes(1);
    const [, text] = mockSendSystemPm.mock.calls[0];
    expect(text).toMatch(/(updated|adjusted) your date of birth/i);
    expect(text).toMatch(/approved/i);
    expect(text).toContain('ID showed different DOB than profile');
  });

  test('reverted-to-under-18 variant when ageVerified=false', async () => {
    // The harshest flow — admin found user under-18 via ID. Existing
    // PMs lock out (PR 11). Copy must explain WHY they lost access.
    await sendAgeVerificationDobModifiedPm('u1', {
      ageVerified: false,
      method: 'passport',
      reason: "ID confirmed you're under 18",
    });
    const [, text] = mockSendSystemPm.mock.calls[0];
    // Both pieces of context surface
    expect(text).toMatch(/(under 18|under eighteen|too young)/i);
    expect(text).toMatch(/messages|gacha|features/i);
    expect(text).toContain("ID confirmed you're under 18");
  });

  test('refuses blank reason', async () => {
    await expect(
      sendAgeVerificationDobModifiedPm('u1', {
        ageVerified: true,
        method: 'passport',
        reason: '',
      }),
    ).rejects.toThrow();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});
