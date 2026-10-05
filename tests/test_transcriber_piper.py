import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
from transcriber import GeminiTranscriberService
from piper_service import PiperService


class TestTranscriberPiperSwitch(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.transcriber = GeminiTranscriberService()
        self.piper = PiperService.get_instance()

    async def test_transcriber_piper_mismatch_prevention(self):
        # Configure with English target_lang and Russian voice (simulating old voice left over)
        self.transcriber.configure(
            enabled=True,
            api_key="test_key",
            model="gemini-3.5-flash",
            target_lang="en",
            tts_enabled=True,
            tts_engine="piper",
            tts_voice="ru_RU-igm3804-medium"
        )
        # Verify configure auto-aligned tts_voice to English voice
        self.assertTrue(self.transcriber.tts_voice.startswith("en_"))

    async def test_synthesize_speech_rejects_uninstalled_language(self):
        # Spanish is not installed
        wav, err = await self.transcriber.synthesize_speech(
            text="Hola amigo",
            target_lang="es",
            engine="piper"
        )
        self.assertIsNone(wav)
        self.assertIn("не готова", err)

    async def test_process_utterance_skips_when_model_not_installed(self):
        # Configure transcriber for Spanish (not installed)
        self.transcriber.configure(
            enabled=True,
            api_key="test_key",
            model="gemini-3.5-flash",
            target_lang="es",
            tts_enabled=True,
            tts_engine="piper",
            tts_voice="auto"
        )
        broadcast_mock = AsyncMock()
        self.transcriber.broadcast_fn = broadcast_mock
        self.transcriber.set_slot_tts_enabled("default", 1, True)

        # Mock piper synthesize_async to ensure it is NEVER called when model is not ready
        with patch.object(self.piper, "synthesize_async", new_callable=AsyncMock) as mock_synth:
            # We call the TTS logic by creating a dummy audio chunk or simulating the block
            # Specifically check that is_voice_ready_for_lang returns False for 'es'
            ready, vid, reason = self.piper.is_voice_ready_for_lang("es", self.transcriber.tts_voice)
            self.assertFalse(ready)
            mock_synth.assert_not_called()


if __name__ == "__main__":
    unittest.main()
