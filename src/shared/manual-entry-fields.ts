/** Native controls exposed by the inspected Libib movie entry form. */
export const MOVIE_MANUAL_FIELDS = [
  {key: "ensemble", label: "Atores", maxLength: 52000},
  {key: "publisher", label: "Estúdio", maxLength: 255},
  {key: "publish_year", label: "Ano", maxLength: 4},
  {key: "publish_month", label: "Mês", maxLength: 2},
  {key: "publish_day", label: "Dia", maxLength: 2},
  {key: "ean_isbn13", label: "EAN", maxLength: 13},
  {key: "upc_isbn10", label: "UPC", maxLength: 12},
  {key: "aspect_ratio", label: "Proporção de tela", maxLength: 25},
  {key: "length_of", label: "Duração (minutos)", maxLength: 4},
  {key: "number_of_discs", label: "Número de discos", maxLength: 3},
  {key: "price", label: "Preço", maxLength: 512},
  {key: "tags", label: "Tags", maxLength: 52000},
  {key: "group", label: "Grupo", maxLength: 100},
  {key: "notes", label: "Notas", maxLength: 52000},
] as const;

export const MUSIC_MANUAL_FIELDS = MOVIE_MANUAL_FIELDS.filter(field =>
  field.key !== "ensemble" && field.key !== "aspect_ratio");

export function manualEntryFields(media: "music" | "movie") {
  return media === "movie" ? MOVIE_MANUAL_FIELDS : MUSIC_MANUAL_FIELDS;
}
