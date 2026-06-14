import enum
import os
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Text
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    SRE_USER = "SRE_USER"

# 1. Database Connection Setup
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/ims_db")

engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()

# 2. State Pattern Enum
class IncidentState(str, enum.Enum):
    OPEN = "OPEN"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"

# 3. The Work Item (Incident) Table
class Incident(Base):
    __tablename__ = "incidents"

    id = Column(String, primary_key=True, index=True) # E.g., INC-CACHE_CLUSTER_01
    component_id = Column(String, nullable=False)
    severity = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    state = Column(Enum(IncidentState), default=IncidentState.OPEN, nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    # Relationship to the RCA table
    rca = relationship("RCA", back_populates="incident", uselist=False)

# 4. The Root Cause Analysis (RCA) Table
class RCA(Base):
    __tablename__ = "rcas"

    id = Column(String, primary_key=True)
    incident_id = Column(String, ForeignKey("incidents.id"), unique=True, nullable=False)
    
    root_cause_category = Column(String, nullable=False)
    fix_applied = Column(Text, nullable=False)
    prevention_steps = Column(Text, nullable=False)
    
    submitted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    incident = relationship("Incident", back_populates="rca")

# Helper function to initialize the database tables
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.SRE_USER, nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))