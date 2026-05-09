import { describe, it, expect } from "vitest";
import { APP_NAME } from "@notive/shared";
import { allow, denyForbidden, denyNotFound } from "@notive/permissions";

describe("scaffold smoke", () => {
  it("shared package exports APP_NAME", () => {
    expect(APP_NAME).toBe("notive");
  });

  it("permissions package exposes denial constructors", () => {
    expect(allow).toEqual({ allow: true });
    expect(denyNotFound("nope")).toEqual({
      allow: false,
      error: { code: "NOT_FOUND", message: "nope" },
    });
    expect(denyForbidden("role_required", "no")).toEqual({
      allow: false,
      error: { code: "FORBIDDEN", message: "no", reasonCode: "role_required" },
    });
  });
});
