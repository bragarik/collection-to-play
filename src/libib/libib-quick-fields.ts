import {manualEntryFields} from "../shared/manual-entry-fields.js";
import {libibItemFieldLimit, validateLibibItemText, validateLibibReleaseDate, type LibibItemFieldKey} from "./libib-item-fields.js";

export interface QuickEditExtraGroup {
  readonly nativeField: string;
  readonly fields: readonly {readonly key: LibibItemFieldKey; readonly value: string; readonly maxLength: number}[];
}
const dateKeys = ["publish_year", "publish_month", "publish_day"];
export const isQuickNativeField = (key: string): boolean => /^[a-z][a-z0-9_]{0,63}$/.test(key);

/** The returned markup describes controls only. Never attach it to the live page or execute it. */
export function readQuickEditExtraGroups(fields: Record<string, unknown>, item: Record<string, unknown>, media: "music" | "movie",
  parse: (html: string) => Document = html => new DOMParser().parseFromString(html, "text/html")): QuickEditExtraGroup[] {
  const groups: QuickEditExtraGroup[] = [];
  for (const [nativeField, html] of Object.entries(fields).slice(0, 100)) {
    if (!isQuickNativeField(nativeField) || ["title", "creators", "description", "image"].includes(nativeField) || typeof html !== "string" ||
      html.length > 100_000 || /<(?:script|iframe|img|link|object|embed|audio|video|source|style)\b/i.test(html)) continue;
    const document = parse(html);
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name],textarea[name],select[name]")];
    if (!controls.length || controls.length > 16) continue;
    const known = new Map(manualEntryFields(media).map(field => [field.key as string, field]));
    const values: QuickEditExtraGroup["fields"][number][] = [];
    for (const control of controls) {
      const field = known.get(control.name);
      if (!field || values.some(value => value.key === field.key) || control.disabled || control.readOnly || control.matches(":disabled") ||
        control.classList.contains("no-post") || control.tagName !== "TEXTAREA" && !(control.tagName === "INPUT" && control.type === "text")) break;
      const raw = item[field.key];
      const value = typeof raw === "string" ? raw : raw === null ? "" : typeof raw === "number" && Number.isFinite(raw) &&
        field.key !== "ean_isbn13" && field.key !== "upc_isbn10" ? String(raw) : undefined;
      if (value === undefined || value.length > 200_000) break;
      values.push({key: field.key, value, maxLength: libibItemFieldLimit(field.key, control.maxLength)});
    }
    if (values.length === controls.length) groups.push({nativeField, fields: values});
  }
  const occurrences = groups.flatMap(group => group.fields.map(field => field.key));
  const dateGroups = groups.filter(group => group.fields.some(field => dateKeys.includes(field.key)));
  return groups.filter(group => group.fields.every(field => occurrences.filter(key => key === field.key).length === 1) &&
    (!group.fields.some(field => dateKeys.includes(field.key)) || dateGroups.length === 1));
}

export function availableQuickEditGroups(groups: readonly QuickEditExtraGroup[], root: HTMLElement): QuickEditExtraGroup[] {
  return groups.filter(group => {
    if (!isQuickNativeField(group.nativeField)) return false;
    const entries = root.querySelectorAll<HTMLElement>(`.jump-list [data-key="${group.nativeField}"]`);
    return entries.length === 1 && entries[0]?.isConnected && entries[0].getAttribute("aria-disabled") !== "true";
  });
}

export function quickEditFieldContext(groups: readonly QuickEditExtraGroup[]) {
  const fields = groups.flatMap(group => group.fields);
  return {manualFields: fields.map(field => field.key), manualValues: Object.fromEntries(fields.map(field => [field.key, field.value])),
    manualLimits: Object.fromEntries(fields.map(field => [field.key, field.maxLength]))};
}

export function prepareQuickEditExtras(groups: readonly QuickEditExtraGroup[], patch: Readonly<Record<string, unknown>>) {
  const available = new Map(groups.flatMap(group => group.fields.map(field => [field.key as string, field] as const)));
  const selected = Object.keys(patch);
  for (const key of selected) {
    const field = available.get(key);
    if (!field) throw new Error("Um campo selecionado não está disponível no lápis.");
    validateLibibItemText(field.key, patch[key], field.maxLength);
  }
  if (selected.some(key => dateKeys.includes(key))) {
    const part = (key: string) => typeof patch[key] === "string" ? patch[key] as string : available.get(key)?.value ?? "";
    validateLibibReleaseDate(part("publish_year"), part("publish_month"), part("publish_day"));
  }
  return groups.filter(group => group.fields.some(field => selected.includes(field.key))).map(group => ({
    nativeField: group.nativeField,
    values: Object.fromEntries(group.fields.filter(field => selected.includes(field.key)).map(field => [field.key, patch[field.key] as string])),
    expectedValues: Object.fromEntries(group.fields.map(field => [field.key, field.value])),
  }));
}
