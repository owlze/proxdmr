# -*- coding: utf-8 -*-
"""
Automated unit tests for i18n locales, key parity, placeholders, and flag assets.
Ensures 100% synchronization across all supported languages.
"""
import os
import re
import json
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCALES_DIR = os.path.join(ROOT_DIR, "src", "static", "locales")
FLAGS_DIR = os.path.join(ROOT_DIR, "src", "static", "flags")
I18N_JS_PATH = os.path.join(ROOT_DIR, "src", "static", "js", "i18n.js")

EXPECTED_LANGUAGES = ["ru", "en", "es", "uk", "de", "fr", "it"]


class TestI18nLocales(unittest.TestCase):
    """Verifies that all localization dictionaries are consistent and complete."""

    def setUp(self):
        self.locales = {}
        for lang in EXPECTED_LANGUAGES:
            path = os.path.join(LOCALES_DIR, f"{lang}.json")
            self.assertTrue(os.path.exists(path), f"Locale file missing: {path}")
            with open(path, "r", encoding="utf-8") as f:
                self.locales[lang] = json.load(f)

    def test_json_validity_and_non_empty(self):
        """All locale files must parse properly and contain a substantial number of keys."""
        for lang, data in self.locales.items():
            self.assertIsInstance(data, dict)
            self.assertGreater(len(data), 500, f"Too few keys in {lang}.json: {len(data)}")

    def test_exact_key_parity_with_russian(self):
        """All languages must have identical keys to the Russian master file."""
        ru_keys = set(self.locales["ru"].keys())
        for lang, data in self.locales.items():
            if lang == "ru":
                continue
            cur_keys = set(data.keys())
            missing_in_lang = ru_keys - cur_keys
            extra_in_lang = cur_keys - ru_keys

            self.assertEqual(
                len(missing_in_lang), 0,
                f"Keys missing in {lang}.json compared to ru.json ({len(missing_in_lang)}): {sorted(missing_in_lang)[:10]}"
            )
            self.assertEqual(
                len(extra_in_lang), 0,
                f"Extra keys in {lang}.json not in ru.json ({len(extra_in_lang)}): {sorted(extra_in_lang)[:10]}"
            )
            self.assertEqual(
                len(cur_keys), len(ru_keys),
                f"Key count mismatch in {lang}.json: {len(cur_keys)} vs ru.json {len(ru_keys)}"
            )

    def test_no_empty_translation_strings(self):
        """No translation value may be an empty string or whitespace only."""
        for lang, data in self.locales.items():
            empty_keys = [k for k, v in data.items() if not str(v).strip()]
            self.assertEqual(
                len(empty_keys), 0,
                f"Empty translation strings found in {lang}.json: {empty_keys[:10]}"
            )

    def test_placeholder_consistency(self):
        """All curly-brace placeholders {param} must match between Russian and target language bidirectionally."""
        placeholder_re = re.compile(r"\{([a-zA-Z0-9_]+)\}")
        ru_data = self.locales["ru"]
        mismatches = []

        for lang, data in self.locales.items():
            if lang == "ru":
                continue
            for k in ru_data:
                ru_params = set(placeholder_re.findall(str(ru_data.get(k, ""))))
                lang_params = set(placeholder_re.findall(str(data.get(k, ""))))
                if ru_params != lang_params:
                    mismatches.append(f"[{lang}] {k}: RU params {ru_params} != {lang.upper()} params {lang_params}")

        self.assertEqual(
            len(mismatches), 0,
            f"Placeholder mismatches detected ({len(mismatches)}):\n" + "\n".join(mismatches[:15])
        )

    def test_flags_exist(self):
        """Each supported language must have an SVG flag file (by ISO country code)."""
        lang_to_country = {
            "ru": "ru",
            "en": "gb",
            "es": "es",
            "uk": "ua",
            "de": "de",
            "fr": "fr",
            "it": "it"
        }
        for lang in EXPECTED_LANGUAGES:
            cc = lang_to_country[lang]
            flag_path = os.path.join(FLAGS_DIR, f"{cc}.svg")
            self.assertTrue(
                os.path.exists(flag_path),
                f"Flag SVG file missing for language '{lang}' (country '{cc}'): {flag_path}"
            )

    def test_i18n_js_registration(self):
        """i18n.js must declare all expected languages in SUPPORTED_LANGUAGES."""
        with open(I18N_JS_PATH, "r", encoding="utf-8") as f:
            js_content = f.read()

        for lang in EXPECTED_LANGUAGES:
            pattern = rf'code:\s*["\']{lang}["\']'
            self.assertTrue(
                re.search(pattern, js_content),
                f"Language '{lang}' is not registered in SUPPORTED_LANGUAGES in i18n.js"
            )

    def test_vfo_tts_badge_template_and_mapping(self):
        """VFO TTS badge in index.html and transcriber.js must use speaker icon + 3-letter language code."""
        index_html_path = os.path.join(ROOT_DIR, "src", "templates", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            html_content = f.read()

        # Must not contain old globe icon in TTS badges
        self.assertNotIn("tts-icon-globe", html_content, "Obsolete 'tts-icon-globe' found in index.html")

        # Must contain tts-icon-spk and tts-lang-code
        self.assertIn("tts-icon-spk", html_content)
        self.assertIn("tts-lang-code", html_content)

        # In transcriber.js: LANG_3LETTER_MAP must exist and have RUS, POL, JPN, CHN, ENG, UKR, etc.
        transcriber_js_path = os.path.join(ROOT_DIR, "src", "static", "js", "modules", "dmr", "transcriber.js")
        with open(transcriber_js_path, "r", encoding="utf-8") as f:
            js_content = f.read()

        self.assertIn("LANG_3LETTER_MAP", js_content)
        self.assertIn('"ru": "RUS"', js_content)
        self.assertIn('"pl": "POL"', js_content)
        self.assertIn('"ja": "JPN"', js_content)
        self.assertIn('"zh": "CHN"', js_content)
        self.assertIn('"en": "ENG"', js_content)
        self.assertIn('"uk": "UKR"', js_content)
        self.assertIn('"none": "RAW"', js_content)


if __name__ == "__main__":
    unittest.main()
