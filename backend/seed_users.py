import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from api.models import Base, User, UserRole
from api.auth import hash_password

DATABASE_URL = "postgresql+asyncpg://admin:password@localhost:5432/ims_db"
engine = create_async_engine(DATABASE_URL, echo=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def seed_users():
    # Ensure the users table exists
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        async with session.begin():
            # Create Admin Account
            admin = User(
                id="usr-adm1",
                username="admin_sre",
                hashed_password=hash_password("admin123"),
                role=UserRole.ADMIN
            )
            # Create Standard SRE Account
            sre = User(
                id="usr-sre1",
                username="junior_sre",
                hashed_password=hash_password("sre123"),
                role=UserRole.SRE_USER
            )
            
            session.add_all([admin, sre])
        print("Successfully seeded database with admin_sre (admin123) and junior_sre (sre123)!")

if __name__ == "__main__":
    asyncio.run(seed_users())