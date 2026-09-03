import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import {
  CloudflareTurnstileVerifier,
  enforceMutationChallenge,
  MUTATION_ACTIONS,
  type Principal,
  type TurnstileVerifier
} from "@/lib/security/auth";

const principal: Principal = { id: "guest:test", quotaKey: "ip:test", kind: "guest" };
const config = getConfig({
  NODE_ENV: "production",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  TURNSTILE_SECRET_KEY: "secret",
  TURNSTILE_EXPECTED_HOSTNAME: "rfp.example"
});

describe("Turnstile mutation binding", () => {
  it("binds a token to the expected action and request hostname", async () => {
    let observed: Parameters<TurnstileVerifier["verify"]>[0] | undefined;
    const verifier: TurnstileVerifier = {
      verify: async (input) => { observed = input; return true; }
    };
    await enforceMutationChallenge(new Request("https://rfp.example/api/v1/runs", {
      method: "POST", headers: { "x-turnstile-token": "fresh-token", "x-forwarded-for": "203.0.113.8" }
    }), principal, MUTATION_ACTIONS.createRun, verifier, config);
    expect(observed).toEqual({
      token: "fresh-token", remoteIp: "203.0.113.8",
      expectedAction: "create_run", expectedHostname: "rfp.example"
    });
    await expect(enforceMutationChallenge(new Request("https://evil.example/api/v1/runs", {
      method: "POST", headers: { "x-turnstile-token": "token" }
    }), principal, MUTATION_ACTIONS.createRun, verifier, config)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("requires Siteverify success, action, and hostname simultaneously", async () => {
    const verifier = (payload: object) => new CloudflareTurnstileVerifier("secret", (async () =>
      Response.json(payload)) as typeof fetch);
    const input = {
      token: "token", expectedAction: MUTATION_ACTIONS.deleteRun,
      expectedHostname: "rfp.example"
    };
    await expect(verifier({ success: true, action: "delete_run", hostname: "rfp.example" }).verify(input))
      .resolves.toBe(true);
    await expect(verifier({ success: true, action: "create_run", hostname: "rfp.example" }).verify(input))
      .resolves.toBe(false);
    await expect(verifier({ success: true, action: "delete_run", hostname: "other.example" }).verify(input))
      .resolves.toBe(false);
    await expect(verifier({ success: false, action: "delete_run", hostname: "rfp.example" }).verify(input))
      .resolves.toBe(false);
  });
});
