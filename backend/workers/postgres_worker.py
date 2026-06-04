import asyncio
import json
import uuid
import aio_pika
from sqlalchemy.ext.asyncio import AsyncSession
from api.models import AsyncSessionLocal, Incident, IncidentState

async def process_incident(message: aio_pika.IncomingMessage):
    async with message.process():
        payload = json.loads(message.body.decode())
        
        # Generate a unique incident ticket ID (e.g., INC-CACHE_CLUSTER_01-uuid)
        ticket_id = f"INC-{payload.get('component_id')}-{str(uuid.uuid4())[:8]}"
        
        async with AsyncSessionLocal() as session:
            new_incident = Incident(
                id=ticket_id,
                component_id=payload.get("component_id"),
                severity=payload.get("severity"),
                message=payload.get("message"),
                state=IncidentState.OPEN
            )
            
            session.add(new_incident)
            await session.commit()
            
            print(f"New Incident Created in PostgreSQL: {ticket_id} | State: {IncidentState.OPEN.value}")

async def main():
    connection = await aio_pika.connect_robust("amqp://guest:guest@localhost/")
    channel = await connection.channel()
    
    # Listen strictly to the debounced 'incidents' queue
    queue = await channel.declare_queue("incidents", durable=True)
    
    print("PostgreSQL Workflow Worker Started. Waiting for incidents...")
    
    await queue.consume(process_incident)
    
    try:
        await asyncio.Future()
    finally:
        await connection.close()

if __name__ == "__main__":
    asyncio.run(main())