import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
from piper_service import PiperService


class TestPiperService(unittest.TestCase):
    def setUp(self):
        self.service = PiperService.get_instance()

    def test_catalog_loaded(self):
        cat = self.service.load_catalog()
        self.assertEqual(len(cat), 26, "Catalog should have 26 curated top voices")
        self.assertIn("ru_RU-sushkov_v4-medium", cat)
        self.assertIn("ru_RU-terra5871-medium", cat)
        self.assertIn("ru_RU-igm3804-medium", cat)
        self.assertNotIn("ru_RU-dmitri-medium", cat)
        self.assertIn("en_US-bryce-medium", cat)

    def test_list_installed_voices(self):
        installed = self.service.list_installed_voices()
        installed_ids = {v["id"] for v in installed}
        # Pre-installed top Russian voices: Terra and IGM
        self.assertIn("ru_RU-terra5871-medium", installed_ids)
        self.assertIn("ru_RU-igm3804-medium", installed_ids)
        self.assertNotIn("ru_RU-sushkov_v4-medium", installed_ids)
        self.assertEqual(len(installed_ids), 2)

    def test_language_support_check(self):
        self.assertTrue(self.service.is_lang_supported("ru"))
        self.assertTrue(self.service.is_lang_supported("en"))
        self.assertTrue(self.service.is_lang_supported("uk"))
        self.assertTrue(self.service.is_lang_supported("de"))
        self.assertFalse(self.service.is_lang_supported("xyz123_nonexistent"))

    def test_has_installed_voice(self):
        self.assertTrue(self.service.has_installed_voice_for_lang("ru"))
        self.assertFalse(self.service.has_installed_voice_for_lang("en"))

    def test_get_voices_for_lang(self):
        ru_voices = self.service.get_voices_for_lang("ru")
        self.assertEqual(len(ru_voices), 3)
        installed_ru = [v for v in ru_voices if v["installed"]]
        self.assertEqual(len(installed_ru), 2)

    def test_get_voice_lang(self):
        self.assertEqual(self.service.get_voice_lang("ru_RU-sushkov_v4-medium"), "ru")
        self.assertEqual(self.service.get_voice_lang("ru_RU-terra5871-medium"), "ru")
        self.assertEqual(self.service.get_voice_lang("ru_RU-igm3804-medium"), "ru")
        self.assertEqual(self.service.get_voice_lang("en_GB-alan-medium"), "en")
        self.assertEqual(self.service.get_voice_lang("de_DE-thorsten-medium"), "de")
        self.assertEqual(self.service.get_voice_lang("uk_UA-mykyta-high"), "uk")
        self.assertEqual(self.service.get_voice_lang(""), "")
        self.assertEqual(self.service.get_voice_lang(None), "")

    def test_get_installed_voice_for_lang(self):
        ru_v = self.service.get_installed_voice_for_lang("ru")
        self.assertIsNotNone(ru_v)
        self.assertEqual(ru_v, "ru_RU-igm3804-medium")

        # English is available for on-demand download, but not pre-installed
        en_v = self.service.get_installed_voice_for_lang("en")
        self.assertIsNone(en_v)

        es_v = self.service.get_installed_voice_for_lang("es")
        self.assertIsNone(es_v)

    def test_is_voice_ready_for_lang(self):
        # Russian installed voice with matching voice_id
        ready, vid, reason = self.service.is_voice_ready_for_lang("ru", "ru_RU-igm3804-medium")
        self.assertTrue(ready)
        self.assertEqual(vid, "ru_RU-igm3804-medium")
        self.assertEqual(reason, "ready")

        # English requested, but voice_id is Russian (mismatch!) -> must auto-resolve to default English voice
        ready_en, vid_en, reason_en = self.service.is_voice_ready_for_lang("en", "ru_RU-igm3804-medium")
        self.assertFalse(ready_en)
        self.assertTrue(vid_en.startswith("en_"), f"Resolved voice '{vid_en}' must be English, not Russian!")
        self.assertEqual(reason_en, "not_installed")

        # Spanish not installed
        ready_es, vid_es, reason_es = self.service.is_voice_ready_for_lang("es")
        self.assertFalse(ready_es)
        self.assertEqual(reason_es, "not_installed")

    def test_synthesize_rejects_empty_voice(self):
        wav, rate, err = self.service.synthesize("Hello", voice_id="")
        self.assertIsNone(wav)
        self.assertIn("не указан", err)

    def test_synthesize_foreign_text_filtering(self):
        from unittest.mock import MagicMock, patch

        # 1. Entirely foreign long sentence is filtered out cleanly
        long_foreign = "This is an entirely English sentence with more than sixteen characters."
        wav, rate, err = self.service.synthesize(long_foreign, voice_id="ru_RU-igm3804-medium")
        self.assertIsNone(wav)
        self.assertIn("отфильтрован как чужеродный язык", err)

        # 2. Short foreign fragment is transliterated before calling voice.synthesize_wav
        def fake_synth(text, wav_file, syn_config=None):
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(b"")

        mock_voice = MagicMock()
        mock_voice.config.sample_rate = 22050
        mock_voice.synthesize_wav.side_effect = fake_synth
        mock_piper = MagicMock()
        with patch.dict("sys.modules", {"piper": mock_piper, "piper.config": mock_piper.config}):
            with patch.object(self.service, "_get_or_load_voice", return_value=mock_voice):
                wav_bytes, s_rate, err = self.service.synthesize("FT-891", voice_id="ru_RU-igm3804-medium")
                self.assertIsNone(err)
                self.assertTrue(mock_voice.synthesize_wav.called)
                called_text = mock_voice.synthesize_wav.call_args[0][0]
                self.assertEqual(called_text, "ФТ-891")


if __name__ == "__main__":
    unittest.main()

