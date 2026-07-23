-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('API', 'MCP_HOST', 'CACHE', 'QUEUE', 'RDBMS', 'NOSQL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RootCauseCategory" AS ENUM ('CODE_DEFECT', 'INFRASTRUCTURE_FAILURE', 'CONFIGURATION_ERROR', 'CAPACITY_EXHAUSTION', 'EXTERNAL_DEPENDENCY', 'NETWORK', 'HUMAN_ERROR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_type" "ComponentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "state" "WorkItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "first_signal_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "signal_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_records" (
    "id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "incident_start_time" TIMESTAMP(3) NOT NULL,
    "incident_end_time" TIMESTAMP(3) NOT NULL,
    "root_cause_category" "RootCauseCategory" NOT NULL,
    "root_cause_description" TEXT NOT NULL,
    "fix_applied" TEXT NOT NULL,
    "prevention_steps" TEXT NOT NULL,
    "mttr_seconds" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rca_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_transitions" (
    "id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "from_state" "WorkItemStatus" NOT NULL,
    "to_state" "WorkItemStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_work_items_active_feed" ON "work_items"("state", "severity", "first_signal_at");

-- CreateIndex
CREATE INDEX "idx_work_items_component_window" ON "work_items"("component_id", "first_signal_at");

-- CreateIndex
CREATE UNIQUE INDEX "rca_records_work_item_id_key" ON "rca_records"("work_item_id");

-- CreateIndex
CREATE INDEX "idx_state_transitions_work_item" ON "state_transitions"("work_item_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "rca_records" ADD CONSTRAINT "rca_records_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
