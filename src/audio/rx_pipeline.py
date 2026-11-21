"""
rx_pipeline.py - Safe pass-through stub for ProxDMR audio pipeline.
(Neural denoiser removed; all channels run native 8 kHz).
"""

import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("proxdmr.rx_pipeline")


class SlotRxPipeline:
    def __init__(self, slot: int = 1):
        self.slot = slot

    def reset(self):
        pass

    def reset_slot(self, slot: int = 1):
        pass

    def process_burst(self, pcm_8k: bytes, meta_list: list = None, slot: int = 1) -> bytes:
        return pcm_8k

    def set_settings(self, **kwargs):
        pass


class ServerRxPipeline:
    def __init__(self):
        self._slots = {1: SlotRxPipeline(1), 2: SlotRxPipeline(2)}

    def process_burst(self, pcm_8k: bytes, meta_list: list = None, slot: int = 1) -> bytes:
        return pcm_8k

    def reset_slot(self, slot: int):
        pass

    def reset(self):
        pass

    def set_settings(self, **kwargs):
        pass

    def get_settings(self) -> Dict[str, Any]:
        return {}
