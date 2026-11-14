import type { LibibCompatibilityCheck } from "./libib-diagnostics.js";
import type { LibibDiagnosticsState } from "./libib-diagnostic-store.js";

export function libibDiagnosticSummary(value: LibibDiagnosticsState | undefined, currentVersion: string): {tone: "neutral" | "warning"; message: string} {
  if (!value) return {tone: "neutral", message: "Abra sua biblioteca no Libib para registrar uma verificação."};
  if (value.latest.extensionVersion !== currentVersion) return {tone: "neutral", message: "Este registro é de outra versão da extensão. Reabra o Libib para atualizar a verificação."};
  if (value.latest.checks.some(check => check.state === "changed")) return {tone: "warning", message: "Possível mudança no Libib: a estrutura observada difere da esperada e algumas funções podem falhar. Exporte o diagnóstico para investigar."};
  if (value.latest.checks.some(check => check.state === "recognized")) return {tone: "neutral", message: "A estrutura foi reconhecida nas áreas verificadas."};
  return {tone: "neutral", message: "Ainda não há informação suficiente para avaliar a estrutura da biblioteca."};
}

function checkMessage(check: LibibCompatibilityCheck): string {
  if (check.state === "recognized") return "Estrutura reconhecida.";
  if (check.state === "not-applicable") return "Verificação não aplicável ao item observado.";
  switch (check.reason) {
    case "title-element-missing": return "O título não foi localizado na estrutura esperada.";
    case "editor-fields-missing": return "Os campos necessários para editar não foram reconhecidos.";
    case "loading": return "A página estava carregando.";
    case "no-music-items": return "Nenhum item musical disponível para conferir.";
    default: return check.operation === "update-item" ? "Edição ainda não verificada."
      : check.operation === "read-details" ? "Detalhes de álbum ainda não verificados." : "Biblioteca ainda não identificada.";
  }
}

export function mountLibibDiagnosticPanel(environment: {
  readonly root: Document;
  readonly version: string;
  request(): Promise<LibibDiagnosticsState | undefined>;
}): {refresh(): Promise<void>} {
  const {root} = environment;
  function element<T extends HTMLElement>(selector: string): T {
    const value = root.querySelector<T>(selector);
    if (!value) throw new Error(`Elemento de diagnóstico não encontrado: ${selector}`);
    return value;
  }
  const summary = element("#libib-health-summary");
  const badge = element("#libib-health-badge");
  const checks = element("#libib-health-checks");
  const meta = element("#libib-health-meta");
  const feedback = element("#libib-health-feedback");
  const refreshButton = element<HTMLButtonElement>("#refresh-libib-diagnostics");
  const exportButton = element<HTMLButtonElement>("#export-libib-diagnostics");
  const labels = {"read-collection": "Coleção", "read-details": "Detalhes do álbum", "update-item": "Edição do item"};
  let latest: LibibDiagnosticsState | undefined;
  let generation = 0, loading = false, exporting = false;
  function controls(): void {
    refreshButton.disabled = loading;
    exportButton.disabled = loading || exporting || !latest;
  }
  function render(value: LibibDiagnosticsState | undefined): void {
    latest = value;
    const presentation = libibDiagnosticSummary(value, environment.version);
    summary.textContent = presentation.message;
    summary.dataset["tone"] = presentation.tone;
    badge.dataset["tone"] = presentation.tone;
    badge.textContent = !value ? "Sem registro" : value.latest.extensionVersion !== environment.version ? "Registro anterior"
      : presentation.tone === "warning" ? "Atenção" : value.latest.checks.some(check => check.state === "recognized") ? "Reconhecida" : "Não verificada";
    checks.replaceChildren();
    meta.textContent = value ? `Último registro: ${new Date(value.latest.at).toLocaleString("pt-BR")} · extensão ${value.latest.extensionVersion} · ${value.report.events.length} ocorrências.` : "";
    if (value) for (const check of value.latest.checks) {
      const item = root.createElement("li");
      const label = root.createElement("strong"); label.textContent = `${labels[check.operation]}: `;
      item.append(label, root.createTextNode(checkMessage(check)));
      checks.append(item);
    }
  }
  async function refresh(): Promise<void> {
    const requestId = ++generation;
    loading = true; controls();
    try {
      const value = await environment.request();
      if (requestId === generation) {render(value); feedback.textContent = "";}
    } catch {
      if (requestId === generation) {
        latest = undefined; checks.replaceChildren(); meta.textContent = "";
        summary.dataset["tone"] = "warning";
        badge.dataset["tone"] = "warning"; badge.textContent = "Falha na leitura";
        summary.textContent = "Não foi possível ler o diagnóstico Libib. Atualize as informações ou confira a versão da extensão.";
      }
    } finally {if (requestId === generation) {loading = false; controls();}}
  }
  refreshButton.addEventListener("click", () => {void refresh();});
  exportButton.addEventListener("click", async () => {
    exporting = true; controls(); feedback.textContent = "Preparando diagnóstico…";
    try {
      const value = await environment.request();
      render(value);
      if (!value) {feedback.textContent = "Abra a biblioteca no Libib antes de exportar."; return;}
      const now = new Date().toISOString();
      const data = {...value, exportedAt: now, exportedByVersion: environment.version};
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
      const link = root.createElement("a"); link.href = url;
      link.download = `collection-to-play-libib-${now.replace(/[:.]/g, "-")}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback.textContent = "Diagnóstico exportado sem títulos, artistas, cookies ou dados de autenticação.";
    } catch {feedback.textContent = "Não foi possível exportar o diagnóstico. Atualize as informações e tente novamente.";}
    finally {exporting = false; controls();}
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["libib.diagnostics"]) void refresh();
  });
  return {refresh};
}
