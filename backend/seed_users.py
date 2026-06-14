import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from api.models import Base, User, UserRole
from api.auth import hash_password

import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/ims_db")
engine = create_async_engine(DATABASE_URL, echo=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def seed_users():
    # Ensure the users table exists
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        async with session.begin():
            # Check and seed admin
            res_admin = await session.execute(select(User).where(User.username == "admin_sre"))
            if not res_admin.scalars().first():
                admin = User(
                    id="usr-adm1",
                    username="admin_sre",
                    hashed_password=hash_password("admin123"),
                    role=UserRole.ADMIN
                )
                session.add(admin)
                print("Seeded user: admin_sre (admin123)")
            else:
                print("User admin_sre already exists. Skipping.")

            # Check and seed junior_sre
            res_sre = await session.execute(select(User).where(User.username == "junior_sre"))
            if not res_sre.scalars().first():
                sre = User(
                    id="usr-sre1",
                    username="junior_sre",
                    hashed_password=hash_password("sre123"),
                    role=UserRole.SRE_USER
                )
                session.add(sre)
                print("Seeded user: junior_sre (sre123)")
            else:
                print("User junior_sre already exists. Skipping.")

if __name__ == "__main__":
    asyncio.run(seed_users())