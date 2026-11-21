import sys
sys.path.insert(0, '/app/src')

try:
    from dmr.manager import HotspotManager
    import main
    mgr = main.hotspot_manager
    print("Active User ID:", mgr.active_user_id)
    print("Recorder auto_rx_enabled:", mgr.recorder.auto_rx_enabled)
    print("Recorder auto_tx_enabled:", mgr.recorder.auto_tx_enabled)
    print("Recorder _muted_slots:", mgr.recorder._muted_slots)
    print("Recorder _muted_hotspots:", mgr.recorder._muted_hotspots)
    print("Recorder active rx_buffers:", list(mgr.recorder._rx_buffers.keys()))
    print("Runtimes:")
    for hid, rt in mgr.runtimes.items():
        print(f" - {hid}: name={rt.config.name}, auto_record={getattr(rt.config, 'auto_record', None)}, duplex={rt.config.duplex}, ts1_tg={rt.config.default_tg_ts1}, ts2_tg={rt.config.default_tg_ts2}, status={rt.status.value}")
        print(f"     ts1_active={rt.ts1.active}, ts2_active={rt.ts2.active}")
except Exception as e:
    import traceback
    traceback.print_exc()
