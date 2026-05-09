-- Phase B step 4: token columns for email verification and password reset.
--
-- Single outstanding token per (user, type). Resend / re-request overwrites
-- the previous row. Only sha256 hashes are stored; raw tokens stay in
-- transit (the email body) and are never persisted.

ALTER TABLE "users"
  ADD COLUMN "email_verification_token_hash"  TEXT,
  ADD COLUMN "email_verification_expires_at"  TIMESTAMP(3),
  ADD COLUMN "password_reset_token_hash"      TEXT,
  ADD COLUMN "password_reset_expires_at"      TIMESTAMP(3);

CREATE UNIQUE INDEX "users_email_verification_token_hash_key"
  ON "users" ("email_verification_token_hash");

CREATE UNIQUE INDEX "users_password_reset_token_hash_key"
  ON "users" ("password_reset_token_hash");
