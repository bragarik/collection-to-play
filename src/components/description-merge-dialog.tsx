import {useLayoutEffect, useMemo, useRef, useState} from "preact/hooks";
import {descriptionLimit} from "../albums/album-description.js";
import {DescriptionMerge, type MergeCard, type MergeSelection} from "../albums/description-merge.js";
import {streamingName, type MetadataServiceId} from "../shared/contracts.js";
import {ActionIcon, StreamingIcon} from "./ui-components.js";

export function DescriptionMergeDialog({cards, maxLength, onUse, onCancel}: {
  readonly cards: readonly MergeCard[];
  readonly maxLength?: number;
  readonly onUse: (text: string, sources: readonly MergeSelection[]) => void;
  readonly onCancel: () => void;
}) {
  const model = useMemo(() => {
    const draft = new DescriptionMerge(cards);draft.setIncludeSources(true);return draft;
  }, []), dialog = useRef<HTMLDialogElement>(null);
  const [, update] = useState(0), [error, setError] = useState("");
  const limit = descriptionLimit(maxLength), includeSources = model.includesSources();
  const text = model.text();
  let result: ReturnType<DescriptionMerge["result"]> | undefined, validation = "";
  try {result = model.result(undefined, limit);} catch (error) {validation = text.trim() ? error instanceof Error ? error.message : "Confira a descrição." : "";}
  const singleSource = Boolean(result && new Set(result.sources.map(source => `${source.service}:${source.albumId}`)).size === 1);
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.addEventListener("close", onCancel);node?.showModal();
    return () => {node?.removeEventListener("close", onCancel);node?.close();};
  }, []);
  const changed = (): void => {setError("");update(value => value + 1);};
  return <dialog class="description-merge-dialog" id="description-merge-dialog" ref={dialog} aria-labelledby="merge-title">
    <header class="merge-header"><div><h2 id="merge-title">Combinar descrições</h2><p class="note">Escolha dados de cada serviço e ajuste o texto final.</p></div>
      <button class="btn btn-ghost btn-sm" type="button" aria-label="Cancelar combinação" onClick={onCancel}>Cancelar</button></header>
    <div class="merge-workspace"><section class="merge-sources" aria-label="Descrições por serviço">
      {model.cards.map(card => <article class="merge-source card card-border" key={`${card.album.service}:${card.album.id}`}>
        <div class="merge-source-heading"><h3><StreamingIcon service={card.album.service}/>{streamingName(card.album.service)}</h3>
          {card.description && <button class="btn btn-soft btn-sm" id={`merge-all-${card.album.service}`} type="button" onClick={() => {model.chooseAll(card.album.service as MetadataServiceId);changed();}}><ActionIcon name="copy"/>Usar todos os dados</button>}</div>
        <p class="note">{card.album.title}</p>
        {card.description ? <>
          <details class="merge-full-description"><summary>Ver descrição completa</summary><pre class="description-preview">{card.description.text}</pre></details>
          {card.description.notes.map((note, index) => <p class="note" key={index}>{note}</p>)}
          {model.sections(card).map(section => {
            const selected = model.selection(section.field), used = selected?.service === card.album.service && selected.albumId === card.album.id;
            const fromOther = Boolean(selected && !used);
            const action = used ? `Retirar ${section.label} de ${streamingName(card.album.service)}`
              : fromOther ? `${section.label} já adicionado de ${streamingName(selected!.service)}. Trocar para ${streamingName(card.album.service)}.`
              : `Usar ${section.label} de ${streamingName(card.album.service)}`;
            return <div class="merge-section" key={section.field}><pre>{section.text}</pre>
              <button class={`btn btn-square btn-sm ${used ? "btn-primary" : fromOther ? "btn-soft btn-warning" : "btn-soft"}`} id={`merge-use-${card.album.service}-${section.field}`} type="button" aria-pressed={used}
                aria-label={action} title={action}
                onClick={() => {model.choose(card.album.service as MetadataServiceId, section.field);changed();}}><ActionIcon name={used ? "check" : fromOther ? "refresh" : "copy"}/></button>
            </div>;
          })}
        </> : <p class="warning alert alert-warning alert-soft">{card.descriptionError ?? "Descrição não disponível."} Você pode combinar os dados das outras fontes.</p>}
      </article>)}
    </section><section class="merge-draft" aria-label="Descrição combinada">
      <label for="merge-result">Descrição combinada</label>
      <textarea class="textarea w-full" id="merge-result" rows={13} maxLength={limit} value={text} aria-describedby="merge-help merge-validation" onInput={event => {model.edit(event.currentTarget.value);changed();}} placeholder="Escolha dados à esquerda ou escreva sua descrição."/>
      <p id="merge-help" class="note">Escolher outro serviço para o mesmo dado substitui a escolha anterior. A lista de faixas é escolhida inteira. Edições manuais são preservadas.</p>
      <label class="merge-sources-option"><input class="checkbox checkbox-primary checkbox-sm" id="merge-include-sources" type="checkbox" checked={includeSources} onChange={event => {model.setIncludeSources(event.currentTarget.checked);changed();}}/>{singleSource ? "Incluir fonte (serviço e link)" : "Incluir fontes (serviço, atributos e links)"}</label>
      <p class="note">Dados alterados manualmente deixam de ser atribuídos ao serviço. Nenhuma alteração é salva ao combinar.</p>
      <p id="merge-validation" role="status" class="note">{error || validation || `${(result?.text.length ?? text.length).toLocaleString("pt-BR")} / ${limit.toLocaleString("pt-BR")} caracteres`}</p>
      <button class="btn btn-primary" id="use-merged-description" type="button" disabled={!result} onClick={() => {
        try {const value = model.result(undefined, limit);onUse(value.text, value.sources);}
        catch (error) {setError(error instanceof Error ? error.message : "Não foi possível usar a descrição.");}
      }}><ActionIcon name="check"/>Usar descrição</button>
    </section></div>
  </dialog>;
}
