# 🛠️ InveniOps: Mission-Critical SRE Incident Management System (IMS)

InveniOps is a SRE incident ingestion, debouncing, and tracking platform designed to mitigate alert fatigue in high-throughput environments. It features a real-time dark-mode command center, automated alert deduplication, asynchronous worker queues, a dual-database storage paradigm (relational data warehouse + raw data lake), Prometheus metrics, and automated AWS cloud deployment configurations.

---

## 📐 System Architecture & Data Flow

```mermaid
graph TD
    %% Clients & Sources
    subgraph Signal Sources
        L[generate_load.py] -->|1. Ingest Alerts| API[FastAPI Ingestion Engine]
        A[External Alerts / Prometheus] -->|1. Ingest Alerts| API
    end

    %% Ingestion API & Cache
    subgraph Core API (FastAPI)
        API -->|2. Check Duplicates| Redis[(Redis Debouncer)]
        Redis -.->|Debounce < 10s| API
        API -->|3. Route Raw Signal| RMQ[RabbitMQ Message Broker]
    end

    %% Messaging & Processing Layer
    subgraph Message Broker (RabbitMQ)
        RMQ -->|raw_signals queue| MW[MongoDB Data Lake Worker]
        RMQ -->|incidents queue| PW[PostgreSQL Incident Worker]
    end

    %% Storage Paradigm
    subgraph Database Layer
        MW -->|4a. Insert Raw Log| Mongo[(MongoDB Data Lake)]
        PW -->|4b. Create Incident Ticket| Postgres[(PostgreSQL DB)]
    end

    %% SRE Access
    subgraph SRE Control Room
        FE[React/Vite Dashboard] -->|Get Tickets| API
        API -->|Query Relational Data| Postgres
        FE -->|Submit RCA & Close Ticket| API
        API -->|Write RCA / Close Status| Postgres
    end

    %% Monitoring
    subgraph Observability
        Prom[Prometheus] -->|Scrape Metrics| API
        Graf[Grafana] -->|Query Visualizations| Prom
    end

    classDef database fill:#1e293b,stroke:#00f0ff,stroke-width:1px,color:#fff;
    classDef worker fill:#0f172a,stroke:#3b82f6,stroke-width:1px,color:#fff;
    classDef broker fill:#2d1a3c,stroke:#a855f7,stroke-width:1px,color:#fff;
    classDef client fill:#090d16,stroke:#10b981,stroke-width:1px,color:#fff;
    
    class Redis,Mongo,Postgres database;
    class MW,PW worker;
    class RMQ broker;
    class L,A,FE client;
```

### System Data Flows:
1. **Raw Log Ingestion**: All incoming signals to `/ingest` are published to the RabbitMQ `raw_signals` queue immediately and consumed by the `MongoDB Worker` to be stored in the **MongoDB Data Lake** (`ims_data_lake.raw_signals`) for auditing and diagnostics.
2. **Debouncing Mechanism**: The FastAPI API uses **Redis** to debounce signals by generating a key `debounce:{component_id}` with a **10-second TTL (Time To Live)**. 
   - If the key exists, the signal is debounced and acknowledged with `accepted / signal debounced`.
   - If the key does not exist (first signal or key expired), a new incident message is published to the RabbitMQ `incidents` queue. The `PostgreSQL Worker` then consumes this message and inserts a new incident ticket with state `OPEN` in the **PostgreSQL Database**.

---

## ⚡ Tech Stack & Technologies

- **Backend**: FastAPI (Python), SQLAlchemy, Asyncpg (Async Postgres driver), Motor (Async MongoDB driver), Redis-py, Aio-pika (RabbitMQ client), SlowAPI (Rate limiting).
- **Frontend**: React, Vite, Tailwind CSS, Recharts (SRE metrics visualization), Lucide React (Icons), Shadcn/ui (UI primitives).
- **Infrastructure & Broker**: RabbitMQ (Management console enabled), PostgreSQL, MongoDB, Redis.
- **Monitoring & Metrics**: Prometheus (FastAPI Instrumentator), Grafana.
- **Infrastructure as Code**: Terraform (AWS EC2 & automated security group firewall deployment).

---

## 📂 Repository Structure

```text
├── backend/
│   ├── api/
│   │   ├── auth.py              # JWT authentication & SRE RBAC guards
│   │   ├── main.py              # Ingestion API, routes, and health checks
│   │   └── models.py            # PostgreSQL SQLAlchemy models (Incident, RCA, User)
│   ├── workers/
│   │   ├── mongodb_worker.py    # Raw log database worker
│   │   └── postgres_worker.py   # Debounced incident ticket worker
│   ├── requirements.txt         # Backend Python dependencies
│   ├── reset_users.py           # Database clean & user re-seed script
│   └── seed_users.py            # Database tables setup & user seed script
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx    # Real-time SRE Command Center UI
│   │   │   └── Login.jsx        # Operator authentication screen
│   │   ├── context/
│   │   │   └── AuthContext.jsx  # LocalStorage-backed auth context
│   │   ├── services/
│   │   │   └── api.js           # API fetch wrappers
│   │   ├── App.jsx              # Routing & Application Entry
│   │   └── index.css            # Dark mode variables & Tailwind styling
│   └── Dockerfile               # Node builder -> Nginx production config
├── ims-terraform/
│   └── main.tf                  # AWS VPC, Subnet, Security Group & EC2 template
├── prometheus.yml               # Scrape configurations targeting the FastAPI backend
├── docker-compose.yml           # Multi-service orchestration configurations
└── generate_load.py             # SRE simulated load & debouncer testing script
```

---

## 🔑 Role-Based Access Control (RBAC) & SRE Profiles

Authentication is enforced via JWT signatures. The database seeds with two default roles:

| Username | Password | Role | Privileges |
| :--- | :--- | :--- | :--- |
| `admin_sre` | `admin123` | **ADMIN** | Can view incidents, acknowledge alerts, **submit RCAs, and close tickets**. |
| `junior_sre` | `sre123` | **SRE_USER** | Can view incidents and acknowledge alerts. Cannot close tickets. |

---

## 🚀 Getting Started

### Method 1: Running with Docker Compose (Quick Start)

Deploy the entire InveniOps environment, including all datastores, workers, monitoring agents, and hot-reloading frontend/backend, with a single command:

1. **Start all containers**:
   ```bash
   docker-compose up --build -d
   ```
2. **Seed/Reset SRE User Credentials**:
   ```bash
   # Run the reset script inside the API container to establish SRE profiles
   docker-compose exec api python -m reset_users
   ```
3. **Verify running services**:
   ```bash
   docker-compose ps
   ```

---

### Method 2: Manual Local Setup (Development Mode)

If you wish to run components individually in a virtual environment without Dockerizing the backend/frontend:

#### 1. Start Datastores (via Docker or local services)
Ensure PostgreSQL, MongoDB, Redis, and RabbitMQ are running locally. You can spin up only the datastores using:
```bash
docker-compose up postgres mongodb redis rabbitmq -d
```

#### 2. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   # On Windows (PowerShell)
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # On Linux/macOS
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run migrations and seed users:
   ```bash
   python -m seed_users
   ```
5. Start the FastAPI backend:
   ```bash
   uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
   ```

#### 3. Run workers in separate terminals (with activated venv):
- **PostgreSQL Ticket Worker**:
  ```bash
  python -m workers.postgres_worker
  ```
- **MongoDB Data Lake Worker**:
  ```bash
  python -m workers.mongodb_worker
  ```

#### 4. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run dev
   ```
   Access the app at `http://localhost:5137`.

---

## 📊 SRE Load Simulation & Debounce Verification

To verify that the ingestion pipeline, Redis debouncing engine, and async workers are processing alerts properly, run the simulated incident generator script:

```bash
python generate_load.py
```

### What this script tests:
1. **Phase 1: Redis Debouncer Check**: Sends 5 identical `DB_PRIMARY` alerts in rapid succession (0.2s interval).
   - *Expected Result*: 1 new incident is created in PostgreSQL; 4 are debounced (Redis TTL key prevents duplicates). MongoDB, however, records all 5 raw alerts.
2. **Phase 2: Multiple Unique Alerts**: Sends different alerts for `REDIS_CACHE`, `AUTH_SERVICE`, and `PAYMENT_GATEWAY`.
   - *Expected Result*: Because they represent unique components, each triggers a new PostgreSQL incident ticket.
3. **Phase 3: Expiry Check**: Waits 11 seconds for the Redis TTL debounce key to expire, then sends a `DB_PRIMARY` alert.
   - *Expected Result*: A new PostgreSQL incident ticket is created.

---

## 📡 Port & Console Directory

Once up and running, you can access the various control consoles at:

| Service / Console | URL / Endpoint | Port | Default Credentials |
| :--- | :--- | :--- | :--- |
| **InveniOps SRE Dashboard** | `http://localhost:5137` | `5137` | Use `admin_sre` / `admin123` |
| **FastAPI Swagger Docs** | `http://localhost:8000/docs` | `8000` | N/A |
| **Prometheus Server** | `http://localhost:9090` | `9090` | N/A |
| **Grafana Dashboard** | `http://localhost:3000` | `3000` | `admin` / `admin` |
| **RabbitMQ Management** | `http://localhost:15672` | `15672` | `guest` / `guest` |
| **PostgreSQL Database** | `localhost:5432` | `5432` | DB: `ims_db`, User: `postgres`, Pass: `postgres` |
| **MongoDB Database** | `localhost:27017` | `27017` | DB: `ims_data_lake` |

---

## 🧱 Production Provisioning (Terraform)

The `ims-terraform` folder contains configuration to deploy this environment to AWS.

### Resources Provisioned:
- **AWS Security Group**: Automates opening standard ports for SSH (`22`), Web (`80`), Grafana (`3000`), React (`5137`), FastAPI (`8000`), Prometheus (`9090`), and RabbitMQ Management (`15672`).
- **AWS Subnet & Instance**: Launches a `t3.small` instance running Ubuntu 24.04.
- **EBS Volume Expansion**: Configures 16GB gp3 root volume to prevent SRE log storage issues.

### Deployment steps:
1. Ensure AWS CLI is configured with credentials and target SSH key `ims-prod-key` exists in your AWS region.
2. Navigate to the terraform directory:
   ```bash
   cd ims-terraform
   ```
3. Initialize Terraform:
   ```bash
   terraform init
   ```
4. Preview and apply changes:
   ```bash
   terraform apply
   ```
5. Note the output `server_public_ip` to target your deployment scripts.