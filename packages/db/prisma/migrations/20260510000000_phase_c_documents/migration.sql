-- Phase C Step 1: document tables.
--
-- Source: docs/database/notive-database-design-v1.0.md §7 + §14.2.
-- Adds documents, document_versions, document_shares, document_tags,
-- document_tag_links, document_favorites, document_view_histories
-- and the supporting enums.
--
-- Phase A §15: Department share scope is folded into Team. The
-- DocumentVisibility / DocumentShareTargetType enums therefore have
-- no Department member.
--
-- Organization-boundary integrity:
-- * documents has a composite UNIQUE on (id, organization_id).
-- * document_tags has a composite UNIQUE on (id, organization_id).
-- * teams gets a composite UNIQUE on (id, organization_id) added so
--   documents.owner_team can FK against (id, organization_id).
-- * document_versions / document_shares / document_tag_links /
--   document_favorites / document_view_histories declare composite
--   FKs on (document_id, organization_id) → documents(id, organization_id).
-- * document_tag_links additionally declares (tag_id, organization_id)
--   → document_tags(id, organization_id).
-- * documents.owner_team_id + organization_id → teams(id, organization_id)
--   uses NoAction because SetNull on a composite FK is invalid when
--   organization_id is NOT NULL. Teams are normally soft-deleted via
--   deletedAt; on a hard team delete the application is responsible
--   for nulling owner_team_id first.
--
-- documents.template_id and documents.ai_request_id are reserved
-- columns for Phase D (templates, ai_requests). They are nullable
-- UUIDs without a foreign key in this migration; Phase D adds the
-- FKs in a forward-only migration.

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Draft', 'Active', 'Archived', 'Deleted');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('Private', 'Team', 'Organization', 'SpecificUsers');

-- CreateEnum
CREATE TYPE "DocumentSourceType" AS ENUM ('Manual', 'AI', 'Imported');

-- CreateEnum
CREATE TYPE "DocumentShareTargetType" AS ENUM ('User', 'Team', 'Organization');

-- CreateEnum
CREATE TYPE "DocumentSharePermission" AS ENUM ('View', 'Edit', 'Manage');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "document_type" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Draft',
    "owner_user_id" UUID,
    "author_user_id" UUID,
    "owner_team_id" UUID,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'Private',
    "source_type" "DocumentSourceType" NOT NULL DEFAULT 'Manual',
    "template_id" UUID,
    "ai_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title_snapshot" TEXT NOT NULL,
    "content_snapshot" TEXT NOT NULL,
    "changed_by_user_id" UUID,
    "change_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_shares" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target_type" "DocumentShareTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "permission" "DocumentSharePermission" NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tag_links" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_view_histories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_view_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_organization_id_status_idx" ON "documents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "documents_organization_id_visibility_idx" ON "documents"("organization_id", "visibility");

-- CreateIndex
CREATE INDEX "documents_organization_id_owner_user_id_idx" ON "documents"("organization_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_owner_team_id_idx" ON "documents"("organization_id", "owner_team_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_document_type_idx" ON "documents"("organization_id", "document_type");

-- CreateIndex
CREATE INDEX "documents_organization_id_updated_at_idx" ON "documents"("organization_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_organization_id_key" ON "documents"("id", "organization_id");

-- CreateIndex
CREATE INDEX "document_versions_organization_id_document_id_idx" ON "document_versions"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "document_shares_organization_id_target_type_target_id_idx" ON "document_shares"("organization_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_shares_document_id_target_type_target_id_key" ON "document_shares"("document_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_id_organization_id_key" ON "document_tags"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_organization_id_name_key" ON "document_tags"("organization_id", "name");

-- CreateIndex
CREATE INDEX "document_tag_links_organization_id_tag_id_idx" ON "document_tag_links"("organization_id", "tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tag_links_document_id_tag_id_key" ON "document_tag_links"("document_id", "tag_id");

-- CreateIndex
CREATE INDEX "document_favorites_organization_id_user_id_idx" ON "document_favorites"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_favorites_user_id_document_id_key" ON "document_favorites"("user_id", "document_id");

-- CreateIndex
CREATE INDEX "document_view_histories_organization_id_user_id_viewed_at_idx" ON "document_view_histories"("organization_id", "user_id", "viewed_at");

-- CreateIndex
CREATE INDEX "document_view_histories_document_id_idx" ON "document_view_histories"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_organization_id_key" ON "teams"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_team_id_organization_id_fkey" FOREIGN KEY ("owner_team_id", "organization_id") REFERENCES "teams"("id", "organization_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tag_links" ADD CONSTRAINT "document_tag_links_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tag_links" ADD CONSTRAINT "document_tag_links_tag_id_organization_id_fkey" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "document_tags"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tag_links" ADD CONSTRAINT "document_tag_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_view_histories" ADD CONSTRAINT "document_view_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_view_histories" ADD CONSTRAINT "document_view_histories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_view_histories" ADD CONSTRAINT "document_view_histories_document_id_organization_id_fkey" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
