import {isLibibEditError} from "./libib-edit.js";
import {sanitizeLibibEditDiagnostic, type LibibEditDiagnostic} from "./libib-diagnostics.js";
import type {NativeSaveOutcome} from "./libib-native.js";

/** Diagnostics must never change the result or timing of an edit. */
export function createLibibEditDiagnostics(editor: LibibEditDiagnostic["editor"], send?: (event: LibibEditDiagnostic) => Promise<unknown>) {
  const publish = (event: LibibEditDiagnostic): void => {
    const clean = sanitizeLibibEditDiagnostic(event);
    if (clean && send) {
      try {void send(clean).catch(() => undefined);} catch { /* Editing remains available if diagnostics fail. */ }
    }
  };
  const failure = (stage: LibibEditDiagnostic["stage"], error: unknown, fallback: "invalid-context" | "invalid-response" = "invalid-response"): void => {
    const known = isLibibEditError(error) ? error : undefined;
    const errorCode = known?.code ?? fallback;
    const code = known?.writeMayHaveOccurred ? "save-unconfirmed" :
      ["invalid-context", "invalid-input", "cancelled"].includes(errorCode) ? "edit-blocked" :
      errorCode === "invalid-response" ? "response-invalid" : "request-failed";
    publish({editor, stage, code, errorCode, ...(known?.httpStatus ? {httpStatus: known.httpStatus} : {})});
  };
  return {
    async read<T>(action: () => Promise<T>): Promise<T> {
      try {const result = await action(); publish({editor, stage: "load", code: "read-confirmed"}); return result;}
      catch (error) {failure("load", error); throw error;}
    },
    native(stage: "title" | "creators" | "image", outcome: NativeSaveOutcome): void {
      if (outcome.confirmed) publish({editor, stage, code: "save-confirmed", ...(outcome.httpStatus ? {httpStatus: outcome.httpStatus} : {})});
      else {
        const code = outcome.writeMayHaveOccurred ? "save-unconfirmed" : "edit-blocked";
        publish({editor, stage, code, ...(outcome.code ? {errorCode: outcome.code} : {}), ...(outcome.httpStatus ? {httpStatus: outcome.httpStatus} : {})});
      }
    },
    fill(action: () => void): void {
      try {action(); publish({editor, stage: "fill", code: "fields-filled"});}
      catch (error) {failure("fill", error, "invalid-context"); throw error;}
    },
    async fillAsync(action: () => Promise<void>): Promise<void> {
      try {await action(); publish({editor, stage: "fill", code: "fields-filled"});}
      catch (error) {failure("fill", error, "invalid-context"); throw error;}
    },
  };
}
