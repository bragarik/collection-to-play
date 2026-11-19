import {MUSIC_MANUAL_FIELDS} from "../shared/manual-entry-fields.js";
import {ActionIcon} from "./ui-components.js";
import {CopyFieldButton} from "./copy-field-button.js";
import {UseInSearchButton} from "./use-in-search-button.js";
import {BarcodeReaderButton} from "./barcode-reader.js";
import type {CopyFieldSource} from "../albums/field-copy-status.js";

export interface ManualMusicField {
  value: string;
  included: boolean;
  note?: string | undefined;
  source?: CopyFieldSource | undefined;
  edited?: boolean;
}
export function ManualMusicFields({side, available, source, sourceNotes, draft, initial, sourceIdentity, limits = {}, busy, onChange, onUseInSearch, catalogMatches = {}}: {
  side: "source" | "draft";
  available: readonly string[];
  source: Readonly<Record<string, string>>;
  sourceNotes: Readonly<Record<string, string>>;
  draft: Readonly<Record<string, ManualMusicField>>;
  initial: Readonly<Record<string, string>>;
  sourceIdentity?: CopyFieldSource | undefined;
  limits?: Readonly<Record<string, number>>;
  busy: boolean;
  onChange(key: string, value: ManualMusicField): void;
  onUseInSearch?: ((key: string, value: string) => void) | undefined;
  catalogMatches?: Readonly<Record<string, CopyFieldSource>>;
}) {
  return <>{MUSIC_MANUAL_FIELDS.filter(field => available.includes(field.key)).map(field => {
    const current = draft[field.key] ?? {value: initial[field.key] ?? "", included: false};
    if (side === "source") {
      if (!source[field.key]) return null;
      return <div class="detail-field" key={field.key}>
        <div><h3>{field.label}</h3><p>{source[field.key]}</p>
          {sourceNotes[field.key] ? <p class="note">{sourceNotes[field.key]}</p> : field.key === "length_of" && <p class="note">Duração arredondada para minutos inteiros.</p>}
        </div>
        <CopyFieldButton label={`Copiar ${field.label.toLowerCase()}`} target={sourceIdentity} sources={current.source ? [current.source] : []}
          matchedSource={catalogMatches[field.key]}
          included={current.included} edited={Boolean(current.edited)} disabled={busy}
          onCopy={() => onChange(field.key, {value: source[field.key]!, included: true, note: sourceNotes[field.key], source: sourceIdentity})}/>
    </div>;
    }
    return <div class="draft-field" key={field.key}>
      <div class="field-heading">
        <input id={`include-manual-${field.key}`} class="checkbox checkbox-primary checkbox-sm" type="checkbox"
          checked={current.included} disabled={busy} aria-label={`Aplicar ${field.label.toLowerCase()}`}
          onChange={event => onChange(field.key, {...current, included: event.currentTarget.checked})}/>
        <label for={`manual-${field.key}`}>{field.label}</label>
        {(field.key === "ean_isbn13" || field.key === "upc_isbn10") && <BarcodeReaderButton
          target={field.key === "ean_isbn13" ? "ean" : "upc"} fieldLabel={field.label}
          disabled={busy || (limits[field.key] ?? field.maxLength) < (field.key === "ean_isbn13" ? 13 : 12)}
          onUse={value => onChange(field.key, {value, included: true, edited: true})}/>}
        {onUseInSearch && (field.key === "ean_isbn13" || field.key === "upc_isbn10") &&
          <UseInSearchButton label={field.label} value={current.value} disabled={busy} onUse={value => onUseInSearch(field.key, value)}/>}
        <button class="btn btn-soft btn-square btn-sm" type="button" disabled={busy || !current.included}
          title={`Restaurar ${field.label.toLowerCase()}`} aria-label={`Restaurar ${field.label.toLowerCase()}`}
          onClick={() => onChange(field.key, {value: initial[field.key] ?? "", included: false})}><ActionIcon name="refresh"/></button>
      </div>
      {field.key === "notes" ? <textarea id={`manual-${field.key}`} class="textarea w-full" rows={3}
        value={current.value} maxLength={limits[field.key] ?? field.maxLength} disabled={busy}
        onInput={event => onChange(field.key, {...current, value: event.currentTarget.value, included: true, edited: true})}/>
        : <input id={`manual-${field.key}`} class="input w-full" value={current.value} maxLength={limits[field.key] ?? field.maxLength}
          disabled={busy} onInput={event => onChange(field.key, {...current, value: event.currentTarget.value, included: true, edited: true})}/>}
      {current.note && <p class="note">{current.note}</p>}
    </div>;
  })}</>;
}
