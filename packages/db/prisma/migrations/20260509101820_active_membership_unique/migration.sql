-- Active membership uniqueness across organizations.
--
-- Phase A §15 / Phase B doc §11.3: in MVP a user has exactly one active
-- membership across all organizations. The (user_id, organization_id)
-- composite unique on memberships only blocks duplicates within the
-- same organization. To block duplicates across organizations we add
-- a partial unique on user_id where the membership row is currently
-- Active and not soft-deleted.
--
-- Prisma does not support partial unique indexes in schema.prisma, so
-- this migration is hand-authored.

CREATE UNIQUE INDEX "uniq_active_membership_per_user"
ON "memberships" ("user_id")
WHERE "status" = 'Active' AND "deleted_at" IS NULL;
