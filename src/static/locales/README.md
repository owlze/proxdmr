# ProxDMR Localization (i18n)

This directory contains the user interface translation dictionaries for ProxDMR in JSON format.

## How to add a new language (e.g., German - Deutsch):

1. Copy the `en.json` file and name it using your language code, e.g. `de.json`.
2. Open `de.json` and translate the values to the right of the colons (do not modify the translation keys on the left!).
3. Open `src/static/js/i18n.js` and add your language to the `SUPPORTED_LANGUAGES` array:
   ```javascript
   { code: "de", name: "Deutsch", flag: "🇩🇪" }
   ```
4. Done! The new language will automatically appear in the station settings dropdown (General section).
