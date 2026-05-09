-- Last-Admin protection.
--
-- Phase A §15 / Phase B doc §9.3: the system rejects any operation
-- that would leave an organization without at least one Active Admin
-- membership. The four covered operations are:
--   1. demote   -- UPDATE role from 'Admin' to non-Admin
--   2. disable  -- UPDATE status from 'Active' to non-Active
--   3. remove   -- DELETE the row
--   4. transfer -- UPDATE organization_id (defensive; blocked by 1-org-per-user
--                  rule but enforced here too)
--
-- The trigger raises a Postgres exception with a known message prefix
-- (NTV-LAST-ADMIN:) that the application detects via
-- packages/db/src/prisma-error-codes.ts:isLastAdminProtectionError.
-- The application then maps it to FORBIDDEN(last_admin_protection) per
-- Codex decision in Phase B doc §9.6.
--
-- Two notes on transactional safety:
-- - The trigger is BEFORE-row, so it fires before the row leaves the
--   table; the COUNT query sees the pre-change state.
-- - The COUNT excludes the row being mutated (id <> OLD.id) so a
--   simultaneous transition where the row is itself the last admin is
--   correctly recognized as "no other admin remains".

CREATE OR REPLACE FUNCTION "check_last_admin"() RETURNS TRIGGER AS $$
DECLARE
  active_admin_count INTEGER;
  guard_org_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."role" = 'Admin' AND OLD."status" = 'Active' AND OLD."deleted_at" IS NULL THEN
      SELECT COUNT(*) INTO active_admin_count
      FROM "memberships"
      WHERE "organization_id" = OLD."organization_id"
        AND "role" = 'Admin'
        AND "status" = 'Active'
        AND "deleted_at" IS NULL
        AND "id" <> OLD."id";
      IF active_admin_count = 0 THEN
        RAISE EXCEPTION 'NTV-LAST-ADMIN: cannot remove the last active Admin of organization %', OLD."organization_id"
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Was an active Admin?
    IF OLD."role" = 'Admin' AND OLD."status" = 'Active' AND OLD."deleted_at" IS NULL THEN
      -- Demote / disable / soft-delete: the row is no longer counted as an Admin.
      IF NOT (NEW."role" = 'Admin' AND NEW."status" = 'Active' AND NEW."deleted_at" IS NULL) THEN
        SELECT COUNT(*) INTO active_admin_count
        FROM "memberships"
        WHERE "organization_id" = OLD."organization_id"
          AND "role" = 'Admin'
          AND "status" = 'Active'
          AND "deleted_at" IS NULL
          AND "id" <> OLD."id";
        IF active_admin_count = 0 THEN
          RAISE EXCEPTION 'NTV-LAST-ADMIN: cannot demote/disable/soft-delete the last active Admin of organization %', OLD."organization_id"
            USING ERRCODE = 'P0001';
        END IF;
      END IF;

      -- Transfer to a different organization (defensive — 1-user-1-org
      -- rule already blocks this at the membership-uniqueness layer).
      IF OLD."organization_id" <> NEW."organization_id" THEN
        guard_org_id := OLD."organization_id";
        SELECT COUNT(*) INTO active_admin_count
        FROM "memberships"
        WHERE "organization_id" = guard_org_id
          AND "role" = 'Admin'
          AND "status" = 'Active'
          AND "deleted_at" IS NULL
          AND "id" <> OLD."id";
        IF active_admin_count = 0 THEN
          RAISE EXCEPTION 'NTV-LAST-ADMIN: cannot transfer the last active Admin out of organization %', guard_org_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_memberships_last_admin"
  BEFORE UPDATE OR DELETE ON "memberships"
  FOR EACH ROW
  EXECUTE FUNCTION "check_last_admin"();
