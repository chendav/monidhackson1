import { z } from "zod";
import {
  AnalysisResultSchema,
  ApiErrorSchema,
  CreateRunResponseSchema,
  HealthResponseSchema,
  PresignUploadRequestSchema,
  PresignUploadResponseSchema,
  QuestionRequestSchema,
  QuestionResponseSchema,
  RunStatusResponseSchema,
  UploadSourceSchema,
  UrlSourceSchema,
  errorCodes,
  runStatuses
} from "@/contracts";

type SchemaObject = Record<string, unknown>;

function isSchemaObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** OpenAPI 3.1 uses the same JSON Schema dialect emitted by Zod 4. */
function toOpenApiSchema(schema: z.ZodType): SchemaObject {
  const generated = { ...z.toJSONSchema(schema, { target: "draft-2020-12" }) } as SchemaObject;
  delete generated.$schema;
  return generated;
}

function extendProperty(
  schema: SchemaObject,
  propertyName: string,
  extension: SchemaObject
): SchemaObject {
  const properties = schema.properties;
  if (!isSchemaObject(properties) || !isSchemaObject(properties[propertyName])) {
    throw new Error(`Expected generated schema property: ${propertyName}`);
  }
  return {
    ...schema,
    properties: {
      ...properties,
      [propertyName]: { ...properties[propertyName], ...extension }
    }
  };
}

const CANADA_BUYS_HTTPS_PATTERN =
  "^https://[cC][aA][nN][aA][dD][aA][bB][uU][yY][sS]\\.[cC][aA][nN][aA][dD][aA](?::443)?(?:[/?#]|$)";

const urlSourceSchema = extendProperty(toOpenApiSchema(UrlSourceSchema), "url", {
  pattern: CANADA_BUYS_HTTPS_PATTERN,
  description: "HTTPS URL on canadabuys.canada.ca only; credentials and non-default ports are rejected."
});

const uploadSourceSchema = extendProperty(
  extendProperty(toOpenApiSchema(UploadSourceSchema), "filename", {
    pattern: "^(?!.*[\\\\/]).+\\.[pP][dD][fF]$",
    description: "Safe PDF filename without path separators."
  }),
  "blob_path",
  {
    pattern: "^incoming/[^/]+/[^/]+/[a-f0-9]{64}\\.pdf$",
    description: "Unexpired, unclaimed private-upload path issued to the same principal."
  }
);

const presignUploadRequestSchema = extendProperty(
  toOpenApiSchema(PresignUploadRequestSchema),
  "filename",
  {
    pattern: "^(?!.*[\\\\/]).+\\.[pP][dD][fF]$",
    description: "Safe PDF filename without path separators."
  }
);

const createRunRequestSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["documents"],
  properties: {
    documents: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      description:
        "One base PDF plus up to four amendments. Exactly one item must have role=base. The parsed package may contain at most 300 physical pages in total.",
      items: { $ref: "#/components/schemas/RunDocumentInput" },
      contains: {
        type: "object",
        required: ["role"],
        properties: { role: { const: "base" } }
      },
      minContains: 1,
      maxContains: 1
    }
  }
};

function jsonSchemaRef(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schemaName: string) {
  return { "application/json": { schema: jsonSchemaRef(schemaName) } };
}

function errorResponse(description: string, retryAfter = false) {
  return {
    description,
    ...(retryAfter
      ? {
          headers: {
            "Retry-After": {
              description: "Seconds before retrying a rate-limited request.",
              schema: { type: "integer", minimum: 0 }
            }
          }
        }
      : {}),
    content: jsonContent("ApiError")
  };
}

type TurnstileAction = "upload_presign" | "create_run" | "ask_question" | "delete_run";

function turnstileParameter(action: TurnstileAction) {
  return {
    name: "X-Turnstile-Token",
    in: "header",
    required: false,
    schema: { type: "string", minLength: 1 },
    description:
      `Required for a production guest-session request and omitted for Bearer authentication. ` +
      `The single-use token must be issued for the \`${action}\` action and the configured production hostname.`,
    "x-turnstile-action": action
  };
}

const authenticatedSecurity = [{ BearerAuth: [] }, { SessionCookie: [] }];
const runIdParameter = { $ref: "#/components/parameters/RunId" };

const analysisOperation = {
  tags: ["Runs"],
  summary: "Read the structured analysis result",
  description:
    "Returns 202 while ordinary processing is in progress. A cleanup_pending run is fail-closed with 409 until application-controlled deletion is confirmed.",
  security: authenticatedSecurity,
  parameters: [runIdParameter],
  responses: {
    "200": {
      description: "Complete or explicitly partial, cleanup-confirmed analysis result.",
      content: jsonContent("AnalysisResult")
    },
    "202": {
      description: "Processing has not reached a publishable terminal state.",
      content: jsonContent("RunStatus")
    },
    "401": errorResponse("Missing or invalid API authentication."),
    "404": errorResponse("Run not found for this principal."),
    "409": errorResponse("Cleanup is pending or the terminal run has no publishable result."),
    "410": errorResponse("The structured result has expired."),
    "503": errorResponse("Persistent production infrastructure is not configured or available."),
    "500": errorResponse("Unexpected analysis retrieval failure.")
  }
};

const sampleOperation = {
  tags: ["Public"],
  summary: "Load the deterministic Edmonton sample",
  description: "Returns a precomputed public result; it does not trigger provider calls or tender search.",
  responses: {
    "200": {
      description: "Deterministic Edmonton sample result.",
      content: jsonContent("AnalysisResult")
    },
    "500": errorResponse("The bundled sample failed schema validation.")
  }
};

const healthOperation = {
  tags: ["Public"],
  summary: "Read service configuration health without testing paid providers",
  responses: {
    "200": {
      description: "Development fallback mode or production-ready configuration.",
      content: jsonContent("HealthResponse")
    },
    "503": {
      description: "Production is not ready; the body identifies missing dependencies.",
      content: jsonContent("HealthResponse")
    }
  }
};

const openApiOperation = {
  tags: ["Public"],
  summary: "Read this OpenAPI 3.1 document",
  responses: {
    "200": {
      description: "OpenAPI 3.1 JSON document.",
      content: { "application/json": { schema: { type: "object" } } }
    }
  }
};

export function buildOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "RFP X-Ray API",
      version: "1.0.0",
      description:
        "Closed-world, evidence-backed analysis of caller-supplied Canadian tender PDFs. The API never searches for tenders or follows links embedded in documents."
    },
    servers: [{ url: origin }],
    tags: [
      { name: "Uploads", description: "Five-minute private-PDF ingress grants." },
      { name: "Runs", description: "Analysis lifecycle, results, cleanup, and grounded questions." },
      { name: "Public", description: "Unauthenticated sample, health, and contract endpoints." }
    ],
    paths: {
      "/api/v1/uploads/presign": {
        post: {
          tags: ["Uploads"],
          summary: "Create a five-minute direct private-PDF upload grant",
          description:
            "The PDF bytes are uploaded directly to the returned URL with the exact returned headers; they do not pass through a normal API route.",
          security: authenticatedSecurity,
          parameters: [turnstileParameter("upload_presign")],
          requestBody: {
            required: true,
            content: jsonContent("PresignUploadRequest")
          },
          responses: {
            "201": {
              description: "Signed upload grant valid for five minutes.",
              content: jsonContent("PresignUploadResponse")
            },
            "400": errorResponse("Malformed JSON request body."),
            "401": errorResponse("Invalid Bearer credential."),
            "403": errorResponse("Guest Turnstile token, action, hostname, or request hostname was rejected."),
            "413": errorResponse("JSON body or declared PDF size exceeds its limit."),
            "422": errorResponse("Filename, size, or SHA-256 metadata is invalid."),
            "503": errorResponse("Guest protection, persistent upload storage, or durable sweep is unavailable."),
            "500": errorResponse("Unexpected upload-grant failure.")
          }
        }
      },
      "/api/v1/runs": {
        post: {
          tags: ["Runs"],
          summary: "Create an analysis run",
          description:
            "Accepts one base document and zero to four amendments. The same principal may have only one active run. URL sources must be CanadaBuys HTTPS URLs; upload references must belong to the same principal.",
          security: authenticatedSecurity,
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: {
                type: "string",
                minLength: 8,
                maxLength: 200,
                pattern: "^[\\x21-\\x7e]+$"
              },
              description: "Visible ASCII key. Reuse with the identical body to replay the original run response."
            },
            turnstileParameter("create_run")
          ],
          requestBody: {
            required: true,
            content: jsonContent("CreateRunRequest")
          },
          responses: {
            "200": {
              description: "Idempotent replay of an existing run.",
              content: jsonContent("CreateRunResponse")
            },
            "202": {
              description: "New run accepted; status may already reflect a fail-closed setup failure.",
              headers: {
                Location: {
                  description: "Relative run-status URL.",
                  schema: { type: "string" }
                }
              },
              content: jsonContent("CreateRunResponse")
            },
            "400": errorResponse("Malformed JSON or invalid Idempotency-Key."),
            "401": errorResponse("Invalid Bearer credential."),
            "402": errorResponse("Per-run or daily provider budget is exhausted."),
            "403": errorResponse("Guest challenge failed or an upload path does not belong to this principal."),
            "409": errorResponse("Idempotency key was reused with different input or upload state is not claimable."),
            "413": errorResponse("JSON body or declared PDF size exceeds its limit."),
            "422": errorResponse("Document count, role, source metadata, URL, or package-page limit is invalid."),
            "429": errorResponse("Active-run or hourly run limit reached.", true),
            "503": errorResponse("Persistent production dependencies or workflow scheduling are unavailable."),
            "500": errorResponse("Unexpected run-creation failure.")
          }
        }
      },
      "/api/v1/runs/{run_id}": {
        get: {
          tags: ["Runs"],
          summary: "Read run status",
          description:
            "Always returns a RunStatus body for an owned run, including ready, partial, failed, cleanup_pending, and expired states.",
          security: authenticatedSecurity,
          parameters: [runIdParameter],
          responses: {
            "200": { description: "Current run lifecycle state.", content: jsonContent("RunStatus") },
            "401": errorResponse("Invalid Bearer credential."),
            "404": errorResponse("Run not found for this principal."),
            "503": errorResponse("Persistent run storage is unavailable."),
            "500": errorResponse("Unexpected status retrieval failure.")
          }
        },
        delete: {
          tags: ["Runs"],
          summary: "Delete controlled source/result data and expire the run",
          description:
            "Idempotently expires a run only after application-controlled cleanup is confirmed. A cleanup failure returns 503 and the result remains unavailable.",
          security: authenticatedSecurity,
          parameters: [runIdParameter, turnstileParameter("delete_run")],
          responses: {
            "204": { description: "Cleanup confirmed; run expired, or the run was already expired." },
            "401": errorResponse("Invalid Bearer credential."),
            "403": errorResponse("Guest Turnstile token, action, hostname, or request hostname was rejected."),
            "404": errorResponse("Run not found for this principal."),
            "503": errorResponse("Deletion was requested but application-controlled cleanup is not confirmed."),
            "500": errorResponse("Unexpected deletion failure.")
          }
        }
      },
      "/api/v1/runs/{run_id}/analysis": { get: analysisOperation },
      "/api/v1/runs/{run_id}/questions": {
        post: {
          tags: ["Runs"],
          summary: "Ask a question using only persisted verified document evidence",
          description:
            "Available after a cleanup-confirmed ready or partial run. Each run accepts at most 10 questions. No external sources are consulted.",
          security: authenticatedSecurity,
          parameters: [runIdParameter, turnstileParameter("ask_question")],
          requestBody: { required: true, content: jsonContent("QuestionRequest") },
          responses: {
            "200": { description: "Closed-world answer, partial match, or not-found result.", content: jsonContent("QuestionResponse") },
            "400": errorResponse("Malformed JSON request body."),
            "401": errorResponse("Invalid Bearer credential."),
            "403": errorResponse("Guest Turnstile token, action, hostname, or request hostname was rejected."),
            "404": errorResponse("Run not found for this principal."),
            "409": errorResponse("Analysis or source cleanup is not complete, or the result is expired."),
            "413": errorResponse("JSON request body exceeds 64 KiB."),
            "422": errorResponse("Question is blank or longer than 1,000 characters."),
            "429": errorResponse("The 10-question per-run limit has been reached.", true),
            "503": errorResponse("Persistent run or question-audit storage is unavailable."),
            "500": errorResponse("Unexpected grounded-Q&A failure.")
          }
        }
      },
      "/api/v1/samples/edmonton": { get: sampleOperation },
      "/api/health": { get: healthOperation },
      "/api/openapi.json": { get: openApiOperation },

      // Compatibility aliases remain callable but are not the locked primary paths.
      "/api/v1/runs/{run_id}/result": {
        get: {
          ...analysisOperation,
          deprecated: true,
          summary: "Compatibility alias for GET /api/v1/runs/{run_id}/analysis"
        }
      },
      "/api/v1/sample": {
        get: {
          ...sampleOperation,
          deprecated: true,
          summary: "Compatibility alias for GET /api/v1/samples/edmonton"
        }
      },
      "/api/v1/health": {
        get: {
          ...healthOperation,
          deprecated: true,
          summary: "Compatibility alias for GET /api/health"
        }
      },
      "/api/v1/openapi.json": {
        get: {
          ...openApiOperation,
          deprecated: true,
          summary: "Compatibility alias for GET /api/openapi.json"
        }
      }
    },
    components: {
      securitySchemes: {
        SessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "rfp_session",
          description:
            "Signed HttpOnly guest session. The service may issue it on the first request; production guest mutations also require X-Turnstile-Token."
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Pre-provisioned API key. Bearer-authenticated mutations do not require Turnstile."
        }
      },
      parameters: {
        RunId: {
          name: "run_id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" }
        }
      },
      schemas: {
        UrlSource: urlSourceSchema,
        UploadSource: uploadSourceSchema,
        RunDocumentInput: {
          type: "object",
          additionalProperties: false,
          required: ["role", "source"],
          properties: {
            role: { type: "string", enum: ["base", "amendment"] },
            source: {
              oneOf: [jsonSchemaRef("UrlSource"), jsonSchemaRef("UploadSource")],
              discriminator: { propertyName: "type" }
            }
          }
        },
        PresignUploadRequest: presignUploadRequestSchema,
        PresignUploadResponse: toOpenApiSchema(PresignUploadResponseSchema),
        CreateRunRequest: createRunRequestSchema,
        CreateRunResponse: toOpenApiSchema(CreateRunResponseSchema),
        RunStatus: toOpenApiSchema(RunStatusResponseSchema),
        AnalysisResult: toOpenApiSchema(AnalysisResultSchema),
        QuestionRequest: toOpenApiSchema(QuestionRequestSchema),
        QuestionResponse: toOpenApiSchema(QuestionResponseSchema),
        ApiError: toOpenApiSchema(ApiErrorSchema),
        HealthResponse: toOpenApiSchema(HealthResponseSchema)
      },
      "x-contract-enums": {
        run_statuses: runStatuses,
        error_codes: errorCodes
      }
    }
  } as const;
}
