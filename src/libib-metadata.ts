import {isLibibEditError, type LibibEditClient, type LibibEditTarget} from "./libib-edit.js";

export interface AlbumMetadata {
  readonly title: string;
  readonly artists: readonly string[];
}
export type FieldSaveState = "saved" | "not-saved" | "unconfirmed";
export interface LibibApplyResult {
  readonly title: FieldSaveState;
  readonly creators: FieldSaveState;
  readonly nativeUpdated?: boolean;
}

export function prepareAlbumMetadata(value: unknown): {metadata: AlbumMetadata; creatorsText: string} {
  if (!value || typeof value !== "object") throw new Error("Selecione um álbum válido.");
  const data = value as Record<string, unknown>;
  if (typeof data["title"] !== "string" || !data["title"].trim() || data["title"].length > 512 ||
    !Array.isArray(data["artists"]) || !data["artists"].length || data["artists"].length > 100 ||
    !data["artists"].every((name: unknown) => typeof name === "string" && name.trim() && name.length <= 512)) {
    throw new Error("O álbum precisa de título e artistas válidos para atualizar o Libib.");
  }
  const artists: string[] = [...new Set<string>(data["artists"].map((name: string) => name.trim()))];
  // The captured native form confirms comma-separated names, not escaping rules.
  if (artists.some(name => /[,"\r\n]/.test(name))) {
    throw new Error("Este nome de artista contém vírgulas, aspas ou quebras de linha. Atualize-o pelo campo Artista do Libib.");
  }
  return {metadata: {title: data["title"].trim(), artists}, creatorsText: artists.join(", ")};
}

export function isLibibApplyResult(value: unknown): value is LibibApplyResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return [data["title"], data["creators"]].every(state => typeof state === "string" && ["saved", "not-saved", "unconfirmed"].includes(state)) &&
    (data["creators"] === "not-saved" || data["title"] === "saved") &&
    (data["nativeUpdated"] === undefined || typeof data["nativeUpdated"] === "boolean");
}

export function describeLibibApplyResult(result: LibibApplyResult): string {
  if (result.title === "saved" && result.creators === "saved") return result.nativeUpdated
    ? "Título e artistas salvos no Libib. A listagem será atualizada ao fechar a edição."
    : "Título e artistas salvos no Libib. Feche e reabra o item para ver as alterações.";
  if (result.title === "saved") return result.creators === "unconfirmed"
    ? "Título salvo. Não foi possível confirmar os artistas. Confira o item no Libib antes de tentar novamente."
    : "Título salvo, mas os artistas não foram salvos. Confira o item no Libib.";
  return result.title === "unconfirmed"
    ? "Não foi possível confirmar o título. Os artistas não foram enviados. Confira o item no Libib antes de tentar novamente."
    : "Os dados não foram salvos. Confira se o mesmo item continua aberto no Libib.";
}

export async function applyLibibMetadata(
  client: Pick<LibibEditClient, "saveTitle" | "saveCreators">,
  target: LibibEditTarget,
  value: unknown,
  signal?: AbortSignal,
): Promise<LibibApplyResult> {
  const {metadata, creatorsText} = prepareAlbumMetadata(value);
  const current = {...target};
  let title: FieldSaveState = "not-saved";
  let creators: FieldSaveState = "not-saved";
  try {
    await client.saveTitle(current, metadata.title, signal);
    title = "saved";
    await client.saveCreators(current, creatorsText, signal);
    creators = "saved";
  } catch (error) {
    // Stop after the first unconfirmed field; never retry or roll back a write.
    const state = isLibibEditError(error) && !error.writeMayHaveOccurred ? "not-saved" : "unconfirmed";
    if (title === "saved") creators = state; else title = state;
  }
  return {title, creators};
}
