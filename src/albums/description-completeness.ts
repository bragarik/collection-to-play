import type {AlbumCandidate} from "../shared/contracts.js";
import type {AlbumDescription} from "./album-description.js";
import {descriptionUsesDetails} from "./album-description.js";

export const DESCRIPTION_FIELDS = ["title", "artists", "releaseDate", "label", "genres", "tracks"] as const;
export type DescriptionField = typeof DESCRIPTION_FIELDS[number];
export const DESCRIPTION_FIELD_NAMES: Record<DescriptionField, string> = {
  title: "álbum", artists: "artistas", releaseDate: "lançamento", label: "gravadora", genres: "gêneros", tracks: "lista completa de faixas",
};
export interface DescriptionCardInput {
  readonly album: Pick<AlbumCandidate, "service"> & Partial<Pick<AlbumCandidate, "title" | "artists" | "releaseDate">>;
  readonly description?: AlbumDescription | undefined;
  readonly loadingDescription?: boolean;
  readonly descriptionError?: string | undefined;
}
export interface DescriptionCompleteness {
  readonly state: "ready" | "unqueried" | "loading" | "error" | "unavailable";
  readonly score: number;
  readonly tone: "ok" | "partial" | "error" | "pending";
  readonly missing: readonly DescriptionField[];
  readonly warning: string;
  readonly summary: string;
  readonly best: boolean;
  readonly tied: boolean;
  readonly provisional: boolean;
}
export function rankDescriptionCompleteness(cards: readonly DescriptionCardInput[]): readonly DescriptionCompleteness[] {
  const values = cards.map(card => {
    const state = card.description ? "ready" : card.loadingDescription ? "loading" : card.descriptionError ? "error" : descriptionUsesDetails(card.album.service) ? "unqueried" : "unavailable";
    const known: DescriptionField[] = [];
    if (card.album.title?.trim()) known.push("title");
    if (card.album.artists?.length && card.album.artists.every(artist => artist.name.trim())) known.push("artists");
    if (card.album.releaseDate?.trim()) known.push("releaseDate");
    const supplied = card.description?.fields;
    const fields = new Set(supplied ? DESCRIPTION_FIELDS.filter(field => supplied.includes(field)) : known);
    const missing = DESCRIPTION_FIELDS.filter(field => !fields.has(field));
    const warning = state === "error" ? "Não foi possível obter os dados da descrição. Tente novamente."
      : state === "unavailable" || state === "ready" && fields.size === 0 ? "Sem informações disponíveis para a descrição."
      : state === "ready" && missing.length ? `Descrição incompleta: ${missing.map(field => DESCRIPTION_FIELD_NAMES[field]).join(", ")}.` : "";
    const summary = `${fields.size} de ${DESCRIPTION_FIELDS.length} dados disponíveis.` + (state === "unqueried" ? " Detalhes ainda não consultados." : state === "loading" ? " Consultando os detalhes." : warning ? ` ${warning}` : "");
    const tone: DescriptionCompleteness["tone"] = state === "unqueried" || state === "loading" ? "pending" : fields.size === 0 ? "error" : fields.size < DESCRIPTION_FIELDS.length ? "partial" : "ok";
    return {state, score: fields.size, tone, missing, warning, summary};
  });
  const ready = values.filter(value => value.state === "ready");
  const max = Math.max(0, ...ready.map(value => value.score)), leaders = ready.filter(value => value.score === max).length;
  const provisional = values.some(value => value.state === "loading" || value.state === "unqueried" || value.state === "error");
  return values.map(value => ({...value, state: value.state as DescriptionCompleteness["state"], best: value.state === "ready" && value.score === max, tied: value.state === "ready" && value.score === max && leaders > 1, provisional}));
}
