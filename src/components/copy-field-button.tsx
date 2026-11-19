import {copyButtonState, type CopyFieldSource} from "../albums/field-copy-status.js";
import {streamingName} from "../shared/contracts.js";
import {ActionIcon} from "./ui-components.js";

export function CopyFieldButton({label, target, sources = [], included = false, edited = false, matchedSource, disabled, onCopy}: {
  label: string; target?: CopyFieldSource | undefined; sources?: readonly CopyFieldSource[]; included?: boolean; edited?: boolean;
  disabled?: boolean; onCopy(): void;
  matchedSource?: CopyFieldSource | undefined;
}) {
  const recognized = Boolean(matchedSource) && (!included || !sources.length);
  const state = copyButtonState(target, sources, included, matchedSource);
  if (recognized) sources = [matchedSource!];
  const names = [...new Set(sources.map(source => streamingName(source.service)))].join(", ");
  const action = recognized ? `Este campo já está igual no Libib. Correspondência com ${names}. ${label} para substituir.`
    : state === "used" ? `Campo já usado de ${names}${edited ? " e editado manualmente" : ""}. ${label} novamente.`
    : state === "other" ? `Campo já usado de ${names}${edited ? " e editado manualmente" : ""}. ${label} para substituir.` : label;
  return <button class={`btn btn-square btn-sm ${state === "used" ? "btn-primary" : state === "other" ? "btn-soft btn-warning" : "btn-soft"}`}
    type="button" aria-label={label} aria-description={action} title={action} aria-pressed={state === "used"} data-copy-state={state}
    disabled={disabled} onClick={onCopy}>{state === "available" ? "+" : <ActionIcon name={state === "used" ? "check" : "refresh"}/>}</button>;
}
