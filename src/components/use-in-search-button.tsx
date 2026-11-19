import {ActionIcon} from "./ui-components.js";

export function UseInSearchButton({label, value, disabled, onUse}: {
  label: string;
  value: string;
  disabled?: boolean | undefined;
  onUse(value: string): void;
}) {
  return <button class="btn btn-soft btn-square btn-sm" type="button"
    aria-label={`Usar ${label} na busca`} title={`Usar ${label} na busca`}
    disabled={disabled || !value.trim()} onClick={() => onUse(value.trim())}>
    <ActionIcon name="search"/>
  </button>;
}
