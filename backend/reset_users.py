import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, delete
from api.models import Base, User, UserRole
from api.auth import hash_password

DATABASE_URL = "postgresql+asyncpg://admin:password@localhost:5432/ims_db"
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def main():
    async with AsyncSessionLocal() as session:
        # 1. Show all existing users
        result = await session.execute(select(User))
        users = result.scalars().all()
        
        print("\n=== Current Users in Database ===")
        if not users:
            print("  (no users found)")
        for u in users:
            print(f"  Username: {u.username}  |  Role: {u.role.value}  |  ID: {u.id}")
        
        # 2. Delete and re-seed
        print("\n--- Resetting users... ---")
        await session.execute(delete(User).where(User.username.in_(["admin_sre", "junior_sre"])))
        
        admin = User(
            id="usr-adm1",
            username="admin_sre",
            hashed_password=hash_password("admin123"),
            role=UserRole.ADMIN
        )
        sre = User(
            id="usr-sre1",
            username="junior_sre",
            hashed_password=hash_password("sre123"),
            role=UserRole.SRE_USER
        )
        session.add_all([admin, sre])
        await session.commit()
        
        print("\n=== Users Reset Successfully ===")
        print("  admin_sre  / admin123  (ADMIN)")
        print("  junior_sre / sre123    (SRE_USER)")
        print()

if __name__ == "__main__":
    asyncio.run(main())
