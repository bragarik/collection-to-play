import {validateDescriptionAlbum, formatAlbumDescription, descriptionFromSearch, deezerDescription, itunesDescription, spotifyDescription, type AlbumDescription, type AlbumDescriptionData} from "../albums/album-description.js";
import {StreamingError} from "../albums/resolution.js";
import {createRequestDiagnostics, type RequestFailure, type SearchTiming} from "./request-diagnostics.js";

export type DescriptionDiagnostic = RequestFailure | (SearchTiming & {readonly kind: "request"; readonly endpoint: string})
  | (SearchTiming & {readonly kind: "response"; readonly status: number})
  | (SearchTiming & {readonly kind: "results"; readonly listedTracks: number; readonly partial: boolean});
export async function loadAlbumDescription(value: unknown, options: {
  readonly fetch?: typeof fetch;
  readonly spotifyDetails: (id: string, signal: AbortSignal, onStatus?: (status: number) => void) => Promise<unknown>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (event: DescriptionDiagnostic) => void;
}): Promise<AlbumDescription> {
  const album = validateDescriptionAlbum(value), trace = createRequestDiagnostics("streaming", options.signal, options.onDiagnostic);
  const emit = options.onDiagnostic;
  let data: unknown, response: Response | undefined;
  const request = async (url: URL): Promise<unknown> => {
    emit?.({kind: "request", ...trace.timing(), endpoint: url.origin + url.pathname});
    try {trace.signal.throwIfAborted();response = await (options.fetch ?? ((input, init) => fetch(input, init)))(url.href,
      {method: "GET", credentials: "omit", redirect: "error", signal: trace.signal});}
    catch (error) {throw trace.failure(error, "request");}
    emit?.({kind: "response", ...trace.timing(), status: response.status});
    if (!response.ok) throw trace.failure(new StreamingError(response.status === 429 ? "rate-limited" : "unavailable",
      response.status === 429 ? "O serviço limitou as consultas. Aguarde antes de gerar a descrição novamente." : "Não foi possível obter os detalhes deste álbum."), "http", response);
    try {const body: unknown = await response.json();trace.signal.throwIfAborted();return body;}
    catch (error) {throw trace.failure(error, "response-body", response);}
  };
  if (album.service === "spotify") {
    emit?.({kind: "request", ...trace.timing(), endpoint: `https://api.spotify.com/v1/albums/${album.id}`});
    try {trace.signal.throwIfAborted();data = await options.spotifyDetails(album.id, trace.signal, status => {response = new Response(null, {status});emit?.({kind: "response", ...trace.timing(), status});});trace.signal.throwIfAborted();}
    catch (error) {throw trace.failure(error, response ? response.ok ? "response-body" : "http" : "request", response);}
  } else if (album.service === "deezer") data = await request(new URL(`https://api.deezer.com/album/${album.id}`));
  else if (album.service === "apple-music") {
    const url = new URL("https://itunes.apple.com/lookup");url.search = new URLSearchParams({id: album.id, entity: "song", country: "br", limit: "200"}).toString();
    data = await request(url);
  }
  let document: AlbumDescription;
  try {
    if (data && typeof data === "object" && "error" in data && data.error) {
      const limited = album.service === "deezer" && typeof data.error === "object" && "code" in data.error && data.error.code === 4;
      throw new StreamingError(limited ? "rate-limited" : "unavailable", limited ? "O serviço limitou as consultas. Aguarde antes de gerar a descrição novamente." : "O serviço não forneceu os detalhes do álbum.");
    }
    let parsed: AlbumDescriptionData;
    if (album.service === "deezer") parsed = deezerDescription(album, data);
    else if (album.service === "apple-music") parsed = itunesDescription(album, data);
    else if (album.service === "spotify") parsed = spotifyDescription(album, data);
    else {
      const available = descriptionFromSearch(album);
      if (!available) throw new StreamingError("unavailable", "Dados insuficientes para montar a descrição.");
      emit?.({kind: "results", ...trace.timing(), listedTracks: available.listedTracks, partial: available.notes.length > 0});return available;
    }
    document = formatAlbumDescription(parsed);
  } catch (error) {throw trace.failure(error, "parse", response);}
  emit?.({kind: "results", ...trace.timing(), listedTracks: document.listedTracks, partial: document.notes.length > 0});
  return document;
}
