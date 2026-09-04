# T27 independent capacity review

## Verdict

`REVISE` the implementation boundary before dispatch. The capacity diagnosis and
the proposed 524,288-byte runtime bound are `ACCEPTED`; there is one P1
compatibility omission in the stated path list. P0=0, P1=1, P2=0.

This is approval of a bounded capacity correction only. It is not CER golden,
production, deployment, amendment, conflict, deadline, Monid, or full-product
approval.

## Evidence supporting the capacity diagnosis

- The genuine cached CER authority manifest contains 216 joined records and 219
  origins. Its stable serialized receipt is 269,326 bytes: 7,182 bytes above the
  current 262,144-byte cap and 254,962 bytes below the proposed 524,288-byte cap.
- The existing verifier seals the complete manifest and then replaces it in full
  with `unresolvedRecordAuthority("record_authority_receipt_capacity")` when the
  cap is exceeded. This directly explains the all-zero capacity-fallback result.
- The offline experiment is properly isolated: replay mode and the separate
  `t27-capacity-` result prefix are mandatory, and the Vite transform fails on
  source drift. The cached provider responses are reused without a provider call.
- With only the experimental cap changed, manifest integrity and draft matching
  are true; authority is 156 verified / 60 discarded; the public result contains
  16 claims, 32 requirements, 55 verified citations, and 49/49 cited critical
  claims. It recovers the mandatory gate, 50/94 threshold, 70/30 weighting, and
  highest-combined-rating method.
- The same result still has a null closing date and does not establish the
  required amendment replacement/conflict behavior. The existing CER deadline
  golden therefore remains failed, as the reframing document states.
- Production persistence stores `recordAuthorityAudit`, not the full authority
  manifest. That audit is a strict scalar/counter allowlist; the full manifest is
  passed from extraction to materialization and audit creation in-process only.

## P1 compatibility omission

`scripts/read-record-authority-audit.mjs` is a deployed/operator read path with
its own independent schema. It currently accepts only versions 1-4 and applies a
single 262,144-byte `commonFields` limit. If new writes become audit v5 at
524,288 bytes while this script is left outside the T27 path list, valid new
audits will fail closed as `record_authority_audit_read_failed`.

Add the CLI reader and its directly affected unit assertions to the bounded T27
scope. The reader must retain the 262,144-byte limit for v1-v4 and accept v5 with
exactly 524,288 bytes. Do not globally replace its existing common limit.

## Required implementation invariants

1. Set the runtime authority-receipt limit to exactly 524,288 bytes. Continue to
   measure UTF-8 bytes over the same stable digest payload; accept exactly the
   cap and replace the entire receipt with an explicit unresolved receipt at
   cap+1. Never truncate or partially publish an oversized receipt.
2. Freeze audit v1-v4 schemas at `receipt_limit_bytes = 262144` and
   `receipt_byte_length <= 262144`. Add audit v5 with the otherwise unchanged v4
   shape and the new exact 524,288-byte limit. New writes use v5; old rows remain
   readable without migration.
3. Mirror the same versioned compatibility rules in
   `scripts/read-record-authority-audit.mjs`. Test a valid high-byte v5 audit,
   rejection of a high-byte v4 audit, and continued v1-v4 reads.
4. Keep durable audit data restricted to digest, byte counts, record count,
   booleans, counters, and timestamp. Do not persist the manifest, origins,
   selectors, source text, evidence quotes, model output, or source identifiers.
5. Do not change prompts, provider schemas, record/source/semantic gates,
   materialization, amendment handling, or public contracts under T27.
6. After implementation, replay the unchanged cached CER response through the
   real production code at 524,288 bytes and require the same manifest integrity,
   draft match, 269,326-byte measurement, and recovered evaluation evidence.
   Keep the missing deadline/conflict result visible; it remains the next
   independent defect, not a reason to broaden this capacity patch.

Once the CLI compatibility omission is included, the bounded implementation may
proceed without another paid call or broad release run.
