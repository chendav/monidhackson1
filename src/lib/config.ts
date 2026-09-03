import { z } from "zod";

const OptionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  MONID_API_KEY: z.string().min(1).optional(),
  MONID_API_BASE_URL: OptionalUrlSchema.default("https://api.monid.ai"),
  MONID_PARSE_SLUG: z.string().min(1).optional(),
  MONID_PARSE_PROVIDER: z.string().min(1).optional(),
  MONID_PARSE_ENDPOINT: z.string().min(1).optional(),
  MONID_RESULT_URL_PATH: z.string().min(1).optional(),
  MONID_RUN_ID_PATH: z.string().min(1).optional(),
  MONID_RUN_STATUS_PATH: z.string().min(1).optional(),
  MONID_PROVIDER_STATUS_PATH: z.string().min(1).optional(),
  MONID_COST_VALUE_PATH: z.string().min(1).optional(),
  MONID_COST_CURRENCY_PATH: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EXTRACTION_MODEL: z.string().min(1).default("gpt-5.6"),
  OPENAI_QA_MODEL: z.string().min(1).default("gpt-5.6"),
  SESSION_SIGNING_SECRET: z.string().min(32).optional(),
  IP_HASH_SECRET: z.string().min(16).optional(),
  API_KEY_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_ORIGIN: OptionalUrlSchema.default("http://localhost:3000"),
  MAX_RUN_COST_MICRO_USD: z.coerce.number().int().positive().default(2_000_000),
  DAILY_COST_CAP_MICRO_USD: z.coerce.number().int().positive().default(20_000_000),
  OPENAI_RUN_RESERVE_MICRO_USD: z.coerce.number().int().nonnegative().default(100_000),
  MONID_PARSE_RESERVE_MICRO_USD: z.coerce.number().int().nonnegative().default(4_500),
  RUN_TTL_HOURS: z.coerce.number().int().positive().max(168).default(24),
  GUEST_RUNS_PER_HOUR: z.coerce.number().int().positive().default(3),
  API_RUNS_PER_HOUR: z.coerce.number().int().positive().default(30)
});

export type AppConfig = z.infer<typeof EnvironmentSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  if (Object.keys(overrides).length > 0) {
    return EnvironmentSchema.parse({ ...process.env, ...overrides });
  }

  cachedConfig ??= EnvironmentSchema.parse(process.env);
  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}

export function hasLivePipelineConfig(config = getConfig()) {
  return Boolean(
    config.MONID_API_KEY &&
      (config.MONID_PARSE_SLUG ||
        (config.MONID_PARSE_PROVIDER && config.MONID_PARSE_ENDPOINT)) &&
      config.MONID_RESULT_URL_PATH &&
      config.OPENAI_API_KEY
  );
}
