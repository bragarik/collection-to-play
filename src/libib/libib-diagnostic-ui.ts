import type { LibibCompatibilityCheck } from "./libib-diagnostics.js";
import type { LibibDiagnosticsState } from "./libib-diagnostic-store.js";

export function libibDiagnosticSummary(value: LibibDiagnosticsState | undefined, currentVersion: string): {tone: "neutral" | "warning"; message: string} {
  if (!value) return {tone: "neutral", message: "Abra sua biblioteca no Libib para registrar uma verificação."};
  if (value.latest.extensionVersion === currentVersion && value.latest.checks.some(check => check.state === "changed")) return {tone: "warning", message: "Possível mudança no Libib: a estrutura observada difere da esperada e algumas funções podem falhar. Exporte o diagnóstico para investigar."};
  const stages = new Set<string>();
  for (const event of [...value.report.events].reverse()) {
    if (event.extensionVersion !== currentVersion || !event.stage || !event.editor) continue;
    const key = `${event.editor}:${event.stage}`;
    if (stages.has(key) || event.code === "edit-blocked") continue;
    stages.add(key);
    if (["request-failed", "response-invalid", "save-unconfirmed"].includes(event.code)) {
      return {tone: "warning", message: "Uma consulta ou gravação da edição falhou ou ficou sem confirmação. Confira o item no Libib e exporte o diagnóstico para investigar."};
    }
  }
  if (value.latest.extensionVersion !== currentVersion) return {tone: "neutral", message: "Este registro é de outra versão da extensão. Reabra o Libib para atualizar a verificação."};
  if (value.latest.checks.some(check => check.state === "recognized")) return {tone: "neutral", message: "A estrutura foi reconhecida nas áreas verificadas."};
  return {tone: "neutral", message: "Ainda não há informação suficiente para avaliar a estrutura da biblioteca."};
}

export function checkMessage(check: LibibCompatibilityCheck): string {
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
