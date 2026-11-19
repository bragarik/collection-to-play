import {parseUpcitemdbResponse, type UpcitemdbProduct} from "../streamings/upcitemdb.js";
import type {AlbumCandidate} from "../shared/contracts.js";
import {StreamingError} from "./resolution.js";
import {formatDescriptionText, type AlbumDescription, type DescriptionSection} from "./album-description.js";

function invalid(): never {throw new StreamingError("invalid-response", "O UPCitemdb retornou um produto inválido.");}
function normalizedProduct(value: UpcitemdbProduct): UpcitemdbProduct {
  const product = parseUpcitemdbResponse({code: "OK", total: 1, offset: 0, items: [value]}).products[0];
  if (!product || !value || product.id !== value.id) invalid();
  return product;
}
function document(product: UpcitemdbProduct): AlbumDescription {
  const sections: DescriptionSection[] = [{field: "title", label: "Título", text: `Título: ${product.title}`}];
  for (const [field, label, value] of [
    ["brand", "Marca", product.brand], ["model", "Modelo", product.model], ["category", "Categoria", product.category],
    ["ean", "EAN", product.ean], ["upc", "UPC", product.upc],
  ] as const) if (value) sections.push({field, label, text: `${label}: ${value}`});
  if (product.description) sections.push({field: "about", label: "Sobre o produto", text: `Sobre o produto:\n${product.description}`});
  return {service: "upcitemdb", albumId: product.id, sections, listedTracks: 0, fields: ["title"],
    manualFields: {ean_isbn13: product.ean, ...(product.upc ? {upc_isbn10: product.upc} : {})},
    text: formatDescriptionText(sections, {service: "upcitemdb", url: `https://www.upcitemdb.com/upc/${product.id}`}, {preserveLongText: true}),
    notes: ["Confira a edição física. Marca não equivale a artista, diretor ou estúdio; a busca por título não confirma o código do seu exemplar."]};
}
export function upcitemdbCandidate(value: UpcitemdbProduct): AlbumCandidate {
  const product = normalizedProduct(value);
  return {service: "upcitemdb", id: product.id, title: product.title, artists: [],
    url: `https://www.upcitemdb.com/upc/${product.id}`, ean: product.ean, ...(product.upc ? {upc: product.upc} : {}),
    ...(product.images[0] ? {artworkUrl: product.images[0], artworkVariants: product.images.map(url => ({url}))} : {}),
    upcitemdb: product, description: document(product)};
}
export function validateUpcitemdbCandidate(value: unknown): AlbumCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const album = value as Partial<AlbumCandidate>;
  if (album.service !== "upcitemdb" || !album.upcitemdb || !Array.isArray(album.artists) || album.artists.length) invalid();
  const candidate = upcitemdbCandidate(album.upcitemdb);
  if (album.id !== candidate.id || album.title !== candidate.title || album.url !== candidate.url ||
    album.ean !== undefined && album.ean !== candidate.ean || album.upc !== undefined && album.upc !== candidate.upc ||
    album.artworkUrl !== undefined && album.artworkUrl !== candidate.artworkUrl ||
    album.artworkVariants !== undefined && JSON.stringify(album.artworkVariants) !== JSON.stringify(candidate.artworkVariants)) invalid();
  return candidate;
}
export function upcitemdbDescription(value: unknown): AlbumDescription {
  return validateUpcitemdbCandidate(value).description!;
}
