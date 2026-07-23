-- Enforces "at most one non-CLOSED work item per component" at the
-- database level — this is the correctness backstop for the debouncer
-- (src/services/ingestion/debouncer.ts): even if the Redis fast path is
-- unavailable, stale, or simply loses a race, two concurrent attempts to
-- create a work item for the same component can never both succeed.
-- Not representable in schema.prisma (partial/filtered indexes aren't
-- expressible in the Prisma schema DSL), so this is a hand-written,
-- --create-only migration.
CREATE UNIQUE INDEX "idx_work_items_active_component_id" ON "work_items"("component_id") WHERE "state" != 'CLOSED'::"WorkItemStatus";