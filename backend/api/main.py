from api import models
import asyncio
import json
import os
from datetime import datetime
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import select
from fastapi import FastAPI, Request, HTTPException, Depends
from api.models import init_db, AsyncSessionLocal, Incident, RCA, IncidentState, User
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as redis
import aio_pika
import uuid
from api.auth import hash_password, verify_password, create_access_token, get_current_user, require_admin

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Mission-Critical IMS Ingestion API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"], # Allows your React frontend to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class RCASubmission(BaseModel):
    root_cause_category: str = Field(..., description="e.g., Database, Network, Code")
    fix_applied: str = Field(..., description="What was done to fix it")
    prevention_steps: str = Field(..., description="How to prevent this in the future")

class UserAuthSchema(BaseModel):
    username: str
    password: str

class UserRegisterSchema(UserAuthSchema):
    role: str = "SRE_USER" 

async def log_throughput():
    global request_counter
    while True:
        await asyncio.sleep(5)
        print(f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] Throughput: {request_counter / 5:.2f} signals/sec (Total: {request_counter} in last 5s)")
        request_counter = 0

@app.on_event("startup")
async def startup_event():
    global redis_client, rmq_connection, rmq_channel
    
    # Initialize PostgreSQL Tables
    await init_db()
    
    redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
    
    # Connect to RabbitMQ with retry logic
    RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
    max_retries = 10
    for attempt in range(1, max_retries + 1):
        try:
            rmq_connection = await aio_pika.connect_robust(RABBITMQ_URL)
            rmq_channel = await rmq_connection.channel()
            await rmq_channel.declare_queue("raw_signals", durable=True)
            await rmq_channel.declare_queue("incidents", durable=True)
            print(f"RabbitMQ connected successfully on attempt {attempt}.")
            break
        except Exception as e:
            print(f"RabbitMQ connection attempt {attempt}/{max_retries} failed: {e}")
            if attempt == max_retries:
                raise RuntimeError(f"Could not connect to RabbitMQ after {max_retries} attempts") from e
            await asyncio.sleep(min(2 ** attempt, 30))  # Exponential backoff, max 30s
    
    asyncio.create_task(log_throughput())
    print("IMS Ingestion Engine Started with PostgreSQL, Redis & RabbitMQ.")

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

@app.get("/incidents")
async def get_incidents(current_user: dict = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Incident).order_by(Incident.created_at.desc()))
        incidents = result.scalars().all()
        return {"incidents": incidents}

@app.post("/incidents/{incident_id}/close")
async def close_incident_with_rca(incident_id: str, rca_data: RCASubmission, current_user: dict = Depends(require_admin)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Incident).where(Incident.id == incident_id))
        incident = result.scalars().first()

        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        
        if incident.state == IncidentState.CLOSED:
            raise HTTPException(status_code=400, detail="Incident is already closed")

        new_rca = RCA(
            id=f"RCA-{incident_id}",
            incident_id=incident_id,
            root_cause_category=rca_data.root_cause_category,
            fix_applied=rca_data.fix_applied,
            prevention_steps=rca_data.prevention_steps
        )
        
        incident.state = IncidentState.CLOSED
        
        session.add(new_rca)
        await session.commit()
        
        return {
            "status": "success", 
            "message": f"Incident {incident_id} successfully CLOSED by {current_user['username']}.",
            "rca_id": new_rca.id
        }

@app.post("/auth/register")
async def register(user_data: UserRegisterSchema):
    async with AsyncSessionLocal() as session:
        # Check if username exists
        result = await session.execute(select(User).where(User.username == user_data.username))
        if result.scalars().first():
            raise HTTPException(status_code=400, detail="Username already registered")
        
        new_user = User(
            id=str(uuid.uuid4())[:8],
            username=user_data.username,
            hashed_password=hash_password(user_data.password),
            role=user_data.role
        )
        session.add(new_user)
        await session.commit()
        return {"status": "success", "message": f"User {user_data.username} created as {user_data.role}."}

@app.post("/auth/login")
async def login(user_data: UserAuthSchema):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == user_data.username))
        user = result.scalars().first()
        
        if not user or not verify_password(user_data.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Incorrect username or password")
        
        # Issue JWT signed with the user's role
        token = create_access_token(data={"sub": user.username, "role": user.role.value})
        return {"access_token": token, "token_type": "bearer", "role": user.role.value}