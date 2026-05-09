// Invitation service.
//
// Phase A / Phase B locks reflected here:
//   - Manager cannot create invitations (Phase A §15). Only Admin may
//     POST. Listing and cancelling are also Admin-only.
//   - Invitations carry a single role (Viewer/Editor/Manager/Admin)
//     and an optional team. The team must belong to the same org.
//   - The token format follows Step 4: 32 random bytes (base64url),
//     sha256-hashed in storage. Raw token is delivered in the email
//     body and never persisted. The `accept` flow re-hashes the
//     incoming token and looks up by the hash.
//   - Accept flow:
//       * caller must be logged in (Active user)
//       * caller's email must match the invitation's email
//         (case-insensitive)
//       * caller must not already have another active membership
//       * invitation must be Pending and not expired
//     On success: create membership (status = Active), set the
//     invitation to Accepted with `acceptedAt = now`.

import { generateToken, hashToken } from "@notive/auth";
import type { Invitation, Membership, PrismaClient, RoleCode, User } from "@notive/db";
import { type MailAdapter, buildInvitationMessage } from "@notive/mail";
import { Errors, requireActiveUser, requireAdmin, requireMembership } from "@notive/permissions";
import { z } from "zod";

import { Actions, recordActivity } from "../audit";

export const createInvitationInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["Viewer", "Editor", "Manager", "Admin"]),
  teamId: z.string().uuid().optional().nullable(),
});

export const acceptInvitationInputSchema = z.object({
  token: z.string().min(1),
});

export interface InvitationOptions {
  appBaseUrl: string;
  ttlDays: number;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  /** Raw token returned to the caller for tests; NOT echoed by route. */
  token: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createInvitation(
  prisma: PrismaClient,
  mail: MailAdapter,
  actingUser: Pick<User, "id" | "name">,
  organizationId: string,
  rawInput: unknown,
  opts: InvitationOptions,
): Promise<CreateInvitationResult> {
  const acting = await requireMembership(prisma, actingUser.id, organizationId);
  // Phase A §15: Manager cannot invite. Only Admin may create invitations.
  requireAdmin(acting, "manager_cannot_invite");
  const parsed = createInvitationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const email = normalizeEmail(parsed.data.email);

  if (parsed.data.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: parsed.data.teamId, organizationId, deletedAt: null },
    });
    if (!team) {
      throw Errors.notFound();
    }
  }
  // Reject if a Pending invitation already exists for the same email
  // in this org.
  const existing = await prisma.invitation.findFirst({
    where: { organizationId, email, status: "Pending" },
  });
  if (existing) {
    throw Errors.conflict("invitation_pending");
  }
  // Reject if the email already corresponds to an Active member.
  const alreadyMember = await prisma.membership.findFirst({
    where: {
      organizationId,
      status: "Active",
      deletedAt: null,
      user: { email },
    },
  });
  if (alreadyMember) {
    throw Errors.conflict("already_in_organization");
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw Errors.notFound();
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + opts.ttlDays * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email,
      role: parsed.data.role as RoleCode,
      teamId: parsed.data.teamId ?? null,
      invitedByUserId: actingUser.id,
      tokenHash,
      expiresAt,
    },
  });
  await mail.send(
    buildInvitationMessage({
      appBaseUrl: opts.appBaseUrl,
      email,
      organizationName: org.name,
      inviterName: actingUser.name,
      token,
      ttlDays: opts.ttlDays,
    }),
  );
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUser.id,
    action: Actions.INVITATION_CREATED,
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email, role: invitation.role },
  });
  return { invitation, token };
}

export async function listInvitations(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
): Promise<Invitation[]> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  return prisma.invitation.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function cancelInvitation(
  prisma: PrismaClient,
  actingUserId: string,
  organizationId: string,
  invitationId: string,
): Promise<Invitation> {
  const acting = await requireMembership(prisma, actingUserId, organizationId);
  requireAdmin(acting);
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, organizationId },
  });
  if (!invitation) {
    throw Errors.notFound();
  }
  if (invitation.status !== "Pending") {
    throw Errors.conflict("invitation_not_pending");
  }
  const cancelled = await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: "Revoked" },
  });
  await recordActivity(prisma, {
    organizationId,
    actorUserId: actingUserId,
    action: Actions.INVITATION_CANCELLED,
    targetType: "invitation",
    targetId: cancelled.id,
    metadata: { email: cancelled.email, role: cancelled.role },
  });
  return cancelled;
}

export interface AcceptInvitationResult {
  membership: Membership;
  invitation: Invitation;
}

export async function acceptInvitation(
  prisma: PrismaClient,
  actingUser: Pick<User, "id" | "email" | "status">,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<AcceptInvitationResult> {
  // Session validation already requires Active; defense-in-depth here.
  requireActiveUser(actingUser);
  const parsed = acceptInvitationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Errors.invalid("invalid token");
  }
  const tokenHash = hashToken(parsed.data.token);
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash } });
  // Use NOT_FOUND for unknown tokens — we do not confirm whether a
  // token ever existed.
  if (!invitation) {
    throw Errors.notFound();
  }
  if (invitation.status !== "Pending") {
    throw Errors.forbidden("invitation_not_pending");
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    // Mark Expired as a side effect, then surface the error.
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "Expired" },
    });
    throw Errors.forbidden("invitation_expired");
  }
  if (invitation.email.toLowerCase() !== actingUser.email.toLowerCase()) {
    // Hide token discovery: respond with NOT_FOUND so a wrong-account
    // accept attempt cannot confirm the token exists.
    throw Errors.notFound();
  }

  // 1 user = 1 active membership.
  const otherActive = await prisma.membership.findFirst({
    where: { userId: actingUser.id, status: "Active", deletedAt: null },
  });
  if (otherActive) {
    throw Errors.conflict("already_in_organization");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to close the race window.
    const fresh = await tx.invitation.findUnique({ where: { id: invitation.id } });
    if (!fresh || fresh.status !== "Pending") {
      throw Errors.forbidden("invitation_not_pending");
    }
    const membership = await tx.membership.create({
      data: {
        userId: actingUser.id,
        organizationId: invitation.organizationId,
        teamId: invitation.teamId,
        role: invitation.role,
        status: "Active",
      },
    });
    const updated = await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "Accepted", acceptedAt: now },
    });
    return { membership, invitation: updated };
  });
  await recordActivity(prisma, {
    organizationId: result.invitation.organizationId,
    actorUserId: actingUser.id,
    action: Actions.INVITATION_ACCEPTED,
    targetType: "membership",
    targetId: result.membership.id,
    metadata: {
      invitationId: result.invitation.id,
      role: result.membership.role,
    },
  });
  return result;
}
