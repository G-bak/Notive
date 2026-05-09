import { prisma } from "@notive/db";

let counter = 0;

export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export async function createUser(name = "user"): Promise<{ id: string; email: string }> {
  const suffix = uniqueSuffix();
  const u = await prisma.user.create({
    data: {
      name: `${name} ${suffix}`,
      email: `${name}-${suffix}@example.test`,
      passwordHash: "x",
      status: "Active",
      emailVerifiedAt: new Date(),
    },
  });
  return { id: u.id, email: u.email };
}

export async function createOrganization(creatorId: string, slugHint = "org"): Promise<string> {
  const suffix = uniqueSuffix();
  const o = await prisma.organization.create({
    data: {
      name: `Org ${suffix}`,
      slug: `${slugHint}-${suffix}`,
      createdByUserId: creatorId,
    },
  });
  return o.id;
}

export async function createTeam(orgId: string, nameHint = "team"): Promise<string> {
  const suffix = uniqueSuffix();
  const t = await prisma.team.create({
    data: {
      organizationId: orgId,
      name: `${nameHint}-${suffix}`,
    },
  });
  return t.id;
}

export async function createMembership(opts: {
  userId: string;
  organizationId: string;
  teamId?: string | null;
  role?: "Viewer" | "Editor" | "Manager" | "Admin";
  status?: "Active" | "Invited" | "Disabled" | "Removed";
}): Promise<string> {
  const m = await prisma.membership.create({
    data: {
      userId: opts.userId,
      organizationId: opts.organizationId,
      teamId: opts.teamId ?? null,
      role: opts.role ?? "Editor",
      status: opts.status ?? "Active",
    },
  });
  return m.id;
}
