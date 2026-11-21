# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
from transcriber import GeminiTranscriberService, TTS_STYLE_CONFIG


class TestTtsStyle(unittest.IsolatedAsyncioTestCase):
    def test_style_config_options(self):
        for expected_style in ["radio", "monotone", "clear", "natural"]:
            self.assertIn(expected_style, TTS_STYLE_CONFIG)
            cfg = TTS_STYLE_CONFIG[expected_style]
            self.assertIn("prefix", cfg)
            self.assertIn("temperature", cfg)
            self.assertIsInstance(cfg["temperature"], (float, int))

        self.assertEqual(TTS_STYLE_CONFIG["natural"]["prefix"], "")
        self.assertGreater(TTS_STYLE_CONFIG["natural"]["temperature"], 0.5)
        self.assertLessEqual(TTS_STYLE_CONFIG["radio"]["temperature"], 0.2)
        self.assertEqual(TTS_STYLE_CONFIG["monotone"]["temperature"], 0.0)

    def test_transcriber_configure_style(self):
        srv = GeminiTranscriberService()
        self.assertEqual(srv.tts_style, "radio")

        srv.configure(
            enabled=False,
            api_key="",
            model="gemini-3.5-flash",
            target_lang="ru",
            tts_style="clear"
        )
        self.assertEqual(srv.tts_style, "clear")

        srv.configure(
            enabled=False,
            api_key="",
            model="gemini-3.5-flash",
            target_lang="ru",
            tts_style="Monotone "
        )
        self.assertEqual(srv.tts_style, "monotone")

    async def test_synthesize_speech_gemini_style_payload(self):
        srv = GeminiTranscriberService()
        srv.tts_engine = "gemini"
        srv.tts_style = "radio"

        captured_payloads = []

        def mock_post(url_or_endpoint, payload):
            captured_payloads.append(payload)
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "data": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
                                    }
                                }
                            ]
                        }
                    }
                ]
            }, None

        srv._http_post_json = mock_post
        srv._http_post_json_with_retry = mock_post

        # Test with default service style 'radio'
        await srv.synthesize_speech("Всем в канале 73", api_key="dummy_key")
        self.assertTrue(len(captured_payloads) > 0)
        p1 = captured_payloads[-1]
        text1 = p1["contents"][0]["parts"][0]["text"]
        temp1 = p1["generationConfig"]["temperature"]
        self.assertTrue(text1.startswith(TTS_STYLE_CONFIG["radio"]["prefix"]))
        self.assertEqual(temp1, 0.1)

        # Test with override style 'natural'
        await srv.synthesize_speech("Всем в канале 73", api_key="dummy_key", style="natural")
        p2 = captured_payloads[-1]
        text2 = p2["contents"][0]["parts"][0]["text"]
        temp2 = p2["generationConfig"]["temperature"]
        self.assertEqual(text2, "Всем в канале семьдесят три")
        self.assertEqual(temp2, 0.7)

        # Test with override style 'monotone'
        await srv.synthesize_speech("Всем в канале 73", api_key="dummy_key", style="monotone")
        p3 = captured_payloads[-1]
        text3 = p3["contents"][0]["parts"][0]["text"]
        temp3 = p3["generationConfig"]["temperature"]
        self.assertTrue(text3.startswith(TTS_STYLE_CONFIG["monotone"]["prefix"]))
        self.assertEqual(temp3, 0.0)


if __name__ == "__main__":
    unittest.main()
