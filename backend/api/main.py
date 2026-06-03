import asyncio
import json
from datetime import datetime
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import redis.asyncio as redis
import aio_pika

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Mission-Critical IMS Ingestion API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

request_counter = 0

# Globals for our infrastructure connections
redis_client = None
rmq_connection = None
rmq_channel = None

class IncidentSignal(BaseModel):
    component_id: str = Field(..., description="ID of the failing component", examples=["CACHE_CLUSTER_01"])
    severity: str = Field(..., description="Severity level (e.g., P0, P1, P2)", examples=["P2"])
    message: str = Field(..., description="Error description", examples=["Redis timeout"])
    timestamp: datetime = Field(default_factory=datetime.utcnow)

async def log_throughput():
    global request_counter
    while True:
        await asyncio.sleep(5)
        print(f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] Throughput: {request_counter / 5:.2f} signals/sec (Total: {request_counter} in last 5s)")
        request_counter = 0

@app.on_event("startup")
async def startup_event():
    global redis_client, rmq_connection, rmq_channel
    
    # 1. Connect to Redis
    redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
    
    # 2. Connect to RabbitMQ
    rmq_connection = await aio_pika.connect_robust("amqp://guest:guest@localhost/")
    rmq_channel = await rmq_connection.channel()
    
    # 3. Declare our durable queues
    await rmq_channel.declare_queue("raw_signals", durable=True)
    await rmq_channel.declare_queue("incidents", durable=True)
    
    asyncio.create_task(log_throughput())
    print("IMS Ingestion Engine Started with Redis & RabbitMQ.")

@app.on_event("shutdown")
async def shutdown_event():
    await rmq_connection.close()
    await redis_client.close()

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ims-ingestion-engine", "timestamp": datetime.utcnow()}

@app.post("/ingest")
@limiter.limit("10000/minute")
async def ingest_signal(request: Request, signal: IncidentSignal):
    global request_counter
    request_counter += 1
    
    payload_bytes = signal.model_dump_json().encode()

    # Step 1: Push EVERY raw signal to the Data Lake queue
    await rmq_channel.default_exchange.publish(
        aio_pika.Message(body=payload_bytes),
        routing_key="raw_signals"
    )

    # Step 2: The Redis Debouncing Engine
    # NX=True means "Set only if it doesn't exist". EX=10 means "Expire in 10 seconds".
    is_new_incident = await redis_client.set(
        f"debounce:{signal.component_id}",
        "active",
        ex=10,
        nx=True
    )

    if is_new_incident:
        # Step 3: This is the first signal in 10 seconds! Create an incident ticket.
        await rmq_channel.default_exchange.publish(
            aio_pika.Message(body=payload_bytes),
            routing_key="incidents"
        )
        return {"status": "accepted", "message": "New incident created", "signal_id": signal.component_id}
    else:
        # Step 4: We've already seen this in the last 10 seconds. Debounce it.
        return {"status": "accepted", "message": "Signal debounced", "signal_id": signal.component_id}