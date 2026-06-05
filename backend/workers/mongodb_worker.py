import asyncio
import json
import os
import aio_pika
from motor.motor_asyncio import AsyncIOMotorClient

# MongoDB Connection
MONGO_DETAILS = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(MONGO_DETAILS)
database = client.ims_data_lake
raw_logs_collection = database.get_collection("raw_signals")

async def process_message(message: aio_pika.IncomingMessage):
    async with message.process():
        # 1. Decode the JSON payload from RabbitMQ
        payload = json.loads(message.body.decode())
        
        # 2. Insert it into the MongoDB Data Lake
        await raw_logs_collection.insert_one(payload)
        
        print(f"[✓] Saved signal to Data Lake: {payload.get('component_id')} at {payload.get('timestamp')}")

async def main():
    # Connect to RabbitMQ
    RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost/")
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    
    # Connect to the exact same queue the API is publishing to
    queue = await channel.declare_queue("raw_signals", durable=True)
    
    print("MongoDB Worker Started. Waiting for raw signals to save to the Data Lake...")
    
    # Start consuming messages
    await queue.consume(process_message)
    
    # Keep the worker running indefinitely
    try:
        await asyncio.Future()
    finally:
        await connection.close()

if __name__ == "__main__":
    asyncio.run(main())