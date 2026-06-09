from locust import HttpUser, task, between, events
import json
import random

class SREPerformanceUser(HttpUser):
    # Simulate a user "thinking" between 1 and 3 seconds
    wait_time = between(1, 3)
    
    # Store the token after logging in
    token = None

    def on_start(self):
        """Executed when a simulated user starts."""
        response = self.client.post("/auth/login", json={
            "username": "admin_sre",
            "password": "admin123"
        })
        if response.status_code == 200:
            self.token = response.json().get("access_token")
        else:
            print(f"Login failed: {response.status_code} - {response.text}")

    @task(3)
    def view_incidents(self):
        """Simulate a user checking the dashboard."""
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        self.client.get("/incidents", headers=headers)

    @task(1)
    def ingest_signal(self):
        """Simulate a system pushing a new incident signal."""
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        
        # IncidentSignal schema requires: component_id, severity, message
        component = random.choice(["DB_PRIMARY", "REDIS_CACHE", "AUTH_SERVICE", "PAYMENT_GATEWAY"])
        severity = random.choice(["P0", "P1", "P2"])
        
        self.client.post("/ingest", json={
            "component_id": component,
            "severity": severity,
            "message": f"Simulated Locust health check alert for {component}."
        }, headers=headers)