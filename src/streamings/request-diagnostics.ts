import {StreamingError, type FailureCode} from "../albums/resolution.js";

export interface BrowserErrorDetails {
  readonly name: string;
  readonly message?: string;
  readonly code?: string;
  readonly cause?: {readonly name: string; readonly message?: string; readonly code?: string};
}
export function browserErrorDetails(value: unknown): BrowserErrorDetails {
  // Fetch error messages can contain URLs, tokens or arbitrary response text.
  // Keep only known browser messages and transport codes; never export a stack.
  const read = (value: unknown): Omit<BrowserErrorDetails, "cause"> => {
    const error = object(value);
    const name = ["Error", "TypeError", "SyntaxError", "DOMException", "AbortError", "TimeoutError"].includes(String(error["name"])) ? String(error["name"]) : "UnknownError";
    const message = typeof error["message"] === "string" && ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "The operation was aborted.", "The operation was aborted due to timeout"].includes(error["message"]) ? error["message"] : undefined;
    const codes = ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ERR_NETWORK", "ERR_FAILED", "ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_CLOSED", "ERR_INTERNET_DISCONNECTED", "ERR_TIMED_OUT", "ERR_CERT_AUTHORITY_INVALID", "ERR_BLOCKED_BY_CLIENT"];
    const code = typeof error["code"] === "string" && codes.includes(error["code"]) ? error["code"] : undefined;
    return {name, ...(message ? {message} : {}), ...(code ? {code} : {})};
  };
  const cause = object(value)["cause"];
  return {...read(value), ...(cause && typeof cause === "object" ? {cause: read(cause)} : {})};
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export interface SearchTiming {readonly at: string; readonly durationMs: number}
export type RequestPhase = "authentication" | "request" | "http" | "response-body" | "parse";
export interface RequestFailure extends SearchTiming {
  readonly kind: "failure";
  readonly code: FailureCode | "timeout";
  readonly phase: RequestPhase;
  readonly timeoutMs: number;
  readonly hasHttpResponse: boolean;
  readonly status?: number;
  readonly aborted: boolean;
  readonly callerAborted: boolean;
  readonly message: string;
  readonly browserError: BrowserErrorDetails;
}
export function createRequestDiagnostics(service: string, caller: AbortSignal | undefined, emit?: (event: RequestFailure) => void) {
  const timeoutMs = 20000;
  const started = performance.now();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = caller ? AbortSignal.any([caller, timeoutSignal]) : timeoutSignal;
  const timing = (): SearchTiming => ({at: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - started))});
  const failure = (error: unknown, phase: RequestPhase, response?: Response): StreamingError => {
    const callerAborted = Boolean(caller?.aborted);
    const timedOut = !callerAborted && (timeoutSignal.aborted || object(error)["name"] === "TimeoutError");
    const code = callerAborted ? "cancelled" : timedOut ? "timeout" : error instanceof StreamingError ? error.code
      : phase === "request" || phase === "response-body" && !(error instanceof SyntaxError) ? "network" : "invalid-response";
    const message = code === "cancelled" ? `Busca no ${service} cancelada.`
      : code === "timeout" ? `A consulta ao ${service} excedeu o limite de 20 segundos. Tente novamente.`
      : error instanceof StreamingError ? error.message
      : code === "network" ? `Não foi possível consultar o ${service}. Tente novamente.` : `Resposta inválida do ${service}.`;
    emit?.({kind: "failure", ...timing(), code, phase, timeoutMs, hasHttpResponse: Boolean(response),
      ...(response ? {status: response.status} : {}), aborted: signal.aborted || object(error)["name"] === "AbortError", callerAborted,
      message, browserError: browserErrorDetails(error)});
    return new StreamingError(code === "timeout" ? "network" : code, message, error instanceof StreamingError ? error.retryAfterSeconds : undefined);
  };
  return {signal, timing, failure, requestInfo: {at: new Date().toISOString(), timeoutMs}};
}
