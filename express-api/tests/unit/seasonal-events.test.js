const fs = require('fs');
const path = require('path');

describe('Seasonal Events Registry', () => {
  let events;

  beforeAll(() => {
    const raw = fs.readFileSync(
      path.resolve(__dirname, '../../../public/events/events.json'),
      'utf-8',
    );
    events = JSON.parse(raw);
  });

  test('events.json has valid structure', () => {
    expect(events).toHaveProperty('events');
    expect(Array.isArray(events.events)).toBe(true);
  });

  test('each event has required fields', () => {
    for (const event of events.events) {
      expect(event).toHaveProperty('slug');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDate');
      expect(event).toHaveProperty('endDate');
      expect(event).toHaveProperty('pageUrl');
      expect(event).toHaveProperty('theme');
      expect(typeof event.slug).toBe('string');
      expect(typeof event.name).toBe('string');
    }
  });

  test('dates are valid ISO format and endDate > startDate', () => {
    for (const event of events.events) {
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      expect(start.toString()).not.toBe('Invalid Date');
      expect(end.toString()).not.toBe('Invalid Date');
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });

  test('theme has required colour properties', () => {
    const requiredKeys = ['primary', 'primaryGlow', 'accent'];
    for (const event of events.events) {
      for (const key of requiredKeys) {
        expect(event.theme).toHaveProperty(key);
        expect(event.theme[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  test('Khmer New Year 2026 event exists', () => {
    const kny = events.events.find((e) => e.slug === 'khmer-new-year-2026');
    expect(kny).toBeDefined();
    expect(kny.name).toBe('Khmer New Year 2026');
    expect(kny.startDate).toBe('2026-04-13');
    expect(kny.endDate).toBe('2026-04-17');
    expect(kny.pageUrl).toBe('/events/khmer-new-year.html');
  });
});
