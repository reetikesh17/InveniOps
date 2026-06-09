import urllib.request
import json
import time
import random

API_URL = "http://localhost:8000/ingest"

components = ["DB_PRIMARY", "REDIS_CACHE", "AUTH_SERVICE", "PAYMENT_GATEWAY", "FRONTEND_PROXY"]
severities = ["P0", "P1", "P2"]
messages = {
    "DB_PRIMARY": "PostgreSQL connection pool exhausted",
    "REDIS_CACHE": "Redis read timeout / CPU spike",
    "AUTH_SERVICE": "Failed to verify JWT signatures",
    "PAYMENT_GATEWAY": "Stripe API returned 5xx status code",
    "FRONTEND_PROXY": "Nginx buffer overflow or high memory usage"
}

def send_signal(component, severity, message):
    data = json.dumps({
        "component_id": component,
        "severity": severity,
        "message": message
    }).encode("utf-8")
    
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode())
            print(f"Sent: {component} ({severity}) -> Response: {res_data.get('status')} - {res_data.get('message')}")
    except Exception as e:
        print(f"Error sending signal for {component}: {e}")

print("Starting simulated SRE incident generation load test...")
print("This will send a mix of new incidents and debounced duplicates to show in the dashboard.\n")

# 1. Generate a flurry of duplicate alerts to show debouncer working
print("--- Phase 1: Flurry of identical alerts to demonstrate Redis Debouncer ---")
for _ in range(5):
    send_signal("DB_PRIMARY", "P0", messages["DB_PRIMARY"])
    time.sleep(0.2)

print("\n--- Phase 2: Send other unique component alerts (will create new incidents) ---")
for comp in ["REDIS_CACHE", "AUTH_SERVICE", "PAYMENT_GATEWAY"]:
    send_signal(comp, random.choice(severities), messages[comp])
    time.sleep(1)

# 2. Wait a bit, then send some more to show new incident tickets being created
print("\nWaiting 11 seconds to let Redis debounce keys expire...")
time.sleep(11)

print("\n--- Phase 3: Send alerts again after expiry (should create new incidents) ---")
send_signal("DB_PRIMARY", "P1", "DB Primary - High query latency")
send_signal("FRONTEND_PROXY", "P2", messages["FRONTEND_PROXY"])

print("\nLoad generation completed successfully! Check the IMS Dashboard.")
