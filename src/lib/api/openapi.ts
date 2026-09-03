import { errorCodes, runStatuses } from "@/contracts";

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "retryable", "request_id"],
      properties: {
        code: { type: "string", enum: errorCodes },
        message: { type: "string" },
        retryable: { type: "boolean" },
        request_id: { type: "string", format: "uuid" }
      }
    }
  }
};

export function buildOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "RFP X-Ray API",
      version: "1.0.0",
      description: "Closed-world, evidence-backed analysis of caller-supplied Canadian tender PDFs. The API never searches for tenders or follows links embedded in documents."
    },
    servers: [{ url: origin }],
    tags: [
      { name: "Uploads" },
      { name: "Runs" },
      { name: "Public" }
    ],
    paths: {
      "/api/v1/uploads/presign": {
        post: {
          tags: ["Uploads"],
          summary: "Create a five-minute direct private-PDF upload grant",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [{ name: "X-Turnstile-Token", in: "header", required: false, schema: { type: "string" }, description: "Required for production guest mutations." }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PresignUploadRequest" } } }
          },
          responses: {
            "201": { description: "Signed upload grant", content: { "application/json": { schema: { $ref: "#/components/schemas/PresignUploadResponse" } } } },
            "4XX": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/runs": {
        post: {
          tags: ["Runs"],
          summary: "Create an analysis run",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 200 } },
            { name: "X-Turnstile-Token", in: "header", required: false, schema: { type: "string" }, description: "Required for production guest mutations." }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunRequest" } } }
          },
          responses: {
            "202": { description: "Run accepted", content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunResponse" } } } },
            "200": { description: "Idempotent replay", content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunResponse" } } } },
            "4XX": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/runs/{run_id}": {
        get: {
          tags: ["Runs"],
          summary: "Read run status",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RunId" }],
          responses: { "200": { description: "Status", content: { "application/json": { schema: { $ref: "#/components/schemas/RunStatus" } } } }, "4XX": { $ref: "#/components/responses/Error" } }
        },
        delete: {
          tags: ["Runs"],
          summary: "Delete controlled source/result data and expire the run",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RunId" }],
          responses: { "204": { description: "Deleted or already expired" }, "4XX": { $ref: "#/components/responses/Error" } }
        }
      },
      "/api/v1/runs/{run_id}/analysis": {
        get: {
          tags: ["Runs"],
          summary: "Read the structured analysis result",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RunId" }],
          responses: {
            "200": { description: "Analysis result", content: { "application/json": { schema: { $ref: "#/components/schemas/AnalysisResult" } } } },
            "202": { description: "Still processing", content: { "application/json": { schema: { $ref: "#/components/schemas/RunStatus" } } } },
            "4XX": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/runs/{run_id}/questions": {
        post: {
          tags: ["Runs"],
          summary: "Ask a question using only persisted verified document evidence",
          security: [{ SessionCookie: [] }, { BearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RunId" }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["question"], properties: { question: { type: "string", minLength: 1, maxLength: 1000 } } } } } },
          responses: { "200": { description: "Grounded answer", content: { "application/json": { schema: { $ref: "#/components/schemas/QuestionResponse" } } } }, "4XX": { $ref: "#/components/responses/Error" } }
        }
      },
      "/api/v1/samples/edmonton": {
        get: { tags: ["Public"], summary: "Load the deterministic Edmonton sample", responses: { "200": { description: "Sample result", content: { "application/json": { schema: { $ref: "#/components/schemas/AnalysisResult" } } } } } }
      },
      "/api/health": {
        get: { tags: ["Public"], summary: "Read service configuration health without testing paid providers", responses: { "200": { description: "Health state" } } }
      },
      "/api/openapi.json": {
        get: { tags: ["Public"], summary: "Read this OpenAPI 3.1 document", responses: { "200": { description: "OpenAPI document" } } }
      }
    },
    components: {
      securitySchemes: {
        SessionCookie: { type: "apiKey", in: "cookie", name: "rfp_session" },
        BearerAuth: { type: "http", scheme: "bearer" }
      },
      parameters: {
        RunId: { name: "run_id", in: "path", required: true, schema: { type: "string", format: "uuid" } }
      },
      responses: {
        Error: { description: "Structured API error", content: { "application/json": { schema: errorSchema } } }
      },
      schemas: {
        PresignUploadRequest: {
          type: "object",
          additionalProperties: false,
          required: ["filename", "size_bytes", "sha256"],
          properties: {
            filename: { type: "string", pattern: "\\.[pP][dD][fF]$", maxLength: 200 },
            size_bytes: { type: "integer", minimum: 1, maximum: 26_214_400 },
            sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }
          }
        },
        PresignUploadResponse: {
          type: "object",
          required: ["blob_path", "upload_url", "expires_at", "method", "headers"],
          properties: {
            blob_path: { type: "string" }, upload_url: { type: "string", format: "uri" },
            expires_at: { type: "string", format: "date-time" }, method: { const: "PUT" },
            headers: { type: "object", additionalProperties: { type: "string" } }
          }
        },
        CreateRunRequest: {
          type: "object",
          additionalProperties: false,
          required: ["documents"],
          properties: {
            documents: {
              type: "array", minItems: 1, maxItems: 5,
              description: "Exactly one base document; remaining documents are amendments.",
              items: {
                type: "object", required: ["role", "source"],
                properties: {
                  role: { type: "string", enum: ["base", "amendment"] },
                  source: { oneOf: [
                    { type: "object", required: ["type", "url"], properties: { type: { const: "url" }, url: { type: "string", format: "uri", description: "HTTPS on canadabuys.canada.ca only" } } },
                    { type: "object", required: ["type", "blob_path", "sha256", "size_bytes", "filename"], properties: { type: { const: "upload" }, blob_path: { type: "string" }, sha256: { type: "string" }, size_bytes: { type: "integer", maximum: 26_214_400 }, filename: { type: "string" } } }
                  ] }
                }
              }
            }
          }
        },
        CreateRunResponse: {
          type: "object", required: ["run_id", "status", "status_url"],
          properties: { run_id: { type: "string", format: "uuid" }, status: { type: "string", enum: runStatuses }, status_url: { type: "string" } }
        },
        RunStatus: {
          type: "object", required: ["run_id", "status", "stage", "progress", "created_at", "updated_at", "expires_at", "cleanup_confirmed", "cost_micro_usd", "error"],
          properties: {
            run_id: { type: "string", format: "uuid" }, status: { type: "string", enum: runStatuses }, stage: { type: "string", enum: runStatuses },
            progress: { type: "integer", minimum: 0, maximum: 100 }, created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" }, expires_at: { type: "string", format: "date-time" }, cleanup_confirmed: { type: "boolean" }, cost_micro_usd: { type: "integer", minimum: 0 }, error: { oneOf: [{ type: "null" }, errorSchema.properties.error] }
          }
        },
        AnalysisResult: { type: "object", description: "Schema version 1.0 analysis; detailed shapes are enforced by the published Zod contract.", required: ["schema_version", "source_scope", "document_manifest", "summary", "claims", "requirements", "evaluation", "risks", "conflicts", "quality", "costs", "generated_at", "expires_at"], properties: { schema_version: { const: "1.0" }, source_scope: { const: "document_only" } }, additionalProperties: true },
        QuestionResponse: { type: "object", required: ["answerability", "answer", "citations", "warning"], properties: { answerability: { type: "string", enum: ["answered", "partial", "not_found"] }, answer: { type: "string" }, citations: { type: "array", items: { type: "object" } }, warning: { type: ["string", "null"] } } }
      }
    }
  } as const;
}
