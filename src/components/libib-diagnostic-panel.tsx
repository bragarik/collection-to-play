import {useEffect, useRef, useState} from "preact/hooks";
import type {LibibDiagnosticsState} from "../libib/libib-diagnostic-store.js";
import {checkMessage, libibDiagnosticSummary} from "../libib/libib-diagnostic-ui.js";
import {downloadJson, extensionRequest, Feedback} from "./ui-components.js";

export function LibibDiagnosticPanel({revision}: {revision: number}) {
  const [latest, setLatest] = useState<LibibDiagnosticsState>(), [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false), [feedback, setFeedback] = useState("");
  const generation = useRef(0), alive = useRef(true), exportingRef = useRef(false);
  const version = chrome.runtime.getManifest().version;
  const presentation = failed ? {tone: "warning", message: "Não foi possível ler o diagnóstico Libib. Atualize as informações ou confira a versão da extensão."}
    : libibDiagnosticSummary(latest, version);
  const badge = failed ? "Falha na leitura" : !latest ? "Sem registro" : latest.latest.extensionVersion !== version ? "Registro anterior"
    : presentation.tone === "warning" ? "Atenção" : latest.latest.checks.some(check => check.state === "recognized") ? "Reconhecida" : "Não verificada";
  async function refresh(): Promise<void> {
    const id = ++generation.current; setLoading(true);
    try {
      const value = await extensionRequest<LibibDiagnosticsState | undefined>({type: "libib:diagnostics"});
      if (alive.current && id === generation.current) {setLatest(value); setFailed(false); setFeedback("");}
    } catch {if (alive.current && id === generation.current) {setLatest(undefined); setFailed(true);}}
    finally {if (alive.current && id === generation.current) setLoading(false);}
  }
  useEffect(() => {
    alive.current = true; void refresh();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {if (area === "local" && changes["libib.diagnostics"]) void refresh();};
    chrome.storage.onChanged.addListener(changed);
    return () => {alive.current = false; generation.current++; chrome.storage.onChanged.removeListener(changed);};
  }, [revision]);
  async function exportReport(): Promise<void> {
    if (exportingRef.current || loading) return;
    exportingRef.current = true; setExporting(true); setFeedback("Preparando diagnóstico…");
    try {
      const value = await extensionRequest<LibibDiagnosticsState | undefined>({type: "libib:diagnostics"});
      if (!alive.current) return;
      setLatest(value); setFailed(false);
      if (!value) {setFeedback("Abra a biblioteca no Libib antes de exportar."); return;}
      downloadJson({...value, exportedAt: new Date().toISOString(), exportedByVersion: version}, "collection-to-play-libib");
      setFeedback("Diagnóstico exportado sem títulos, artistas, cookies ou dados de autenticação.");
    } catch {if (alive.current) setFeedback("Não foi possível exportar o diagnóstico. Atualize as informações e tente novamente.");}
    finally {exportingRef.current = false; if (alive.current) setExporting(false);}
  }
  const labels = {"read-collection": "Coleção", "read-details": "Detalhes do álbum", "update-item": "Edição do item"};
  return <details id="libib-health" class="settings-section card card-border">
    <summary><span id="libib-health-title" class="section-title">Biblioteca Libib</span><span id="libib-health-badge" class="section-badge badge badge-soft" data-tone={presentation.tone} aria-live="polite">{loading ? "Verificando…" : badge}</span></summary>
    <div class="section-content">
      <p id="libib-health-summary" class={`alert alert-soft ${presentation.tone === "warning" ? "alert-warning" : "alert-info"}`} data-tone={presentation.tone} role="status" aria-live="polite">{loading ? "Carregando diagnóstico…" : presentation.message}</p>
      <ul id="libib-health-checks">{latest?.latest.checks.map(check => <li key={check.operation}><strong>{labels[check.operation]}: </strong>{checkMessage(check)}</li>)}</ul>
      <p id="libib-health-meta" class="note">{latest ? `Último registro: ${new Date(latest.latest.at).toLocaleString("pt-BR")} · extensão ${latest.latest.extensionVersion} · ${latest.report.events.length} ocorrências.` : ""}</p>
      <p class="note">Mostra a última avaliação registrada. Reconhecer a estrutura não garante o funcionamento de todas as operações.</p>
      <div class="diagnostic-actions"><button id="refresh-libib-diagnostics" class="btn btn-soft btn-sm" type="button" disabled={loading} onClick={() => void refresh()}>Atualizar informações</button><button id="export-libib-diagnostics" class="btn btn-soft btn-sm" type="button" disabled={loading || exporting || !latest} onClick={() => void exportReport()}>Exportar diagnóstico Libib</button></div>
      <Feedback id="libib-health-feedback">{feedback}</Feedback>
    </div>
  </details>;
}
