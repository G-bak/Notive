// Helpers for detecting database-level errors raised by our triggers.
//
// The last_admin_protection trigger (see migration of the same name)
// raises a Postgres exception with a known message prefix when an
// operation would leave an organization without an active Admin. The
// application layer catches the error here and translates it to the
// FORBIDDEN(last_admin_protection) response defined in
// docs/security/notive-permission-policy-v1.0.md §15 / Phase B §9.6.

import { Prisma } from "@prisma/client";

/// Message prefix raised by the last_admin_protection trigger.
export const LAST_ADMIN_PROTECTION_PREFIX = "NTV-LAST-ADMIN:";

/**
 * Returns true when the given error originated from the
 * last_admin_protection trigger. Pass any thrown value; non-error
 * values short-circuit to false.
 */
export function isLastAdminProtectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  // Prisma's known request error wraps the Postgres message.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const message =
      typeof error.meta === "object" && error.meta && "message" in error.meta
        ? String((error.meta as { message: unknown }).message)
        : error.message;
    return message.includes(LAST_ADMIN_PROTECTION_PREFIX);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes(LAST_ADMIN_PROTECTION_PREFIX);
  }

  // Raw error pattern when the client raises directly.
  if ("message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message.includes(LAST_ADMIN_PROTECTION_PREFIX);
  }

  return false;
}
