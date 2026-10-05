import io
import os
import sys
import unittest
import wave

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
from callsign_phonetic import (
    format_callsign_phonetic,
    get_callsign_announcement,
    concatenate_wavs,
)


class TestCallsignPhonetic(unittest.TestCase):
    def test_russian_spelling_rx6awg(self):
        spelled = format_callsign_phonetic("RX6AWG", lang="ru")
        self.assertEqual(spelled, "Ромео Эксрэй Шесть Альфа Уиски Гольф")

    def test_russian_announcement(self):
        phrase = get_callsign_announcement("RX6AWG", lang="ru")
        self.assertEqual(phrase, "Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф.")

    def test_russian_slash_portable(self):
        phrase = get_callsign_announcement("RX6AWG/P", lang="ru")
        self.assertEqual(phrase, "Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф Дробь Папа.")

    def test_ukrainian_spelling(self):
        spelled = format_callsign_phonetic("RX6AWG", lang="uk")
        self.assertEqual(spelled, "Ромео Ексрей Шість Альфа Віскі Гольф")
        phrase = get_callsign_announcement("RX6AWG", lang="uk")
        self.assertEqual(phrase, "Говорить, Ромео Ексрей Шість Альфа Віскі Гольф.")

    def test_english_spelling(self):
        spelled = format_callsign_phonetic("RX6AWG", lang="en")
        self.assertEqual(spelled, "Romeo X-ray Six Alfa Whiskey Golf")
        phrase = get_callsign_announcement("RX6AWG", lang="en")
        self.assertEqual(phrase, "This is, Romeo X-ray Six Alfa Whiskey Golf.")

    def test_german_spelling(self):
        phrase = get_callsign_announcement("DL1ABC", lang="de")
        self.assertEqual(phrase, "Hier spricht, Delta Lima Eins Alfa Bravo Charlie.")

    def test_spanish_spelling(self):
        phrase = get_callsign_announcement("EA4XYZ", lang="es")
        self.assertEqual(phrase, "Aquí habla, Echo Alfa Cuatro X-ray Yankee Zulu.")

    def test_french_spelling(self):
        phrase = get_callsign_announcement("F6KOP", lang="fr")
        self.assertEqual(phrase, "Ici parle, Foxtrot Six Kilo Oscar Papa.")

    def test_japanese_spelling(self):
        phrase = get_callsign_announcement("JA1AYO", lang="ja")
        self.assertEqual(phrase, "こちらは, ジェー エー いち エー ワイ オー.")

    def test_empty_callsign(self):
        self.assertEqual(format_callsign_phonetic("", lang="ru"), "")
        self.assertEqual(get_callsign_announcement("", lang="ru"), "")
        self.assertEqual(get_callsign_announcement(None, lang="ru"), "")

    def test_concatenate_wavs(self):
        # Create two simple dummy WAV files
        def create_dummy_wav(duration_s=0.1, rate=16000):
            bio = io.BytesIO()
            with wave.open(bio, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(rate)
                wf.writeframes(b"\x00\x01" * int(rate * duration_s))
            return bio.getvalue()

        w1 = create_dummy_wav(0.05, 16000)
        w2 = create_dummy_wav(0.05, 16000)
        comb, rate = concatenate_wavs([w1, w2], pause_ms=50)
        self.assertIsNotNone(comb)
        self.assertEqual(rate, 16000)
        self.assertGreater(len(comb), len(w1))

    def test_synthesize_speech_announce_callsign_piper(self):
        import asyncio
        from unittest.mock import patch, MagicMock
        from transcriber import GeminiTranscriberService

        def create_dummy_wav(duration_s=0.1, rate=16000):
            bio = io.BytesIO()
            with wave.open(bio, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(rate)
                wf.writeframes(b"\x00\x01" * int(rate * duration_s))
            return bio.getvalue()

        dummy_call_wav = create_dummy_wav(0.05, 16000)
        dummy_speech_wav = create_dummy_wav(0.05, 16000)

        srv = GeminiTranscriberService()
        mock_piper = MagicMock()
        mock_piper.is_voice_ready_for_lang.return_value = (True, "ru_RU-igm3804-medium", "installed")

        calls = []
        async def fake_synthesize(text, voice_id, speed, **kwargs):
            calls.append({"text": text, "speed": speed})
            if "Говорит" in text:
                return dummy_call_wav, 16000, None
            return dummy_speech_wav, 16000, None

        mock_piper.synthesize_async.side_effect = fake_synthesize

        with patch("piper_service.PiperService.get_instance", return_value=mock_piper):
            res_wav, err = asyncio.run(srv.synthesize_speech(
                text="Всем 73",
                engine="piper",
                callsign="RX6AWG",
                announce_callsign=True,
                target_lang="ru",
                speed=1.0
            ))

        self.assertIsNone(err)
        self.assertIsNotNone(res_wav)
        # Should have called synthesize twice: first for callsign at speed 0.9, then for text at speed 1.0
        self.assertEqual(len(calls), 2)
        self.assertIn("Ро́мио Э́кс-рэй Шесть А́льфа Уи́ски Гольф", calls[0]["text"])
        self.assertIn("Семьдесят", calls[1]["text"])
        self.assertEqual(calls[0]["speed"], 0.9)
        self.assertEqual(calls[1]["speed"], 1.0)
        # Result WAV should be combined (longer than individual wavs)
        self.assertGreater(len(res_wav), len(dummy_call_wav))

    def test_synthesize_speech_announce_callsign_gemini(self):
        import asyncio
        import base64
        from unittest.mock import patch
        from transcriber import GeminiTranscriberService

        srv = GeminiTranscriberService()
        dummy_wav = b"RIFF____WAVEfmt "
        dummy_b64 = base64.b64encode(dummy_wav).decode()

        payloads = []
        def fake_http_post(url, payload, **kwargs):
            payloads.append(payload)
            resp = {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "inlineData": {
                                "mimeType": "audio/wav",
                                "data": dummy_b64
                            }
                        }]
                    }
                }]
            }
            return resp, None

        with patch.object(srv, "_http_post_json", side_effect=fake_http_post):
            res_wav, err = asyncio.run(srv.synthesize_speech(
                text="Всем привет",
                engine="gemini",
                api_key="fake-test-key",
                callsign="RX6AWG",
                announce_callsign=True,
                target_lang="ru",
                speed=1.0
            ))

        self.assertIsNone(err)
        self.assertIsNotNone(res_wav)
        self.assertEqual(len(payloads), 1)
        sent_text = payloads[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф.", sent_text)
        self.assertIn("Всем привет", sent_text)

    def test_gemini_announcement_no_pauses(self):
        phrase_ru = get_callsign_announcement("RX6AWG", lang="ru", engine="gemini")
        self.assertEqual(phrase_ru, "Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф.")

        phrase_ru_slash = get_callsign_announcement("RX6AWG/P", lang="ru", engine="gemini")
        self.assertEqual(phrase_ru_slash, "Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф Дробь Папа.")

        phrase_en = get_callsign_announcement("RX6AWG", lang="en", engine="gemini")
        self.assertEqual(phrase_en, "This is, Romeo X-ray Six Alfa Whiskey Golf.")

        # Piper now uses standard spaces (no em-dash pauses) with Piper-specific phonetic pronunciation
        phrase_piper = get_callsign_announcement("RX6AWG", lang="ru", engine="piper")
        self.assertEqual(phrase_piper, "Говорит, Ро́мио Э́кс-рэй Шесть А́льфа Уи́ски Гольф.")

    def test_piper_all_letters_custom_phonetic(self):
        expected_piper = [
            "А́льфа", "Бра́во", "Ча́рли", "Дэ́льта", "Э́ко", "Фо́кстрот",
            "Гольф", "Хо́тэл", "И́ндиа", "Джулиэ́т", "Ки́ло", "Ли́ма",
            "Майк", "Новэ́мбэр", "О́скар", "Папа́", "Квэбэ́к", "Ро́мио",
            "Сиэ́ра", "Тэ́нго", "Ю́ниформ", "Ви́ктор", "Уи́ски", "Э́кс-рэй",
            "Я́нки", "Зу́лу"
        ]
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        spelled_piper = format_callsign_phonetic(alphabet, lang="ru", engine="piper", separator=" ")
        self.assertEqual(spelled_piper, " ".join(expected_piper))

        # Check that Gemini does not use Piper-specific phonetics
        spelled_gemini = format_callsign_phonetic(alphabet, lang="ru", engine="gemini", separator=" ")
        self.assertNotIn("Ро́мио", spelled_gemini)
        self.assertIn("Ромео", spelled_gemini)

    def test_short_replica_skips_callsign_announcement(self):
        """Verifies that utterances with <= 20 chars skip the 'Говорит CALL' announcement."""
        from tts_normalizer import strip_callsigns_for_tts

        short_texts = [
            "Всем 73!",
            "Принято, 59.",
            "Привет всем!",
            "12345678901234567890", # exactly 20 chars
        ]
        for t in short_texts:
            clean = strip_callsigns_for_tts(t, callsign="RX6AWG")
            self.assertLessEqual(len(clean.strip()), 20)

        long_texts = [
            "Всем добрый вечер, на приеме RX6AWG!",
            "123456789012345678901", # 21 chars
            "Спасибо за приятную беседу и до встречи в эфире!"
        ]
        for t in long_texts:
            clean = strip_callsigns_for_tts(t, callsign="RX6AWG")
            self.assertGreater(len(clean.strip()), 20)


if __name__ == "__main__":
    unittest.main()
