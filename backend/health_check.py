import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import redis.asyncio as aioredis
import aio_pika
from motor.motor_asyncio import AsyncIOMotorClient

async def check_all():
    print("=" * 50)
    print("  IMS Infrastructure Health Check")
    print("=" * 50)

    # 1. PostgreSQL
    try:
        engine = create_async_engine("postgresql+asyncpg://postgres:postgres@localhost:5432/ims_db")
        async with engine.connect() as conn:
            users = (await conn.execute(text("SELECT count(*) FROM users"))).scalar()
            incidents = (await conn.execute(text("SELECT count(*) FROM incidents"))).scalar()
            
            # Show user details
            rows = await conn.execute(text("SELECT username, role FROM users"))
            user_list = rows.fetchall()
        await engine.dispose()
        print(f"\n  [OK] PostgreSQL")
        print(f"       Users: {users}  |  Incidents: {incidents}")
        for u in user_list:
            print(f"         - {u[0]} ({u[1]})")
    except Exception as e:
        print(f"\n  [FAIL] PostgreSQL: {e}")

    # 2. Redis
    try:
        rc = aioredis.Redis(host="localhost", port=6379)
        await rc.ping()
        keys = await rc.dbsize()
        await rc.aclose()
        print(f"\n  [OK] Redis")
        print(f"       Keys in DB: {keys}")
    except Exception as e:
        print(f"\n  [FAIL] Redis: {e}")

    # 3. RabbitMQ
    try:
        rmq = await aio_pika.connect_robust("amqp://guest:guest@localhost/")
        channel = await rmq.channel()
        q1 = await channel.declare_queue("raw_signals", durable=True, passive=True)
        q2 = await channel.declare_queue("incidents", durable=True, passive=True)
        await rmq.close()
        print(f"\n  [OK] RabbitMQ")
        print(f"       raw_signals queue: {q1.declaration_result.message_count} messages")
        print(f"       incidents queue:   {q2.declaration_result.message_count} messages")
    except Exception as e:
        print(f"\n  [FAIL] RabbitMQ: {e}")

    # 4. MongoDB
    try:
        client = AsyncIOMotorClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)
        db = client["ims_data_lake"]
        collections = await db.list_collection_names()
        count = await db["raw_signals"].count_documents({}) if "raw_signals" in collections else 0
        client.close()
        print(f"\n  [OK] MongoDB")
        print(f"       Collections: {collections}")
        print(f"       Raw signals stored: {count}")
    except Exception as e:
        print(f"\n  [FAIL] MongoDB: {e}")

    # 5. Backend API
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:8000/health", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                data = await resp.json()
                print(f"\n  [OK] Backend API (port 8000)")
                print(f"       Status: {data.get('status')}")
    except ImportError:
        import urllib.request
        try:
            req = urllib.request.urlopen("http://localhost:8000/health", timeout=3)
            print(f"\n  [OK] Backend API (port 8000)")
        except Exception as e:
            print(f"\n  [FAIL] Backend API: {e}")
    except Exception as e:
        print(f"\n  [FAIL] Backend API: {e}")

    # 6. Frontend
    try:
        import urllib.request
        req = urllib.request.urlopen("http://localhost:5137", timeout=3)
        print(f"\n  [OK] Frontend (port 5137)")
    except Exception as e:
        print(f"\n  [FAIL] Frontend: {e}")

    print("\n" + "=" * 50)

if __name__ == "__main__":
    asyncio.run(check_all())
