import type {AlbumCandidate} from "../shared/contracts.js";

export function UpcitemdbProductInfo({album, showCodes = true}: {album: AlbumCandidate; showCodes?: boolean}) {
  const product = album.upcitemdb;
  if (!product) return null;
  return <div>
    {(product.brand || product.model) && <p class="note">{[product.brand ? `Marca: ${product.brand}` : "", product.model ? `Modelo: ${product.model}` : ""].filter(Boolean).join(" · ")}</p>}
    {product.category && <p class="note">Categoria: {product.category}</p>}
    {showCodes && <p class="note">EAN: {product.ean}{product.upc ? ` · UPC: ${product.upc}` : ""}</p>}
    <a class="note" href={album.url} target="_blank" rel="noopener noreferrer">Dados: UPCitemdb</a>
  </div>;
}
