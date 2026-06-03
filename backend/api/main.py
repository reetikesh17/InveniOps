import asyncio
from datetime import datetime
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# Initialize Rate Limiter (tracking by IP address)
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Mission-Critical IMS Ingestion API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Global counter for throughput metrics
request_counter = 0

# Pydantic Model for strict data validation
class IncidentSignal(BaseModel):
    component_id: str = Field(..., description="ID of the failing component", examples=["CACHE_CLUSTER_01"])
    severity: str = Field(..., description="Severity level (e.g., P0, P1, P2)", examples=["P2"])
    message: str = Field(..., description="Error description", examples=["Redis timeout"])
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# Background task to print metrics every 5 seconds
async def log_throughput():
    global request_counter
    while True:
        await asyncio.sleep(5)
        print(f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] Throughput: {request_counter / 5:.2f} signals/sec (Total: {request_counter} in last 5s)")
        request_counter = 0  # Reset counter after printing

@app.on_event("startup")
async def startup_event():
    # Start the throughput logger when the server starts
    asyncio.create_task(log_throughput())
    print("🚀 IMS Ingestion Engine Started.")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ims-ingestion-engine", "timestamp": datetime.utcnow()}

@app.post("/ingest")
@limiter.limit("10000/minute") # Rate limiting to prevent cascading failures
async def ingest_signal(request: Request, signal: IncidentSignal):
    global request_counter
    request_counter += 1
    
    # In Phase 2, this is where we will push the payload to RabbitMQ/Redis.
    # For now, we accept it and return a 202 Accepted status.
    return {"status": "accepted", "signal_id": signal.component_id}