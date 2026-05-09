-- System role uniqueness.
--
-- The schema declares roles UNIQUE(code, organization_id), but Postgres
-- treats NULLs as distinct, so multiple rows with the same code and
-- organization_id=NULL would not be blocked by that constraint. Add a
-- partial unique to enforce "exactly one system role per code":
--
--   - System roles: organization_id IS NULL → only one row per code.
--   - Custom org-level roles (post-MVP): organization_id IS NOT NULL →
--     covered by the existing UNIQUE(code, organization_id).
--
-- Phase B seeds the four system roles (Viewer / Editor / Manager / Admin).

CREATE UNIQUE INDEX "uniq_system_role_code"
ON "roles" ("code")
WHERE "organization_id" IS NULL;
