import {MOVIE_MANUAL_FIELDS, manualEntryFields} from "../shared/manual-entry-fields.js";

export type LibibItemFieldKey = typeof MOVIE_MANUAL_FIELDS[number]["key"];
export type LibibTextControl = HTMLInputElement | HTMLTextAreaElement;

/** Inactive tabs may hide valid text controls; hidden inputs and internal fields are excluded. */
export function readLibibItemFields(form: HTMLFormElement, media: "music" | "movie"): Map<LibibItemFieldKey, LibibTextControl> {
  const controls = new Map<LibibItemFieldKey, LibibTextControl>();
  for (const {key} of manualEntryFields(media)) {
    const nodes = form.querySelectorAll?.<LibibTextControl>(`input[name="${key}"],textarea[name="${key}"]`);
    const control = nodes?.[0];
    if (nodes?.length !== 1 || !control || !control.isConnected || control.form !== form || control.disabled || control.readOnly ||
      control.matches?.(":disabled") || control.classList.contains("no-post") ||
      control.tagName !== "TEXTAREA" && !(control.tagName === "INPUT" && control.type === "text")) continue;
    controls.set(key, control);
  }
  return controls;
}

/** Menu presence only advertises an option; its actual controls must still be checked before saving. */
export function readLibibQuickEditFieldKeys(root: HTMLElement, media: "music" | "movie"): LibibItemFieldKey[] {
  return manualEntryFields(media).filter(({key}) => {
    const entries = root.querySelectorAll<HTMLElement>(`.jump-list [data-key="${key}"]`);
    return entries.length === 1 && entries[0]?.isConnected && entries[0].getAttribute("aria-disabled") !== "true";
  }).map(({key}) => key);
}

export function libibItemFieldLimit(key: LibibItemFieldKey | "title", nativeLimit?: number): number {
  const maximum = key === "title" ? 512 : MOVIE_MANUAL_FIELDS.find(field => field.key === key)?.maxLength;
  if (maximum === undefined) throw new Error("Campo não disponível para este item.");
  return Math.min(maximum, typeof nativeLimit === "number" && Number.isInteger(nativeLimit) && nativeLimit >= 0 ? nativeLimit : Infinity);
}

export function libibItemFieldContext(controls: ReadonlyMap<LibibItemFieldKey, LibibTextControl>) {
  return {
    manualFields: [...controls.keys()],
    manualValues: Object.fromEntries([...controls].map(([key, control]) => [key, control.value])),
    manualLimits: Object.fromEntries([...controls].map(([key, control]) => [key, libibItemFieldLimit(key, control.maxLength)])),
  };
}

export function validateLibibItemText(key: LibibItemFieldKey | "title", value: unknown, nativeLimit?: number): string {
  if (typeof value !== "string") throw new Error("Confira os campos selecionados.");
  const maximum = libibItemFieldLimit(key, nativeLimit);
  const label = key === "title" ? "Título" : MOVIE_MANUAL_FIELDS.find(field => field.key === key)!.label;
  if (value.length > maximum) throw new Error(`${label} excede o limite de ${maximum} caracteres.`);
  if (key === "title" && !value.trim()) throw new Error("Informe o título.");
  if (["publish_year", "publish_month", "publish_day", "length_of", "number_of_discs", "ean_isbn13", "upc_isbn10"].includes(key) &&
    value && !/^\d+$/.test(value)) throw new Error(`Confira ${label}.`);
  const number = Number(value);
  if (value && (key === "publish_year" && number < 1 || key === "publish_month" && (number < 1 || number > 12) ||
    key === "publish_day" && (number < 1 || number > 31))) throw new Error("Confira a data de lançamento.");
  return value;
}

export function validateLibibReleaseDate(year: string, month: string, day: string): void {
  validateLibibItemText("publish_year", year);
  validateLibibItemText("publish_month", month);
  validateLibibItemText("publish_day", day);
  if (month && !year || day && (!year || !month)) throw new Error("Preencha ano e mês antes do dia.");
  if (year && month && day) {
    const date = new Date(0);
    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
      throw new Error("Data de lançamento inválida.");
    }
  }
}

/** Prepares values without changing controls; date parts not selected retain their current values. */
export function prepareLibibItemFields(controls: ReadonlyMap<LibibItemFieldKey, LibibTextControl>, patch: unknown): Map<LibibTextControl, string> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Confira os campos selecionados.");
  const prepared = new Map<LibibTextControl, string>();
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    const control = controls.get(key as LibibItemFieldKey);
    if (!control) throw new Error("Um campo selecionado não está disponível.");
    prepared.set(control, validateLibibItemText(key as LibibItemFieldKey, value, control.maxLength));
  }
  if (entries.some(([key]) => ["publish_year", "publish_month", "publish_day"].includes(key))) {
    const part = (key: LibibItemFieldKey) => {
      const control = controls.get(key);
      return control ? prepared.get(control) ?? control.value : "";
    };
    validateLibibReleaseDate(part("publish_year"), part("publish_month"), part("publish_day"));
  }
  return prepared;
}
