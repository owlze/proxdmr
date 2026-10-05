import asyncio
import hashlib
import logging
import struct
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional

logger = logging.getLogger("proxdmr.homebrew")

@dataclass
class DMRFrame:
    slot: int          # 1 or 2
    call_type: str     # "GROUP" or "PRIVATE"
    frame_type: int    # 0=voice, 1=voice sync, etc.
    src_id: int        # 24-bit caller DMR ID
    dst_id: int        # 24-bit target TG or unit ID
    stream_id: int     # 32-bit stream identifier
    payload: bytes     # 33 bytes payload (AMBE+2 & signaling)
    seq_no: int        # Frame sequence number
    ber: int = 0       # Bit Error Rate
    rssi: int = 0      # RSSI

class BMState(str, Enum):
    DISCONNECTED = "OFFLINE"
    CONNECTING = "CONNECTING"
    AUTHENTICATING = "AUTHENTICATING"
    CONFIGURING = "CONFIGURING"
    ONLINE = "ONLINE"
    AUTH_FAILED = "AUTH_FAILED"
    ERROR = "ERROR"

class HomeBrewProtocol(asyncio.DatagramProtocol):
    def __init__(self, on_datagram_received: Callable[[bytes], None], on_error: Callable[[Exception], None]):
        self.on_datagram_received = on_datagram_received
        self.on_error = on_error
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr):
        self.on_datagram_received(data)

    def error_received(self, exc: Exception):
        logger.error(f"[HB] Protocol error: {exc}")
        self.on_error(exc)

    def connection_lost(self, exc: Optional[Exception]):
        if exc:
            logger.warning(f"[HB] Connection lost: {exc}")

class HomeBrewClient:
    def __init__(
        self,
        repeater_id: int,
        callsign: str,
        password: str,
        master_host: str = "2322.master.brandmeister.network",
        master_port: int = 62031,
        ssid: int = 1,
        duplex: bool = True,
        rx_freq: int = 438800000,
        tx_freq: int = 431200000,
        color_code: int = 1,
        on_status_change: Optional[Callable[[BMState, str], None]] = None,
        on_frame_received: Optional[Callable[[bytes], None]] = None,
        on_dmr_frame: Optional[Callable[[DMRFrame], None]] = None,
    ):
        self.base_repeater_id = repeater_id
        self.ssid = ssid
        self.callsign = callsign.strip().upper()
        self.password = password
        self.master_host = master_host.strip()
        self.master_port = master_port
        self.duplex = duplex
        self.rx_freq = rx_freq
        self.tx_freq = tx_freq
        self.color_code = color_code
        self.on_status_change = on_status_change
        self.on_frame_received = on_frame_received
        self.on_dmr_frame = on_dmr_frame

        self.state: BMState = BMState.DISCONNECTED
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.protocol: Optional[HomeBrewProtocol] = None
        self.keepalive_task: Optional[asyncio.Task] = None
        self.handshake_timeout_task: Optional[asyncio.Task] = None
        self.last_keepalive_rx: float = 0.0
        self.salt: bytes = b""
        self.connect_attempt: int = 0
        self.max_retries: int = 5
        self._retry_task: Optional[asyncio.Task] = None
        self._was_connected: bool = False
        self._is_fast_reconnecting: bool = False
        self._is_manual_disconnect: bool = False
        self._connect_lock: Optional[asyncio.Lock] = None

    @property
    def connect_lock(self) -> asyncio.Lock:
        if self._connect_lock is None:
            self._connect_lock = asyncio.Lock()
        return self._connect_lock

    @property
    def is_connected(self) -> bool:
        return self.state == BMState.ONLINE

    @property
    def effective_repeater_id(self) -> int:
        if self.base_repeater_id <= 0:
            return 0
        s_id = str(self.base_repeater_id)
        if len(s_id) == 7 and 1 <= self.ssid <= 99:
            return int(f"{s_id}{self.ssid:02d}")
        return self.base_repeater_id

    def set_state(self, new_state: BMState, detail: str = ""):
        self.state = new_state
        logger.info(f"[HB] State changed -> {new_state.value} ({detail})")
        if self.on_status_change:
            try:
                self.on_status_change(new_state, detail)
            except Exception as e:
                logger.error(f"[HB] Error in status callback: {e}")

    async def connect(self, max_retries: int = 5, retry_delay: float = 2.0, force: bool = False) -> bool:
        async with self.connect_lock:
            if not force:
                if self.is_connected and self.transport and not self.transport.is_closing():
                    logger.info(f"[HB] Hotspot ID {self.effective_repeater_id} is already ONLINE, skipping redundant connect")
                    return True
                if self.state in (BMState.CONNECTING, BMState.AUTHENTICATING, BMState.CONFIGURING):
                    logger.info(f"[HB] Hotspot ID {self.effective_repeater_id} connection is already in progress ({self.state.value}), skipping redundant connect")
                    return True

            if self._retry_task and not self._retry_task.done():
                self._retry_task.cancel()
                self._retry_task = None

            if self.transport and not self.transport.is_closing():
                logger.warning("[HB] Connect called while active, closing previous transport...")
                await self.disconnect(is_retry=True)

            self._is_manual_disconnect = False
            self._was_connected = False
            self._is_fast_reconnecting = False
            self.connect_attempt = 1
            return await self._start_connection_attempt()

    async def _start_connection_attempt(self) -> bool:
        if self._is_manual_disconnect:
            return False

        # Close any lingering transport before creating a new endpoint
        if self.transport and not self.transport.is_closing():
            try:
                self.transport.close()
            except Exception:
                pass
            self.transport = None

        rep_id = self.effective_repeater_id
        if rep_id <= 0:
            self.set_state(BMState.ERROR, "Не указан DMR ID")
            return False

        if not self.password:
            self.set_state(BMState.ERROR, "Не указан пароль хотспота (SelfCare)")
            return False

        if self._is_fast_reconnecting:
            attempt_text = f"Быстрое переподключение к {self.master_host}:{self.master_port} ({self.connect_attempt} из 5)..."
        else:
            attempt_text = f"Подключение к {self.master_host}:{self.master_port} (попытка {self.connect_attempt} из 5)..."

        self.set_state(BMState.CONNECTING, attempt_text)
        loop = asyncio.get_running_loop()

        try:
            self.transport, self.protocol = await loop.create_datagram_endpoint(
                lambda: HomeBrewProtocol(self.handle_datagram, self.handle_error),
                remote_addr=(self.master_host, self.master_port),
            )
        except Exception as e:
            logger.error(f"[HB] UDP Socket create failed: {e}")
            return self._handle_attempt_failure(f"Ошибка сокета: {e}")

        self.send_login()
        if self.handshake_timeout_task and not self.handshake_timeout_task.done():
            self.handshake_timeout_task.cancel()
        self.handshake_timeout_task = asyncio.create_task(self._handshake_timeout_watcher())
        return True

    def _handle_attempt_failure(self, error_detail: str) -> bool:
        if self._is_manual_disconnect:
            return False

        if self._is_fast_reconnecting:
            # Mode A: Fast reconnect sequence (5 attempts with 1s pause between each)
            if self.connect_attempt < 5:
                next_attempt = self.connect_attempt + 1
                delay = 1.0
                logger.warning(
                    f"[HB] Fast reconnect attempt {self.connect_attempt}/5 failed ({error_detail}). "
                    f"Retrying in 1s ({next_attempt}/5)..."
                )
                self.set_state(BMState.CONNECTING, f"Быстрый повтор через 1с ({next_attempt} из 5)...")

                async def _do_fast_retry():
                    await self.disconnect(is_retry=True)
                    await asyncio.sleep(delay)
                    if not self._is_manual_disconnect:
                        self.connect_attempt = next_attempt
                        await self._start_connection_attempt()

                if self._retry_task and not self._retry_task.done():
                    self._retry_task.cancel()
                self._retry_task = asyncio.create_task(_do_fast_retry())
                return False
            else:
                # All 5 fast attempts failed -> 7s pause, then transition to standard progressive cycle
                logger.warning(
                    f"[HB] All 5 fast reconnect attempts failed ({error_detail}). "
                    f"Pausing 7s before transitioning to standard retry protocol..."
                )
                self.set_state(BMState.CONNECTING, "Быстрое восстановление не удалось. Пауза 7с перед повторным циклом...")
                self._is_fast_reconnecting = False
                self.connect_attempt = 1
                delay = 7.0

                async def _do_transition_to_standard():
                    await self.disconnect(is_retry=True)
                    await asyncio.sleep(delay)
                    if not self._is_manual_disconnect:
                        await self._start_connection_attempt()

                if self._retry_task and not self._retry_task.done():
                    self._retry_task.cancel()
                self._retry_task = asyncio.create_task(_do_transition_to_standard())
                return False

        else:
            # Mode B: Standard progressive protocol:
            # Attempts 1..5: pause 2s, 3s, 4s, 5s. After 5th: pause 7s before repeating cycle.
            if self.connect_attempt < 5:
                next_attempt = self.connect_attempt + 1
                delay = float(self.connect_attempt + 1)  # 1->2s, 2->3s, 3->4s, 4->5s
                logger.warning(
                    f"[HB] Attempt {self.connect_attempt}/5 failed ({error_detail}). "
                    f"Retrying in {int(delay)}s ({next_attempt}/5)..."
                )
                self.set_state(BMState.CONNECTING, f"Повтор через {int(delay)}с ({next_attempt} из 5)...")

                async def _do_standard_retry():
                    await self.disconnect(is_retry=True)
                    await asyncio.sleep(delay)
                    if not self._is_manual_disconnect:
                        self.connect_attempt = next_attempt
                        await self._start_connection_attempt()

                if self._retry_task and not self._retry_task.done():
                    self._retry_task.cancel()
                self._retry_task = asyncio.create_task(_do_standard_retry())
                return False
            else:
                # All 5 standard attempts failed -> 7s pause, then start next cycle from Attempt 1
                logger.warning(
                    f"[HB] All 5 connection attempts failed ({error_detail}). "
                    f"Pausing 7s before repeating connection cycle..."
                )
                self.set_state(BMState.CONNECTING, "Все 5 попыток завершились неудачей. Пауза 7с перед повтором...")
                self.connect_attempt = 1
                delay = 7.0

                async def _do_next_standard_cycle():
                    await self.disconnect(is_retry=True)
                    await asyncio.sleep(delay)
                    if not self._is_manual_disconnect:
                        await self._start_connection_attempt()

                if self._retry_task and not self._retry_task.done():
                    self._retry_task.cancel()
                self._retry_task = asyncio.create_task(_do_next_standard_cycle())
                return False

    def _handle_unexpected_disconnect(self, reason: str):
        if self._is_manual_disconnect:
            return
        logger.warning(
            f"[HB] Unexpected disconnect from BM ({reason}). "
            f"Starting fast reconnect protocol (5 attempts, 1s interval)..."
        )
        self.set_state(BMState.CONNECTING, f"Разрыв связи с BM: {reason}. Быстрое переподключение (1 из 5)...")
        self._is_fast_reconnecting = True
        self.connect_attempt = 1

        async def _do_fast_start():
            await self.disconnect(is_retry=True)
            await asyncio.sleep(1.0)
            if not self._is_manual_disconnect:
                await self._start_connection_attempt()

        if self._retry_task and not self._retry_task.done():
            self._retry_task.cancel()
        self._retry_task = asyncio.create_task(_do_fast_start())

    def send_login(self):
        rep_id = self.effective_repeater_id
        packet = b"RPTL" + struct.pack(">I", rep_id)
        logger.info(f"[HB] Sending RPTL login for ID: {rep_id} to {self.master_host}...")
        self.send_raw(packet)

    def send_auth_key(self, salt: bytes):
        rep_id = self.effective_repeater_id
        # HomeBrew challenge response: sha256(salt[:4] + password)
        challenge = salt[:4] + self.password.encode("ascii", errors="ignore")
        auth_hash = hashlib.sha256(challenge).digest()
        
        # RPTK: 4 bytes tag + 4 bytes ID + 32 bytes SHA256 digest = 40 bytes
        packet = b"RPTK" + struct.pack(">I", rep_id) + auth_hash
        logger.info(f"[HB] Sending RPTK auth hash for ID {rep_id}...")
        self.send_raw(packet)
        self.set_state(BMState.AUTHENTICATING, "Проверка пароля")

    def send_config(self):
        rep_id = self.effective_repeater_id
        callsign_bytes = f"{self.callsign:<8.8}".encode("ascii")
        
        # Duplex vs Simplex
        if self.duplex:
            slots_bytes = b"3"  # Duplex: Slot 1 and Slot 2
            tx_f = self.tx_freq if self.tx_freq != self.rx_freq else (self.rx_freq - 7600000)
        else:
            slots_bytes = b"4"  # Simplex: Slot 2
            tx_f = self.rx_freq

        rx_freq_bytes = f"{self.rx_freq:09d}"[:9].encode("ascii")
        tx_freq_bytes = f"{tx_f:09d}"[:9].encode("ascii")
        tx_power_bytes = b"01"
        cc_bytes = f"{self.color_code:02d}"[:2].encode("ascii")
        lat_bytes = b"0.000000"  # 8 bytes
        lon_bytes = b"00.000000" # 9 bytes
        height_bytes = b"000"    # 3 bytes
        location_bytes = f"{'ProxDMR Hotspot':<20.20}".encode("ascii")
        desc_bytes = f"{'ProxDMR Gateway':<19.19}".encode("ascii")
        url_bytes = f"{'https://brandmeister.network':<124.124}".encode("ascii")
        soft_id_bytes = f"{'20240101':<40.40}".encode("ascii")
        pkg_id_bytes = f"{'MMDVM':<40.40}".encode("ascii")

        payload = (
            callsign_bytes
            + rx_freq_bytes
            + tx_freq_bytes
            + tx_power_bytes
            + cc_bytes
            + lat_bytes
            + lon_bytes
            + height_bytes
            + location_bytes
            + desc_bytes
            + slots_bytes
            + url_bytes
            + soft_id_bytes
            + pkg_id_bytes
        )
        packet = b"RPTC" + struct.pack(">I", rep_id) + payload
        logger.info(f"[HB] Sending RPTC config ({len(packet)} bytes, Duplex={self.duplex})...")
        self.send_raw(packet)
        self.set_state(BMState.CONFIGURING, "Отправка конфигурации хотспота")

    def send_keepalive(self):
        rep_id = self.effective_repeater_id
        packet = b"RPTPING" + struct.pack(">I", rep_id)
        self.send_raw(packet)

    def send_raw(self, data: bytes):
        if self.transport and not self.transport.is_closing():
            self.transport.sendto(data)

    def send_dmrd(
        self,
        slot: int,
        call_type: str,
        frame_type: int,
        stream_id: int,
        seq_no: int,
        payload: bytes,
        src_id: int,
        dst_id: int,
        burst_index: int = 0,
    ):
        """
        Sends a HomeBrew DMRD packet (55 bytes).
        Compliant with MMDVMHost / BrandMeister HomeBrew protocol specification:
        - slot: 1 or 2
        - call_type: 'GROUP' or 'PRIVATE'
        - frame_type:
            1 or "HEADER": DT_VOICE_LC_HEADER (DataSync + 0x01 = 0x21)
            2 or "TERM":   DT_TERMINATOR_WITH_LC (DataSync + 0x02 = 0x22)
            0 or "BURST":
              burst_index % 6 == 0: DT_VOICE_SYNC (VoiceSync = 0x10)
              burst_index % 6 == 1..5: DT_VOICE (N = 1..5)
        - stream_id: 32-bit unsigned int
        - seq_no: 8-bit unsigned int (0..255)
        - payload: 33 bytes DMR burst
        - src_id: 24-bit DMR ID (e.g. 1234567)
        - dst_id: 24-bit DMR ID / TG (e.g. 9990 or 2501)
        - burst_index: 0..5 index within superframe (for voice bursts)
        """
        if not self.transport or self.transport.is_closing() or self.state != BMState.ONLINE:
            return

        rep_id = self.effective_repeater_id
        slot_bit = 0x80 if slot == 2 else 0x00
        call_bit = 0x40 if str(call_type).upper() == "PRIVATE" else 0x00

        if frame_type in (1, "HEADER"):
            # DT_VOICE_LC_HEADER (DataSync flag 0x20 | 0x01)
            type_byte = 0x20 | 0x01
        elif frame_type in (2, "TERM"):
            # DT_TERMINATOR_WITH_LC (DataSync flag 0x20 | 0x02)
            type_byte = 0x20 | 0x02
        else:
            burst_pos = burst_index % 6
            if burst_pos == 0:
                # Burst A: DT_VOICE_SYNC (VoiceSync flag 0x10)
                type_byte = 0x10
            else:
                # Bursts B..F: DT_VOICE with burst number N = 1..5
                type_byte = burst_pos & 0x0F

        slot_byte = slot_bit | call_bit | type_byte

        packet = bytearray(55)
        packet[0:4] = b"DMRD"
        packet[4] = seq_no & 0xFF
        packet[5] = (src_id >> 16) & 0xFF
        packet[6] = (src_id >> 8) & 0xFF
        packet[7] = src_id & 0xFF
        packet[8] = (dst_id >> 16) & 0xFF
        packet[9] = (dst_id >> 8) & 0xFF
        packet[10] = dst_id & 0xFF
        packet[11:15] = struct.pack(">I", rep_id)
        packet[15] = slot_byte
        packet[16:20] = struct.pack(">I", stream_id)
        packet[20:53] = payload[:33]
        packet[53] = 0x00  # BER
        packet[54] = 0x00  # RSSI

        self.send_raw(bytes(packet))
        if frame_type in (1, "HEADER"):
            logger.info(f"[HB_TX] DMRD Voice Header: Seq={seq_no}, Slot={slot}, SlotByte=0x{slot_byte:02X}, Src={src_id}, Dst={dst_id}")
        elif frame_type in (2, "TERM"):
            logger.info(f"[HB_TX] DMRD Voice Terminator: Seq={seq_no}, Slot={slot}, SlotByte=0x{slot_byte:02X}, Src={src_id}, Dst={dst_id}")
        elif burst_index == 0 or burst_index % 18 == 0:
            logger.info(f"[HB_TX] DMRD Voice Burst #{burst_index}: Seq={seq_no}, Slot={slot}, SlotByte=0x{slot_byte:02X}")

    def handle_datagram(self, data: bytes):
        if len(data) < 4:
            return

        # 1. Master NAK (Auth Failed or Config Rejected)
        if data.startswith(b"MSTNAK") or data.startswith(b"RPTNAK"):
            logger.error(f"[HB] Received NAK from BM in state {self.state.value}!")
            if self.handshake_timeout_task and not self.handshake_timeout_task.done():
                self.handshake_timeout_task.cancel()
            if self.state == BMState.AUTHENTICATING:
                self.set_state(BMState.AUTH_FAILED, "Неверный пароль хотспота (BM NAK)")
                asyncio.create_task(self.disconnect())
            elif self.state == BMState.CONFIGURING:
                self._handle_attempt_failure("Конфигурация отклонена BM")
            else:
                self._handle_attempt_failure("Соединение отклонено BM")
            return

        # 2. Challenge packet received while CONNECTING
        if self.state == BMState.CONNECTING:
            if data.startswith(b"RPTACK") and len(data) >= 10:
                self.salt = data[6:10]
                logger.info(f"[HB] Received challenge salt (RPTACK): {self.salt.hex()}")
                self.send_auth_key(self.salt)
                return
            elif data.startswith(b"RPTL") and len(data) >= 8:
                self.salt = data[4:8]
                logger.info(f"[HB] Received challenge salt (RPTL): {self.salt.hex()}")
                self.send_auth_key(self.salt)
                return

        # 3. Auth ACK received while AUTHENTICATING
        if self.state == BMState.AUTHENTICATING:
            if data.startswith(b"RPTACK") or data.startswith(b"MSTACK") or data.startswith(b"RPTA"):
                logger.info("[HB] Authentication OK! Sending repeater configuration (RPTC)...")
                self.send_config()
                return

        # 4. Config ACK received while CONFIGURING
        if self.state == BMState.CONFIGURING:
            if data.startswith(b"RPTACK") or data.startswith(b"MSTACK") or data.startswith(b"RPTA"):
                logger.info("[HB] Configuration accepted! BM ONLINE!")
                if self.handshake_timeout_task and not self.handshake_timeout_task.done():
                    self.handshake_timeout_task.cancel()
                if self._retry_task and not self._retry_task.done():
                    self._retry_task.cancel()
                    self._retry_task = None
                self._was_connected = True
                self._is_fast_reconnecting = False
                self.connect_attempt = 1
                self.set_state(BMState.ONLINE, "Подключен к BM")
                self.last_keepalive_rx = time.time()
                self._start_keepalive_task()
                return

        # 5. Keepalive PONG
        if data.startswith(b"MSTPONG") or data.startswith(b"RPTP") or data.startswith(b"MSTP"):
            self.last_keepalive_rx = time.time()
            return

        # 6. Master Closing
        if data.startswith(b"MSTCL"):
            logger.warning("[HB] Master closing connection (MSTCL)")
            if self._was_connected:
                self._handle_unexpected_disconnect("Мастер завершил сессию (MSTCL)")
            else:
                self.set_state(BMState.DISCONNECTED, "Мастер завершил сессию")
                asyncio.create_task(self.disconnect())
            return

        # 7. DMRD (Voice / Data frames)
        if data.startswith(b"DMRD") and len(data) >= 53:
            if self.on_frame_received:
                try:
                    self.on_frame_received(data)
                except Exception as e:
                    logger.error(f"[HB] Error in raw frame callback: {e}")

            if self.on_dmr_frame:
                try:
                    seq_no = data[4]
                    src_id = (data[5] << 16) | (data[6] << 8) | data[7]
                    dst_id = (data[8] << 16) | (data[9] << 8) | data[10]
                    slot_byte = data[15]
                    slot = 2 if (slot_byte & 0x80) else 1
                    call_type = "PRIVATE" if (slot_byte & 0x40) else "GROUP"
                    frame_type = slot_byte & 0x3F
                    stream_id = struct.unpack(">I", data[16:20])[0]
                    payload = data[20:53]
                    ber = data[53] if len(data) > 53 else 0
                    rssi = data[54] if len(data) > 54 else 0

                    frame = DMRFrame(
                        slot=slot,
                        call_type=call_type,
                        frame_type=frame_type,
                        src_id=src_id,
                        dst_id=dst_id,
                        stream_id=stream_id,
                        payload=payload,
                        seq_no=seq_no,
                        ber=ber,
                        rssi=rssi,
                    )
                    self.on_dmr_frame(frame)
                except Exception as e:
                    logger.error(f"[HB] Error parsing DMRD frame: {e}")
            return

        logger.debug(f"[HB] Unknown datagram: {data[:10]} ({len(data)} bytes)")

    def handle_error(self, exc: Exception):
        logger.error(f"[HB] Transport error: {exc}")
        if self.state in (BMState.CONNECTING, BMState.AUTHENTICATING, BMState.CONFIGURING):
            self._handle_attempt_failure(f"Сетевая ошибка: {exc}")
        elif self.state == BMState.ONLINE:
            self._handle_unexpected_disconnect(f"Сетевая ошибка: {exc}")
        else:
            self.set_state(BMState.ERROR, f"Сетевая ошибка: {exc}")

    def _start_keepalive_task(self):
        if self.keepalive_task and not self.keepalive_task.done():
            self.keepalive_task.cancel()
        self.keepalive_task = asyncio.create_task(self._keepalive_loop())

    async def _keepalive_loop(self):
        logger.info("[HB] Keepalive loop started (5s)")
        try:
            while self.state == BMState.ONLINE:
                await asyncio.sleep(5.0)
                if self.state != BMState.ONLINE:
                    break

                self.send_keepalive()

                if time.time() - self.last_keepalive_rx > 20.0:
                    logger.warning("[HB] Keepalive timeout: no response from BM master for >20s")
                    self._handle_unexpected_disconnect("Таймаут соединения с BM (>20с)")
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[HB] Keepalive error: {e}")

    async def _handshake_timeout_watcher(self):
        try:
            await asyncio.sleep(6.0)
            if self.state in (BMState.CONNECTING, BMState.AUTHENTICATING, BMState.CONFIGURING):
                logger.warning(f"[HB] Handshake timed out (попытка {self.connect_attempt}/5)")
                self._handle_attempt_failure("Мастер BM не отвечает (таймаут)")
        except asyncio.CancelledError:
            pass

    async def disconnect(self, is_retry: bool = False):
        logger.info(f"[HB] Disconnecting (is_retry={is_retry})...")
        if not is_retry:
            self._is_manual_disconnect = True
            self._was_connected = False
            self._is_fast_reconnecting = False
            if self._retry_task and not self._retry_task.done():
                self._retry_task.cancel()
                self._retry_task = None
            self.connect_attempt = 0

        if self.handshake_timeout_task and not self.handshake_timeout_task.done():
            self.handshake_timeout_task.cancel()

        if self.keepalive_task and not self.keepalive_task.done():
            self.keepalive_task.cancel()

        if self.transport and not self.transport.is_closing():
            try:
                rep_id = self.effective_repeater_id
                self.send_raw(b"RPTCL" + struct.pack(">I", rep_id))
            except Exception:
                pass
            try:
                self.transport.close()
            except Exception:
                pass

        self.transport = None
        self.protocol = None
        if not is_retry:
            if self.state not in (BMState.AUTH_FAILED, BMState.ERROR):
                self.set_state(BMState.DISCONNECTED, "Отключено пользователем")
        else:
            if self.state not in (BMState.AUTH_FAILED, BMState.ERROR):
                self.set_state(BMState.DISCONNECTED, "Переподключение")