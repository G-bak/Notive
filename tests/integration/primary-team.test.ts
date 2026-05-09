import { describe, it, expect } from "vitest";

import { prisma } from "@notive/db";

import { createMembership, createOrganization, createTeam, createUser } from "./src/helpers.js";

describe("primary team single-column structure (Phase A §15)", () => {
  it("stores team_id as a single column on memberships", async () => {
    const user = await createUser("pt");
    const org = await createOrganization(user.id, "ptorg");
    const team = await createTeam(org, "ptteam");

    const membershipId = await createMembership({
      userId: user.id,
      organizationId: org,
      teamId: team,
      role: "Editor",
    });

    const row = await prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(row.teamId).toBe(team);

    // Phase A §15 lock: the schema has exactly one team_id column. There
    // is no membership_teams join table in MVP — verifying it is absent
    // catches accidental drift if someone added it later.
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.map((t) => t.table_name);
    expect(names).not.toContain("membership_teams");
    expect(names).toContain("memberships");
  });

  it("allows null team_id (user not yet assigned to a team)", async () => {
    const user = await createUser("ptn");
    const org = await createOrganization(user.id, "ptn");

    const id = await createMembership({
      userId: user.id,
      organizationId: org,
      teamId: null,
      role: "Editor",
    });
    const row = await prisma.membership.findUniqueOrThrow({ where: { id } });
    expect(row.teamId).toBeNull();
  });

  it("setting team_id to a different team replaces the single value", async () => {
    const user = await createUser("ptm");
    const org = await createOrganization(user.id, "ptm");
    const teamA = await createTeam(org, "ta");
    const teamB = await createTeam(org, "tb");

    const id = await createMembership({
      userId: user.id,
      organizationId: org,
      teamId: teamA,
      role: "Editor",
    });

    await prisma.membership.update({
      where: { id },
      data: { teamId: teamB },
    });

    const row = await prisma.membership.findUniqueOrThrow({ where: { id } });
    expect(row.teamId).toBe(teamB);
  });
});
