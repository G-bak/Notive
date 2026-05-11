-- Phase D Step 1: AI request / result / reference / usage-log tables.
--
-- Source: docs/database/notive-database-design-v1.0.md §9 and
-- docs/implementation/notive-implementation-plan-d-ai-document-generation-v1.0.md §7.
--
-- Body-retention policy (Phase A §15 / docs/ai/notive-ai-generation-
-- policy-v1.0.md §12):
--   ai_requests and ai_results store METADATA ONLY. There is no
--   request_text, prompt, content, or response column. Body text lives
--   in session-bound short-term storage (Redis); persisted bodies are
--   moved into the `documents` table at explicit user save. The
--   opt-in `ai_request_payloads` 30-day table is deferred to a later
--   Phase D step.
--
-- Organization-boundary integrity:
--   * ai_requests has a composite UNIQUE (id, organization_id) so
--     ai_results / ai_references can declare composite FKs against
--     (ai_request_id, organization_id) → ai_requests(id, organization_id)
--     and Postgres rejects cross-org mixes at the DB layer (same
--     pattern as documents in Phase C).
--   * ai_usage_logs is a sibling table, not parent-child — it declares a
--     single-column FK on ai_request_id with SetNull so usage history
--     survives the 90-day metadata cleanup for billing / quality
--     analysis (DB design §15.2).
--
-- documents.ai_request_id FK:
--   The column was reserved in Phase C as a bare UUID. Phase D step 1
--   adds a single-column FK → ai_requests(id) with onDelete SET NULL so
--   the 90-day cleanup of ai_requests does not cascade-delete the
--   documents they generated. Cross-org integrity for ai_request_id is
--   enforced at the service layer (same pattern as documents.owner_user_id).
--   A composite FK was rejected because Prisma / Postgres SetNull cannot
--   null a composite column where one side (organization_id) is NOT NULL.

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('Pending', 'Processing', 'Completed', 'Failed', 'Cancelled');

-- CreateEnum
CREATE TYPE "AiResultStatus" AS ENUM ('Generated', 'Selected', 'Saved', 'Discarded', 'Failed');

-- CreateEnum
CREATE TYPE "AiReferenceTargetType" AS ENUM ('Document', 'Template', 'DiaryEntry', 'Todo');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('Success', 'Failed', 'Cancelled');

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "document_type" TEXT NOT NULL,
    "template_id" UUID,
    "purpose" TEXT,
    "audience" TEXT,
    "tone" TEXT,
    "status" "AiRequestStatus" NOT NULL DEFAULT 'Pending',
    "error_code" TEXT,
    "latency_ms" INTEGER,
    "token_count_input" INTEGER,
    "token_count_output" INTEGER,
    "result_saved" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_results" (
    "id" UUID NOT NULL,
    "ai_request_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "AiResultStatus" NOT NULL DEFAULT 'Generated',
    "saved_document_id" UUID,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_references" (
    "id" UUID NOT NULL,
    "ai_request_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target_type" "AiReferenceTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "target_title" TEXT,
    "access_allowed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "ai_request_id" UUID,
    "document_type" TEXT NOT NULL,
    "status" "AiUsageStatus" NOT NULL,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_requested_by_user_id_created_a_idx" ON "ai_requests"("organization_id", "requested_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_status_idx" ON "ai_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_id_organization_id_key" ON "ai_requests"("id", "organization_id");

-- CreateIndex
CREATE INDEX "ai_results_ai_request_id_idx" ON "ai_results"("ai_request_id");

-- CreateIndex
CREATE INDEX "ai_results_organization_id_status_idx" ON "ai_results"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ai_references_ai_request_id_target_type_target_id_idx" ON "ai_references"("ai_request_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "ai_references_organization_id_target_type_idx" ON "ai_references"("organization_id", "target_type");

-- CreateIndex
CREATE INDEX "ai_usage_logs_organization_id_created_at_idx" ON "ai_usage_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_organization_id_user_id_idx" ON "ai_usage_logs"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_ai_request_id_organization_id_fkey" FOREIGN KEY ("ai_request_id", "organization_id") REFERENCES "ai_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Composite FK on (saved_document_id, organization_id) → documents.
-- Forces an ai_result's saved-document pointer to share its
-- organization. Hard delete of a referenced document is not the normal
-- path (Phase C documents use status=Deleted + deletedAt); NoAction
-- blocks an accidental hard delete that would orphan this pointer, and
-- the application is expected to null saved_document_id first before
-- any operational hard delete (same contract as documents.owner_team_id).
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_saved_document_id_organization_id_fkey" FOREIGN KEY ("saved_document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_references" ADD CONSTRAINT "ai_references_ai_request_id_organization_id_fkey" FOREIGN KEY ("ai_request_id", "organization_id") REFERENCES "ai_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_references" ADD CONSTRAINT "ai_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_ai_request_id_fkey" FOREIGN KEY ("ai_request_id") REFERENCES "ai_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ai_request_id_fkey" FOREIGN KEY ("ai_request_id") REFERENCES "ai_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
