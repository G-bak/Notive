import { describe, it, expect } from "vitest";

import { APP_NAME } from "@notive/shared";

describe("scaffold smoke", () => {
  it("shared package exports APP_NAME", () => {
    expect(APP_NAME).toBe("notive");
  });
});
