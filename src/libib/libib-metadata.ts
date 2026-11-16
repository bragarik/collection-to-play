import {descriptionText} from "../albums/album-description.js";
import {ARTWORK_BYTE_LIMIT, imageFormat} from "../albums/album-artwork.js";
import type {NativeSaveOutcome} from "./libib-native.js";
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

export type SelectiveField = "title" | "creators" | "image" | "description";
export interface LibibPatchResult {
  readonly fields: Partial<Record<SelectiveField, FieldSaveState>>;
  readonly nativeUpdated: boolean;
}

export async function validateArtworkFile(value: unknown): Promise<File> {
  if (!(value instanceof File) || value.size <= 0 || value.size > ARTWORK_BYTE_LIMIT) throw new Error("Escolha uma imagem válida com até 20 MB.");
  imageFormat(new Uint8Array(await value.slice(0, 12).arrayBuffer()));
  let bitmap;
  try {bitmap = await createImageBitmap(value);} catch {throw new Error("Não foi possível validar o arquivo da capa.");}
  const {width, height} = bitmap; bitmap.close();
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("A capa não tem dimensões válidas.");
  return value;
}

/** Validate the complete selection before the first write, then stop on any uncertain result. */
export async function applyLibibPatch(value: unknown, save: (field: SelectiveField, value: string | File) => Promise<NativeSaveOutcome>): Promise<LibibPatchResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Escolha os campos que deseja aplicar.");
  const patch = value as Record<string, unknown>, keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !["title", "artists", "artwork", "description"].includes(key) || patch[key] === undefined)) throw new Error("Escolha somente título, artistas, capa ou descrição.");
  const values: Partial<Record<SelectiveField, string | File>> = {};
  if (keys.includes("title")) {
    const title = patch["title"];
    if (typeof title !== "string" || !title.trim() || title.length > 512) throw new Error("Informe um título válido com até 512 caracteres.");
    values.title = title.trim();
  }
  if (keys.includes("artists")) values.creators = prepareAlbumMetadata({title: "Dados do álbum", artists: patch["artists"]}).creatorsText;
  if (keys.includes("description")) values.description = descriptionText(patch["description"]);
  if (keys.includes("artwork")) values.image = await validateArtworkFile(patch["artwork"]);
  const fields: Partial<Record<SelectiveField, FieldSaveState>> = {};
  const entries = Object.entries(values) as [SelectiveField, string | File][];
  for (const [field] of entries) fields[field] = "not-saved";
  for (const [field, value] of entries) {
    try {
      const outcome = await save(field, value);
      fields[field] = outcome.confirmed ? "saved" : outcome.writeMayHaveOccurred ? "unconfirmed" : "not-saved";
      if (!outcome.confirmed) break;
    } catch (error) {
      fields[field] = isLibibEditError(error) && !error.writeMayHaveOccurred ? "not-saved" : "unconfirmed";
      break;
    }
  }
  return {fields, nativeUpdated: Object.values(fields).includes("saved")};
}

export function isLibibPatchResult(value: unknown): value is LibibPatchResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>, fields = result["fields"];
  return typeof result["nativeUpdated"] === "boolean" && !!fields && typeof fields === "object" && !Array.isArray(fields) &&
    Object.keys(fields).length > 0 && Object.entries(fields).every(([key, state]) => ["title", "creators", "image", "description"].includes(key) && typeof state === "string" && ["saved", "not-saved", "unconfirmed"].includes(state));
}
export function describeLibibPatchResult(result: LibibPatchResult): string {
  const labels = {title: "Título", creators: "Artistas", image: "Capa", description: "Descrição"};
  const states = {saved: "salvo", "not-saved": "não enviado ou não salvo", unconfirmed: "gravação sem confirmação"};
  const summary = Object.entries(result.fields).map(([field, state]) => `${labels[field as SelectiveField]}: ${states[state]}`).join(". ") + ".";
  return summary + (Object.values(result.fields).every(state => state === "saved")
    ? " A listagem será atualizada ao fechar a edição."
    : " A sequência foi interrompida. Confira o item no Libib antes de tentar novamente.");
}
