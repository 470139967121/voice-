-- Fun facts table for language/culture splash screen
CREATE TABLE IF NOT EXISTS fun_facts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'trivia',
  emoji TEXT NOT NULL DEFAULT '',
  source_language TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed initial fun facts
INSERT INTO fun_facts (id, text, category, emoji, source_language) VALUES
  (lower(hex(randomblob(16))), 'Japanese has three writing systems: hiragana, katakana, and kanji — each serving a different purpose.', 'language', '🇯🇵', 'Japanese'),
  (lower(hex(randomblob(16))), 'Mandarin Chinese is the most spoken native language in the world, with over 900 million speakers.', 'language', '🇨🇳', 'Mandarin'),
  (lower(hex(randomblob(16))), 'In Thailand, the traditional greeting "wai" involves pressing palms together and bowing — the higher the hands, the more respect shown.', 'greeting', '🇹🇭', 'Thai'),
  (lower(hex(randomblob(16))), 'The Basque language (Euskara) is a language isolate — it has no known relatives among any other language family.', 'language', '🏔️', 'Basque'),
  (lower(hex(randomblob(16))), 'In many African cultures, clicking sounds are used as consonants. Xhosa has 18 distinct click sounds!', 'language', '🇿🇦', 'Xhosa'),
  (lower(hex(randomblob(16))), 'The Hawaiian language has only 13 letters: 5 vowels and 8 consonants.', 'language', '🌺', 'Hawaiian'),
  (lower(hex(randomblob(16))), 'Koreans celebrate a baby''s 100th day of life (Baek-il) with a special feast to celebrate survival and good health.', 'culture', '🇰🇷', 'Korean'),
  (lower(hex(randomblob(16))), '"Namaste" means "I bow to the divine in you" and originated from Sanskrit over 3,000 years ago.', 'greeting', '🙏', 'Hindi'),
  (lower(hex(randomblob(16))), 'There are about 7,000 languages spoken worldwide — but nearly half are expected to disappear by the end of this century.', 'trivia', '🌍', 'Global'),
  (lower(hex(randomblob(16))), 'Arabic is written right-to-left and has 28 letters, each with up to 4 different forms depending on position.', 'language', '🇸🇦', 'Arabic'),
  (lower(hex(randomblob(16))), 'In Japan, slurping noodles loudly is considered polite — it shows appreciation for the meal.', 'culture', '🍜', 'Japanese'),
  (lower(hex(randomblob(16))), 'Finnish has no grammatical gender and no articles — there is no "he" or "she," just "hän" for everyone.', 'language', '🇫🇮', 'Finnish'),
  (lower(hex(randomblob(16))), 'The Maori greeting "hongi" involves pressing noses together, symbolizing the sharing of breath and life force.', 'greeting', '🇳🇿', 'Maori'),
  (lower(hex(randomblob(16))), 'Icelandic has changed so little over centuries that modern speakers can read 800-year-old Viking sagas.', 'language', '🇮🇸', 'Icelandic'),
  (lower(hex(randomblob(16))), 'In Ethiopia, the calendar has 13 months — 12 months of 30 days and a 13th month of 5 or 6 days.', 'culture', '🇪🇹', 'Amharic'),
  (lower(hex(randomblob(16))), 'Sign languages are full natural languages with their own grammar — ASL is more related to French Sign Language than British.', 'language', '🤟', 'ASL'),
  (lower(hex(randomblob(16))), 'The longest word in any language is in Sanskrit: a 195-character compound word describing a region of Tamil Nadu.', 'trivia', '📜', 'Sanskrit'),
  (lower(hex(randomblob(16))), 'In Turkish culture, offering tea (çay) to guests is a sacred tradition — refusing it can be seen as impolite.', 'culture', '🇹🇷', 'Turkish'),
  (lower(hex(randomblob(16))), 'Welsh places its verbs at the start of sentences. "I see the cat" becomes "See I the cat" (Gwelaf i''r gath).', 'language', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'Welsh'),
  (lower(hex(randomblob(16))), 'The phrase "long time no see" is believed to be a direct translation from Mandarin Chinese (好久不见).', 'trivia', '👋', 'Mandarin');
