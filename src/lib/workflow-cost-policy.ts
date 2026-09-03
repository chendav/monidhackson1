// Deterministic Workflow lifecycle envelopes shared by orchestration and cost
// accounting. Event estimates deliberately use three events for every allowed
// step attempt plus two per sleep and three per workflow. Vercel currently
// documents three events for a normal step and one additional retry event, so
// this policy over-allocates retries rather than depending on provider internals.
export const WORKFLOW_SLEEP_EVENT_ENVELOPE = 2;
export const WORKFLOW_RUN_EVENT_ENVELOPE = 3;
export const WORKFLOW_STEP_ATTEMPT_EVENT_ENVELOPE = 3;

// Provider-enforced function ceilings. Cost accounting imports the same
// constants, so a duration change cannot silently escape the run allocation.
export const WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS = 300;
export const WORKFLOW_ANALYSIS_MAX_DURATION_SECONDS =
  WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS;
export const WORKFLOW_HELPER_MAX_DURATION_SECONDS =
  WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS;

export const CLEANUP_STEP_MAX_RETRIES = 0;
// Five-minute durable maintenance owns the long cleanup tail. Per-run
// Workflows make one bounded cleanup attempt and never multiply provider
// invocations through step-level retries.
export const CLEANUP_RETRY_MAX_ATTEMPTS = 1;
export const ANALYZE_RUN_CLEANUP_MAX_ATTEMPTS = 0;

export const SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH = 4;
export const SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS = 2;
// Check immediately, then at 60 and 120 seconds. The final poll occurs after
// the provider's attested 105-second network deadline; durable maintenance
// owns any longer cleanup tail.
export const SOURCE_CLEANUP_WATCHDOG_POLL_DELAY_MS = 60_000;
export const SOURCE_CLEANUP_WATCHDOG_MAX_POLLS = 3;
export const SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES = 0;

function stepAttemptEventEnvelope(maxRetries: number) {
  return (maxRetries + 1) * WORKFLOW_STEP_ATTEMPT_EVENT_ENVELOPE;
}

function stepAttempts(maxRetries: number) {
  return maxRetries + 1;
}

export const SOURCE_CLEANUP_WATCHDOG_MAX_STEP_ATTEMPTS =
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS *
  stepAttempts(SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES);

export const UPLOAD_SWEEP_MAX_STEP_ATTEMPTS =
  stepAttempts(CLEANUP_STEP_MAX_RETRIES);

export const ANALYZE_RUN_MAX_STEP_ATTEMPTS =
  stepAttempts(0);

export const RETRY_CLEANUP_MAX_STEP_ATTEMPTS =
  CLEANUP_RETRY_MAX_ATTEMPTS * stepAttempts(CLEANUP_STEP_MAX_RETRIES);

export const SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS =
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS *
    stepAttemptEventEnvelope(SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES) +
  (SOURCE_CLEANUP_WATCHDOG_MAX_POLLS - 1) * WORKFLOW_SLEEP_EVENT_ENVELOPE +
  WORKFLOW_RUN_EVENT_ENVELOPE;

export const UPLOAD_SWEEP_MAX_LIFECYCLE_EVENTS =
  WORKFLOW_RUN_EVENT_ENVELOPE +
  WORKFLOW_SLEEP_EVENT_ENVELOPE +
  stepAttemptEventEnvelope(CLEANUP_STEP_MAX_RETRIES);

export const ANALYZE_RUN_MAX_LIFECYCLE_EVENTS =
  WORKFLOW_RUN_EVENT_ENVELOPE +
  stepAttemptEventEnvelope(0);

export const RETRY_CLEANUP_MAX_LIFECYCLE_EVENTS =
  WORKFLOW_RUN_EVENT_ENVELOPE +
  CLEANUP_RETRY_MAX_ATTEMPTS * stepAttemptEventEnvelope(CLEANUP_STEP_MAX_RETRIES) +
  (CLEANUP_RETRY_MAX_ATTEMPTS - 1) * WORKFLOW_SLEEP_EVENT_ENVELOPE;

// Generated Workflow flow handlers can be reinvoked around durable boundaries.
// These bounds include the flow route itself in addition to each step route.
export const ANALYZE_RUN_MAX_FLOW_HANDLER_ATTEMPTS = 2;
export const RETRY_CLEANUP_MAX_FLOW_HANDLER_ATTEMPTS = 2;
export const SOURCE_CLEANUP_WATCHDOG_MAX_FLOW_HANDLER_ATTEMPTS = 6;

// Round the code-derived package lifecycles upward. The difference is an
// explicit reserve for start/orchestration events not exposed by application
// code. A run can dispatch at most two four-registration watchdog batches;
// upload-grant sweeping and expiry are owned by recurring maintenance.
export const WORKFLOW_BASE_EVENT_ENVELOPE = 1_000;
export const WORKFLOW_EVENTS_PER_DOCUMENT = 0;

export const WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE =
  ANALYZE_RUN_MAX_STEP_ATTEMPTS +
  RETRY_CLEANUP_MAX_STEP_ATTEMPTS +
  SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS *
    SOURCE_CLEANUP_WATCHDOG_MAX_STEP_ATTEMPTS;

export const WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT = 0;
export const WORKFLOW_BASE_FLOW_HANDLER_ATTEMPT_ENVELOPE =
  ANALYZE_RUN_MAX_FLOW_HANDLER_ATTEMPTS +
  RETRY_CLEANUP_MAX_FLOW_HANDLER_ATTEMPTS +
  SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS *
    SOURCE_CLEANUP_WATCHDOG_MAX_FLOW_HANDLER_ATTEMPTS;
export const WORKFLOW_FLOW_HANDLER_ATTEMPTS_PER_DOCUMENT = 0;
export const WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE =
  WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE +
  WORKFLOW_BASE_FLOW_HANDLER_ATTEMPT_ENVELOPE;
export const WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT =
  WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT +
  WORKFLOW_FLOW_HANDLER_ATTEMPTS_PER_DOCUMENT;

if (WORKFLOW_BASE_EVENT_ENVELOPE <
  ANALYZE_RUN_MAX_LIFECYCLE_EVENTS +
    RETRY_CLEANUP_MAX_LIFECYCLE_EVENTS +
    SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS *
      SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS) {
  throw new Error("The Workflow base event envelope no longer covers orchestration policy.");
}
