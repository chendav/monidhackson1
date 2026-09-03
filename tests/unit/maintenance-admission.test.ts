import { describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";
import { assertRecentMaintenanceHeartbeat } from "@/lib/runs/create";

describe("production maintenance admission gate", () => {
  it("does not apply to local/test execution", async () => {
    const check = vi.fn(async () => false);
    await expect(assertRecentMaintenanceHeartbeat(
      getConfig({ NODE_ENV: "test" }),
      check
    )).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("fails closed unless the durable maintenance heartbeat is fresh", async () => {
    const config = getConfig({ NODE_ENV: "production" });
    await expect(assertRecentMaintenanceHeartbeat(config, async () => false))
      .rejects.toMatchObject({ code: "ANALYSIS_INCOMPLETE", httpStatus: 503, retryable: true });
    await expect(assertRecentMaintenanceHeartbeat(config, async () => true))
      .resolves.toBeUndefined();
  });
});
