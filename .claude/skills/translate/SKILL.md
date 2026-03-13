---
name: translate
description: Add a new user-facing string to all 19 locale XML resource files with translations
disable-model-invocation: true
---

# Add Translated String to All Locales

Add a new string resource to all 19 locale files in the ShyTalk project.

## Arguments

The user provides:
- **String key** — the XML resource name (e.g., `room_join_button`)
- **English value** — the default English text (e.g., "Join Room")

## Locale Files

All files are at `shared/src/commonMain/composeResources/values-{locale}/strings.xml`:

ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh

Plus the default English file at `shared/src/commonMain/composeResources/values/strings.xml`.

## Steps

1. **Read** the English `values/strings.xml` to find the correct insertion point (keep alphabetical order or group with related strings)
2. **Add** the English string: `<string name="{key}">{value}</string>` to `values/strings.xml`
3. **Translate** the English value to each of the 19 languages
4. **Add** the translated string to each `values-{locale}/strings.xml` file at the same relative position
5. **Verify** all 20 files (1 English + 19 locales) have the new string by grepping for the key

## Translation Quality

- Use natural, conversational translations appropriate for a social chat app
- Keep translations concise — mobile UI has limited space
- Preserve any format placeholders (e.g., `%1$s`, `%1$d`) exactly as-is
- Escape XML special characters: `&amp;` `&lt;` `&gt;` `&apos;` `&quot;`

## Verification

After adding all strings, run:
```bash
grep -r "name=\"{key}\"" shared/src/commonMain/composeResources/values*/strings.xml | wc -l
```
Expected result: 20 (1 default + 19 locales)
