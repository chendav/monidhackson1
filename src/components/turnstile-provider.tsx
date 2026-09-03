"use client";

import { ShieldCheck } from "lucide-react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type TurnstileAction =
  | "upload_presign"
  | "create_run"
  | "ask_question"
  | "delete_run";

type TurnstileAvailability = "bypassed" | "loading" | "ready" | "missing" | "failed";

interface TurnstileWidgetOptions {
  sitekey: string;
  action: TurnstileAction;
  execution: "execute";
  appearance: "interaction-only";
  theme: "light";
  size: "flexible" | "compact";
  language: "en";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
}

interface TurnstileApi {
  ready: (callback: () => void) => void;
  render: (container: HTMLElement, options: TurnstileWidgetOptions) => string | undefined;
  execute: (container: HTMLElement | string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __RFP_XRAY_TURNSTILE_TEST_SITE_KEY__?: string;
  }
}

interface ApiWaiter {
  resolve: (api: TurnstileApi) => void;
  reject: (error: Error) => void;
}

interface TurnstileContextValue {
  getMutationHeaders: (
    action: TurnstileAction,
    signal?: AbortSignal,
    initialHeaders?: HeadersInit,
  ) => Promise<Headers>;
}

const SCRIPT_ID = "rfp-xray-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 15_000;
const CHALLENGE_TIMEOUT_MS = 90_000;
const configuredSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
const productionChallengeRequired = process.env.NODE_ENV === "production";

const actionLabels: Record<TurnstileAction, string> = {
  upload_presign: "securing an upload",
  create_run: "starting the analysis",
  ask_question: "checking your question",
  delete_run: "deleting the analysis",
};

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

function abortError() {
  return new DOMException("The security check was cancelled.", "AbortError");
}

function nextFrame(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const frame = requestAnimationFrame(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
    function onAbort() {
      cancelAnimationFrame(frame);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function TurnstileProvider({ children }: { children: ReactNode }) {
  const [siteKey, setSiteKey] = useState<string | null>(configuredSiteKey);
  const [availability, setAvailability] = useState<TurnstileAvailability>(() => {
    if (configuredSiteKey) return "loading";
    return productionChallengeRequired ? "missing" : "bypassed";
  });
  const [activeAction, setActiveAction] = useState<TurnstileAction | null>(null);
  const [scriptRevision, setScriptRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKeyRef = useRef(siteKey);
  const availabilityRef = useRef(availability);
  const waitersRef = useRef(new Set<ApiWaiter>());
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const updateAvailability = useCallback((next: TurnstileAvailability) => {
    availabilityRef.current = next;
    setAvailability(next);
  }, []);

  const rejectWaiters = useCallback((error: Error) => {
    for (const waiter of [...waitersRef.current]) waiter.reject(error);
    waitersRef.current.clear();
  }, []);

  const markReady = useCallback(() => {
    const api = window.turnstile;
    if (!api) {
      updateAvailability("failed");
      rejectWaiters(new Error("Security verification loaded incorrectly. Please try again."));
      return;
    }
    updateAvailability("ready");
    for (const waiter of [...waitersRef.current]) waiter.resolve(api);
    waitersRef.current.clear();
  }, [rejectWaiters, updateAvailability]);

  useEffect(() => {
    if (configuredSiteKey || productionChallengeRequired) return;
    const testSiteKey = window.__RFP_XRAY_TURNSTILE_TEST_SITE_KEY__?.trim();
    if (!testSiteKey) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      siteKeyRef.current = testSiteKey;
      setSiteKey(testSiteKey);
      updateAvailability("loading");
    });
    return () => { active = false; };
  }, [updateAvailability]);

  useEffect(() => {
    siteKeyRef.current = siteKey;
    if (!siteKey) return;
    if (window.turnstile) {
      window.turnstile.ready(markReady);
      return;
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    let appendScript = false;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      appendScript = true;
    }

    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      updateAvailability("failed");
      rejectWaiters(new Error("Security verification could not load. Check your connection and try again."));
    };
    const load = () => {
      if (settled) return;
      if (!window.turnstile) {
        fail();
        return;
      }
      settled = true;
      window.turnstile.ready(markReady);
    };
    const timeout = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);
    script.addEventListener("load", load, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (appendScript) document.head.append(script);

    return () => {
      window.clearTimeout(timeout);
      script?.removeEventListener("load", load);
      script?.removeEventListener("error", fail);
    };
  }, [markReady, rejectWaiters, scriptRevision, siteKey, updateAvailability]);

  useEffect(() => () => rejectWaiters(abortError()), [rejectWaiters]);

  const waitForApi = useCallback((signal?: AbortSignal) => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (availabilityRef.current === "failed") {
      return Promise.reject(new Error("Security verification is unavailable. Check your connection and try again."));
    }

    return new Promise<TurnstileApi>((resolve, reject) => {
      let settled = false;
      const timeoutRef: { current?: number } = {};
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        signal?.removeEventListener("abort", onAbort);
        waitersRef.current.delete(waiter);
        callback();
      };
      const onAbort = () => finish(() => reject(abortError()));
      const waiter: ApiWaiter = {
        resolve: (api) => finish(() => resolve(api)),
        reject: (error) => finish(() => reject(error)),
      };
      waitersRef.current.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        finish(() => reject(abortError()));
        return;
      }
      timeoutRef.current = window.setTimeout(() => finish(() => reject(new Error("Security verification took too long to load. Please try again."))), SCRIPT_TIMEOUT_MS);
    });
  }, []);

  const issueToken = useCallback(async (action: TurnstileAction, signal?: AbortSignal) => {
    const currentSiteKey = siteKeyRef.current;
    if (!currentSiteKey) {
      if (!productionChallengeRequired) return null;
      throw new Error("Security verification is not configured. Guest changes cannot be submitted right now.");
    }

    const api = await waitForApi(signal);
    if (signal?.aborted) throw abortError();
    setActiveAction(action);
    try {
      await nextFrame(signal);
    } catch (caught) {
      setActiveAction(null);
      throw caught;
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let widgetId: string | null = null;
      const timeout = window.setTimeout(
        () => finish(new Error("Security verification timed out. Please try again.")),
        CHALLENGE_TIMEOUT_MS,
      );
      const finish = (error?: Error, token?: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        if (widgetId) {
          try {
            api.remove(widgetId);
          } catch {
            // A removed or failed widget has no reusable token.
          }
        }
        setActiveAction(null);
        if (error) reject(error);
        else resolve(token!);
      };
      const onAbort = () => finish(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        finish(abortError());
        return;
      }

      try {
        if (!containerRef.current) throw new Error("Security verification is unavailable. Please try again.");
        const renderedWidgetId = api.render(containerRef.current, {
          sitekey: currentSiteKey,
          action,
          execution: "execute",
          appearance: "interaction-only",
          theme: "light",
          size: window.matchMedia("(max-width: 380px)").matches ? "compact" : "flexible",
          language: "en",
          callback: (token) => {
            if (!token || token.length > 2048) {
              finish(new Error("Security verification returned an invalid response. Please try again."));
              return;
            }
            finish(undefined, token);
          },
          "error-callback": () => finish(new Error("Security verification could not be completed. Please try again.")),
          "expired-callback": () => finish(new Error("Security verification expired. Please try again.")),
          "timeout-callback": () => finish(new Error("Security verification timed out. Please try again.")),
          "unsupported-callback": () => finish(new Error("This browser cannot run security verification. Try a supported browser.")),
        });
        if (!renderedWidgetId) throw new Error("Security verification could not start. Please try again.");
        widgetId = renderedWidgetId;
        api.execute(containerRef.current);
      } catch (caught) {
        finish(caught instanceof Error ? caught : new Error("Security verification is unavailable. Please try again."));
      }
    });
  }, [waitForApi]);

  const getMutationHeaders = useCallback((
    action: TurnstileAction,
    signal?: AbortSignal,
    initialHeaders?: HeadersInit,
  ) => {
    const queued = queueRef.current.then(
      () => issueToken(action, signal),
      () => issueToken(action, signal),
    );
    queueRef.current = queued.then(() => undefined, () => undefined);
    return queued.then((token) => {
      const headers = new Headers(initialHeaders);
      if (token) headers.set("x-turnstile-token", token);
      return headers;
    });
  }, [issueToken]);

  const retryScript = useCallback(() => {
    document.getElementById(SCRIPT_ID)?.remove();
    updateAvailability("loading");
    setScriptRevision((current) => current + 1);
  }, [updateAvailability]);

  const contextValue = useMemo<TurnstileContextValue>(() => ({ getMutationHeaders }), [getMutationHeaders]);
  const unavailable = availability === "missing" || availability === "failed";
  const visible = Boolean(activeAction) || unavailable;

  return (
    <TurnstileContext.Provider value={contextValue}>
      {children}
      <aside
        aria-atomic="true"
        aria-live={unavailable ? "assertive" : "polite"}
        className={`turnstile-facility ${visible ? "is-visible" : "is-dormant"}`}
        data-availability={availability}
        data-testid="turnstile-facility"
        role={unavailable ? "alert" : "status"}
      >
        <div className="turnstile-facility-heading">
          <ShieldCheck aria-hidden="true" size={18} />
          <div>
            <strong>{unavailable ? "Security verification unavailable" : "Security check"}</strong>
            <span>
              {availability === "missing"
                ? "Guest changes are disabled because verification is not configured."
                : availability === "failed"
                  ? "The verification service did not load. Check your connection and try again."
                  : activeAction
                    ? `${actionLabels[activeAction]}. Complete the challenge if one appears.`
                    : "Bot protection is ready."}
            </span>
          </div>
          {availability === "failed" ? <button className="turnstile-retry" onClick={retryScript} type="button">Reload verification</button> : null}
        </div>
        <div className="turnstile-widget" id="rfp-turnstile-widget" ref={containerRef} />
      </aside>
    </TurnstileContext.Provider>
  );
}

export function useTurnstile() {
  const context = useContext(TurnstileContext);
  if (!context) throw new Error("useTurnstile must be used within TurnstileProvider.");
  return context;
}
