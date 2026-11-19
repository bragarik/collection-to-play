import {hasUnusedCardData} from "../albums/field-copy-status.js";
import {ActionIcon} from "./ui-components.js";

export function UnusedDataBadge({available, included}: {
  available: Readonly<Record<string, boolean>>;
  included: readonly string[];
}) {
  return hasUnusedCardData(available, included) ? <span class="unused-data-badge badge badge-soft badge-warning"
    title="Esta fonte oferece dados que ainda não foram copiados de nenhuma fonte para Dados para o Libib.">
    <ActionIcon name="copy"/>Mais dados disponíveis
  </span> : null;
}
