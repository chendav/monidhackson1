export const MONID_INSPECT_SEMANTIC_CONTRACT_VERSION: 1;

export interface MonidInspectSemanticContractV1 {
  version: 1;
  identity: { provider: "context.dev"; endpoint: "/parse"; method: "POST" };
  request: { body_type: string; body_schema: Record<string, unknown> };
  pricing: {
    type: "TIERED";
    base: { currency: "USD"; micro_usd: 900 };
    default: { amount: { currency: "USD"; micro_usd: 900 }; type: "PER_CALL" };
    tiers: Array<{
      selector: { in: string; key: string };
      when: { ocr: true };
      price: { amount: { currency: "USD"; micro_usd: 3600 }; type: "PER_CALL" };
    }>;
    reserved_ocr_max_micro_usd: 4500;
  };
}

export function projectMonidInspectSemanticContract(
  payload: unknown
): MonidInspectSemanticContractV1;

export function monidInspectSemanticContractSha256(payload: unknown): string;
