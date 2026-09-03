import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  CANADABUYS_FETCH_USER_AGENT,
  loadSource
} from "@/lib/storage/source-reader";
import type { UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "./minimal-pdf";

function emptyStorage() {
  const staged = new Map<string, Uint8Array>();
  const storage: UploadStorage = {
    presign: async () => { throw new Error("not used"); },
    claimIncoming: async () => { throw new Error("not used"); },
    read: async (path) => {
      const bytes = staged.get(path);
      if (!bytes) throw new AppError("SOURCE_UNREACHABLE", "missing", { httpStatus: 404 });
      return bytes.slice();
    },
    stage: async (path, bytes) => { staged.set(path, bytes.slice()); },
    temporaryReadUrl: async (path) => `https://private-storage.example/${path}`,
    purgeIncomingToFence: async () => { throw new Error("not used"); },
    remove: async (path) => { staged.delete(path); },
    sweepExpiredIncoming: async () => []
  };
  return { storage, staged };
}

describe("CanadaBuys source reader", () => {
  it("identifies the server-side fetch while retaining the strict request policy", async () => {
    const pdf = makeMinimalPdf(["Official CanadaBuys fixture"]);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("application/pdf,application/octet-stream;q=0.8");
      expect(headers.get("user-agent")).toBe(CANADABUYS_FETCH_USER_AGENT);
      const body = new ArrayBuffer(pdf.byteLength);
      new Uint8Array(body).set(pdf);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(pdf.byteLength)
        }
      });
    });
    const { storage, staged } = emptyStorage();

    const source = await loadSource({
      role: "base",
      source: {
        type: "url",
        url: "https://canadabuys.canada.ca/official.pdf"
      }
    }, {
      uploadStorage: storage,
      fetcher: fetcher as typeof fetch,
      runId: "run-canadabuys-fetch",
      ownerId: "guest:canadabuys-fetch",
      documentIndex: 0
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(source.sourceName).toBe("official.pdf");
    expect(source.bytes.byteLength).toBe(pdf.byteLength);
    expect(staged.size).toBe(1);
  });
});
