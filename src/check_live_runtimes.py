import json, sqlite3

conn = sqlite3.connect('/app/config/proxdmr.db')
c = conn.cursor()
c.execute("SELECT user_id, settings_json FROM user_settings WHERE user_id = 1")
row = c.fetchone()
if row:
    data = json.loads(row[1])
    print("User 1 Hotspots:")
    for h in data.get("hotspots", []):
        print(f"  id={h.get('id')} name={h.get('name')} ssid={h.get('bm_ssid')} status={h.get('status')} host={h.get('bm_master_host')} autoconnect={h.get('autoconnect')} collapsed={h.get('collapsed')}")

