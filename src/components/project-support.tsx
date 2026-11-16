import {useMemo, useRef, useState} from "preact/hooks";
import {supportOptions, supportQr, type SupportOption} from "../shared/support.js";
import {ActionIcon, Feedback} from "./ui-components.js";

function ReceivingDetails({option}: {option: SupportOption}) {
  const input = useRef<HTMLTextAreaElement>(null), [feedback, setFeedback] = useState("");
  const qr = useMemo(() => {try {return supportQr(option.value);} catch {return undefined;}}, [option.value]);
  async function copy(): Promise<void> {
    try {await navigator.clipboard.writeText(option.value);setFeedback(`${option.label}: dado de recebimento copiado.`);}
    catch {input.current?.focus();input.current?.select();setFeedback("Selecione e copie com Ctrl+C ou ⌘C.");}
  }
  return <section class="support-receiving" aria-label={`Receber apoio por ${option.label}`}>
    <h3>{option.label}</h3><p class="note">{option.note}</p>
    {qr ? <svg class="support-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} width="256" height="256" role="img" aria-label={`QR Code de recebimento — ${option.label}`} shape-rendering="crispEdges"><rect width={qr.size} height={qr.size} fill="white"/><path d={qr.path} fill="black"/></svg>
      : <p role="status">QR Code indisponível. Use o dado de recebimento abaixo.</p>}
    <label for={`support-value-${option.id}`}>{option.id === "pix" ? "Pix Copia e Cola" : option.id === "paypal" ? "Link de recebimento" : "Endereço de recebimento"}</label>
    <textarea class="textarea w-full" id={`support-value-${option.id}`} ref={input} readOnly spellcheck={false} rows={3} value={option.value}/>
    <div class="support-actions"><button class="btn btn-soft" type="button" onClick={() => void copy()}><ActionIcon name="copy"/>{option.id === "paypal" ? "Copiar link" : "Copiar"}</button>
      {option.url && <a class="btn btn-primary" href={option.url} target="_blank" rel="noopener noreferrer">Abrir PayPal</a>}</div>
    <Feedback id={`support-feedback-${option.id}`}>{feedback}</Feedback>
  </section>;
}

export function ProjectSupport() {
  const options = useMemo(() => supportOptions(), []), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(options[0]?.id);
  if (!options.length) return null;
  const option = options.find(value => value.id === selected) ?? options[0]!;
  return <>
    <button class="btn btn-soft support-trigger" id="open-support" ref={trigger} type="button" aria-haspopup="dialog" aria-controls="support-dialog" onClick={() => {setOpen(true);dialog.current?.showModal();}}>Apoiar o projeto</button>
    <dialog id="support-dialog" ref={dialog} aria-labelledby="support-title" onClose={() => {setOpen(false);trigger.current?.focus();}}>
      <div class="dialog-header"><h2 id="support-title">Apoiar o projeto</h2><button class="btn btn-ghost btn-square" type="button" aria-label="Fechar apoio ao projeto" onClick={() => dialog.current?.close()}>×</button></div>
      {open && <div class="dialog-content"><p>Gostou da extensão? Você pode contribuir voluntariamente para apoiar seu desenvolvimento.</p>
        <p class="note">Escolha o meio de apoio e o valor no aplicativo do banco, na carteira ou no PayPal.</p>
        <div class="support-methods" role="group" aria-label="Meios de apoio">{options.map(value => <button class={`btn ${value.id === selected ? "btn-primary" : "btn-soft"}`} key={value.id} type="button" aria-pressed={value.id === selected} onClick={() => setSelected(value.id)}>{value.label}</button>)}</div>
        <ReceivingDetails key={option.id} option={option}/>
      </div>}
    </dialog>
  </>;
}
