import {discogsCandidate, type DiscogsRelease} from "../streamings/discogs.js";
import {formatAlbumDescription, type AlbumDescription, type DescriptionSection} from "./album-description.js";

export function discogsDescription(release: DiscogsRelease): AlbumDescription {
  const album = discogsCandidate(release);
  const extra: DescriptionSection[] = [];
  if (release.directors.length) extra.push({field: "directors", label: "Diretores", text: `Diretores: ${release.directors.join(", ")}`});
  if (release.country) extra.push({field: "country", label: "País", text: `País: ${release.country}`});
  if (release.formats.length) extra.push({field: "format", label: "Formato", text: `Formato: ${release.formats.join("; ")}`});
  if (release.catalogNumbers.length) extra.push({field: "catalog", label: "Catálogo", text: `Catálogo: ${release.catalogNumbers.join(", ")}`});
  if (release.barcodes.length > 1) extra.push({field: "barcodes", label: "Códigos da edição", text: `Códigos da edição: ${release.barcodes.join(", ")}`});
  const base = formatAlbumDescription({album, preserveLongText: true, label: release.labels.join(", "),
    genres: release.genres, tracks: release.tracks, trackCount: release.tracks.length, tracksComplete: true,
    upc: album.upc, ean: album.ean, extraSections: extra, sourceCredit: "Data provided by Discogs.",
    notes: ["Dados da edição física selecionada. Confira formato, país e código do exemplar."]});
  const manualFields = {...base.manualFields};
  if (release.releaseNotes?.trim()) manualFields["notes"] = release.releaseNotes;
  if (release.discCount) manualFields["number_of_discs"] = String(release.discCount);
  if (release.directors.length) manualFields["directors"] = release.directors.join("\n");
  return {...base, manualFields};
}
