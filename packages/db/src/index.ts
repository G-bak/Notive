// Prisma client wrapper.
//
// The Prisma client is a singleton — re-instantiating it per request
// drains the connection pool. We export one process-global client.
//
// Per Phase B doc §13.5: this package is the only place that imports
// `@prisma/client` directly. App code must depend on `@notive/db`.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __notivePrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__notivePrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__notivePrisma = prisma;
}

// Re-export the Prisma namespace and error types so consumers do not
// need to depend on `@prisma/client` directly.
export { Prisma, PrismaClient } from "@prisma/client";
export type {
  User,
  Session,
  Invitation,
  Organization,
  Team,
  Role,
  Membership,
  OrganizationSetting,
  ActivityLog,
  UserStatus,
  OrganizationStatus,
  TeamStatus,
  MembershipStatus,
  InvitationStatus,
  RoleCode,
  ActivityResult,
  Document,
  DocumentVersion,
  DocumentShare,
  DocumentTag,
  DocumentTagLink,
  DocumentFavorite,
  DocumentViewHistory,
  DocumentStatus,
  DocumentVisibility,
  DocumentSourceType,
  DocumentShareTargetType,
  DocumentSharePermission,
} from "@prisma/client";

export { isLastAdminProtectionError, LAST_ADMIN_PROTECTION_PREFIX } from "./prisma-error-codes.js";
