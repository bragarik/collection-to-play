import {lastfmCandidate, lastfmDescription} from "../../albums/lastfm-source.js";
import type {LastfmAlbum} from "../../streamings/lastfm.js";
import {CopyFieldButton} from "../../components/copy-field-button.js";
import {UnusedDataBadge} from "../../components/unused-data-badge.js";
import {UseInSearchButton} from "../../components/use-in-search-button.js";
import {SearchResultsSkeleton} from "../../components/search-results-skeleton.js";
import {BarcodeReaderButton} from "../../components/barcode-reader.js";
import {UpcitemdbProductInfo} from "../../components/upcitemdb-product-info.js";
import {validateUpcitemdbCandidate} from "../../albums/upcitemdb-source.js";
import {copyButtonState, matchingCatalogSources, type CopyFieldSource} from "../../albums/field-copy-status.js";
import {DiscogsBatch, DiscogsEditionInfo, DiscogsSearchThumbnail} from "../../components/discogs-edition-info.js";
import {DescriptionMergeDialog} from "../../components/description-merge-dialog.js";
import {extensionRequest, StreamingIcon, AlbumArtwork} from "../../components/ui-components.js";
import type {DiscogsRelease, DiscogsSearchPage} from "../../streamings/discogs.js";
import {streamingName, type AlbumCandidate, type UpcitemdbSearchReply, type MetadataSearchReply} from "../../shared/contracts.js";
import type {AlbumDescription, DescriptionSection} from "../../albums/album-description.js";
import {MOVIE_MANUAL_FIELDS} from "../../shared/manual-entry-fields.js";
import {ARTWORK_BYTE_LIMIT, imageFormat, loadAlbumArtworkResource, type AlbumArtworkResource, type AlbumArtworkFile} from "../../albums/album-artwork.js";
import {describeLibibPatchResult, isLibibPatchResult} from "../../libib/libib-metadata.js";
import {ActionIcon, ArtworkDimensions, ArtworkPreview, type ArtworkPreviewMetadata} from "../../components/ui-components.js";
import {useEffect, useRef, useState} from "preact/hooks";
import {descriptionLimit, formatDescriptionText} from "../../albums/album-description.js";

const VIDEO_SERVICES = ["tmdb", "discogs", "upcitemdb", "lastfm"] as const;
type VideoService = typeof VIDEO_SERVICES[number];
interface Movie {
  id: number | string;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  discogs?: AlbumCandidate;
  upcitemdb?: AlbumCandidate;
  lastfm?: AlbumCandidate;
}
interface Details extends Movie {
  document?: AlbumDescription;
  release?: DiscogsRelease;
  overview?: string;
  runtime?: number;
  genres?: {name: string}[];
  production_companies?: {name: string}[];
  credits?: {crew?: {name: string; job: string}[]; cast?: {name: string}[]};
}
const posterUrl = (path?: string | null) => path && /^\/[\w-]+\.(?:jpg|png|webp)$/i.test(path)
  ? "https://image.tmdb.org/t/p/w500" + path : undefined;

async function tmdb<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const url = new URL("https://api.themoviedb.org/3/" + path);
  const credential = token.trim().replace(/^Bearer\s+/i, "");
  const apiKey = /^[a-f0-9]{32}$/i.test(credential);
  url.search = new URLSearchParams({language: "pt-BR", ...params, ...(apiKey ? {api_key: credential} : {})}).toString();
  const started = Date.now();
  let status: number | undefined;
  let count: number | undefined;
  let outcome = "network";
  try {
    const response = await fetch(url, {headers: apiKey ? {} : {Authorization: "Bearer " + credential}, credentials: "omit",
      redirect: "error", signal: AbortSignal.timeout(15_000)});
    status = response.status;
    outcome = "http-error";
    if (!response.ok) throw new Error(response.status === 401
      ? "O TMDb recusou a credencial. Salve novamente a API key ou o API Read Access Token nas configurações."
      : `O TMDb retornou HTTP ${response.status}.`);
    outcome = "invalid-response";
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("O TMDb retornou uma resposta inválida.");
    if (path === "search/movie") {
      const results = (data as {results?: unknown}).results;
      if (!Array.isArray(results)) throw new Error("O TMDb retornou resultados inválidos.");
      count = results.length;
    }
    outcome = "success";
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      outcome = "timeout";
      throw new Error("O TMDb demorou para responder. Tente novamente.");
    }
    if (outcome === "network") throw new Error("Não foi possível conectar ao TMDb.");
    throw error;
  } finally {
    const event = {at: new Date().toISOString(), stage: path === "search/movie" ? "search" : "details",
      ...(params.query ? {query: params.query.slice(0, 512)} : {}), language: "pt-BR",
      durationMs: Date.now() - started, status, count, outcome};
    try {
      const saved = (await chrome.storage.local.get("tmdb.diagnostic"))["tmdb.diagnostic"] as {events?: unknown[]} | undefined;
      const events = Array.isArray(saved?.events) ? saved.events.slice(-19) : [];
      await chrome.storage.local.set({"tmdb.diagnostic": {schemaVersion: 1, events: [...events, event]}});
    } catch { /* A diagnostic failure must preserve the query result. */ }
  }
}

function VideoArtwork({src, alt}: {src: string; alt: string}) {
  const [image, setImage] = useState<{url: string; metadata: ArtworkPreviewMetadata}>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(src, {credentials: "omit", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])});
        if (!response.ok || Number(response.headers.get("content-length")) > ARTWORK_BYTE_LIMIT) throw new Error();
        const blob = await response.blob();
        if (!blob.size || blob.size > ARTWORK_BYTE_LIMIT) throw new Error();
        const format = imageFormat(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
        const bitmap = await createImageBitmap(blob);
        const {width, height} = bitmap;
        bitmap.close();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({url: objectUrl, metadata: {width, height, format, byteLength: blob.size}});
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return image ? <ArtworkPreview src={image.url} alt={alt} metadata={image.metadata}/>
    : <p class="note">{failed ? "Não foi possível carregar a capa." : "Carregando capa…"}</p>;
}

export function VideoEditor({sourceUrl, session}: {sourceUrl: string; session: string}) {
  const parentOrigin = new URL(sourceUrl).origin;
  const params = new URLSearchParams(location.search);
  const manual = params.get("editor") === "manual";
  const full = params.get("editor") === "full" || manual;
  const manualInitialized = useRef(false);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [manualOriginal, setManualOriginal] = useState<Record<string, string>>({});
  const [manualFields, setManualFields] = useState<string[]>([]);
  const [manualLimits, setManualLimits] = useState<Record<string, number>>({});
  const initialTitle = params.get("title") ?? "";
  const initialDirectors = params.get("artist") ?? "";
  const [query, setQuery] = useState(initialTitle);
  const [title, setTitle] = useState(initialTitle);
  const [draftDirectors, setDraftDirectors] = useState(initialDirectors);
  const [draftPoster, setDraftPoster] = useState<string>();
  const [draftArtwork, setDraftArtwork] = useState<AlbumArtworkResource>();
  const [upcArtwork, setUpcArtwork] = useState<AlbumArtworkResource>();
  const [upcArtworkLoading, setUpcArtworkLoading] = useState(false);
  const [upcArtworkError, setUpcArtworkError] = useState("");
  const [upcArtworkAttempt, setUpcArtworkAttempt] = useState(0);
  useEffect(() => () => draftArtwork?.release(), [draftArtwork]);
  const [sourceSize, setSourceSize] = useState<{url: string; width: number; height: number}>();

  const [configured, setConfigured] = useState(false);
  const [results, setResults] = useState<Movie[]>([]);
  const [service, setService] = useState<VideoService>("tmdb");
  const [selectedSource, setSelectedSource] = useState<VideoService>("tmdb");
  const [cards, setCards] = useState<Partial<Record<VideoService, Details>>>({});
  const selected = cards[selectedSource];
  const sourceDescription = selected?.document?.text ?? "";
  const [lastfmConfigured, setLastfmConfigured] = useState(false);
  const [lastfmLanguage, setLastfmLanguage] = useState<"pt" | "en">("pt");
  const [lastfmPage, setLastfmPage] = useState<string>();
  const [lastArtwork, setLastArtwork] = useState<AlbumArtworkResource>();
  const [lastArtworkLoading, setLastArtworkLoading] = useState(false);
  const [lastArtworkError, setLastArtworkError] = useState("");
  const [lastArtworkAttempt, setLastArtworkAttempt] = useState(0);
  const [discogsConfigured, setDiscogsConfigured] = useState(false);
  const [barcode, setBarcode] = useState(params.get("ean") ?? params.get("upc") ?? "");
  const [discogsArtist, setDiscogsArtist] = useState("");
  const [discogsPage, setDiscogsPage] = useState<DiscogsSearchPage>();
  const [upcPage, setUpcPage] = useState<UpcitemdbSearchReply>();
  const [mergeOpen, setMergeOpen] = useState(false);
  const sourceName = streamingName(selectedSource);
  const searchName = streamingName(service);
  const [description, setDescription] = useState("");
  const [discogsCredit, setDiscogsCredit] = useState("");
  const [baseline, setBaseline] = useState<string>();
  const [limit, setLimit] = useState(descriptionLimit());
  const [fields, setFields] = useState<string[]>([]);
  const [copyOrigins, setCopyOrigins] = useState<Record<string, {sources: CopyFieldSource[]; edited: boolean}>>({});
  const markEdited = (key: string) => setCopyOrigins(current => current[key] ? {...current, [key]: {...current[key]!, edited: true}} : current);
  const [confirmDescription, setConfirmDescription] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchAppending, setSearchAppending] = useState(false);
  const searchRevision = useRef(0);
  useEffect(() => () => {searchRevision.current++;}, []);
  const [requestId, setRequestId] = useState("");
  const refreshCredential = () => void chrome.storage.local.get("tmdb.readToken")
    .then(value => setConfigured(Boolean(value["tmdb.readToken"])))
    .catch(() => setFeedback("Não foi possível ler a credencial TMDb."));
  const refreshDiscogs = () => void extensionRequest<{configured: boolean}>({type: "discogs:status"})
    .then(value => setDiscogsConfigured(value.configured)).catch(() => setFeedback("Não foi possível ler a configuração Discogs."));
  const refreshLastfm = () => void extensionRequest<{configured: boolean}>({type: "lastfm:status"})
    .then(value => setLastfmConfigured(value.configured)).catch(() => setFeedback("Não foi possível ler a configuração Last.fm."));
  useEffect(() => {refreshCredential(); refreshDiscogs(); refreshLastfm();}, []);
  const lastAlbum = cards.lastfm?.lastfm;
  useEffect(() => {
    const controller = new AbortController();
    let loaded: AlbumArtworkResource | undefined;
    setLastArtwork(undefined);setLastArtworkError("");setLastArtworkLoading(Boolean(lastAlbum?.artworkUrl));
    if (lastAlbum?.artworkUrl && lastAlbum.lastfm) void loadAlbumArtworkResource(lastAlbum,
      album => extensionRequest<AlbumArtworkFile>({type: "lastfm:artwork", album: album.lastfm!}), {signal: controller.signal})
      .then(resource => {if (controller.signal.aborted) resource.release(); else {loaded = resource;setLastArtwork(resource);}})
      .catch(() => {if (!controller.signal.aborted) setLastArtworkError("Não foi possível carregar a capa. Os demais dados continuam disponíveis.");})
      .finally(() => {if (!controller.signal.aborted) setLastArtworkLoading(false);});
    return () => {controller.abort();loaded?.release();};
  }, [lastAlbum, lastArtworkAttempt]);
  const upcAlbum = cards.upcitemdb?.upcitemdb;
  useEffect(() => {
    const controller = new AbortController();
    let loaded: AlbumArtworkResource | undefined;
    setUpcArtwork(undefined);setUpcArtworkError("");setUpcArtworkLoading(Boolean(upcAlbum?.artworkUrl));
    if (upcAlbum?.artworkUrl) void loadAlbumArtworkResource(upcAlbum,
      album => extensionRequest<AlbumArtworkFile>({type: "metadata:artwork", album, sourceUrl}), {signal: controller.signal})
      .then(resource => {if (controller.signal.aborted) resource.release(); else {loaded = resource; setUpcArtwork(resource);}})
      .catch(() => {if (!controller.signal.aborted) setUpcArtworkError("Não foi possível carregar a capa. Os demais dados continuam disponíveis.");})
      .finally(() => {if (!controller.signal.aborted) setUpcArtworkLoading(false);});
    return () => {controller.abort();loaded?.release();};
  }, [upcAlbum, upcArtworkAttempt]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.isTrusted || event.origin !== parentOrigin || event.source !== window.parent || event.data?.session !== session) return;
      const data = event.data;
      if (data.type === "collection-to-play:description-context") {
        if (typeof data.description === "string") setBaseline(data.description);
        if (!manualInitialized.current && data.manualValues && typeof data.manualValues === "object" && Array.isArray(data.manualFields)) {
          const values: Record<string, string> = {};
          for (const field of MOVIE_MANUAL_FIELDS) {
            const value = data.manualValues[field.key];
            if (typeof value === "string" && value.length <= field.maxLength) values[field.key] = value;
          }
          manualInitialized.current = true;
          setBarcode(current => values["ean_isbn13"] || values["upc_isbn10"] || current);
          setManualOriginal(values);
          setManualValues(values);
          setManualFields(data.manualFields.filter((key: unknown): key is string => typeof key === "string" && MOVIE_MANUAL_FIELDS.some(field => field.key === key)));
          setManualLimits(Object.fromEntries(MOVIE_MANUAL_FIELDS.map(field => {
            const limit = data.manualLimits?.[field.key];
            return [field.key, typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? Math.min(limit, field.maxLength) : field.maxLength];
          })));
        }
        if (typeof data.description === "string") setDescription(current => baseline === undefined && !current ? data.description : current);
        setLimit(descriptionLimit(data.maxLength));
      }
      if (data.type === "collection-to-play:metadata-applied" && requestId && data.requestId === requestId) {
        setRequestId("");
        setBusy(false);
        if (!full && isLibibPatchResult(data.patchResult)) {
          const result = data.patchResult;
          const saved = Object.entries(result.fields).filter(([, status]) => status === "saved")
            .map(([field]) => field === "creators" ? "directors" : field === "image" ? "artwork" : field);
          setFields(current => current.filter(field => !saved.includes(field)));
          setFeedback(describeLibibPatchResult(result));
        } else {
          setFeedback(data.filled ? "Campos preenchidos. Confira e salve no Libib." : String(data.error ?? "Não foi possível preencher os campos."));
        }
      }
    };
    window.addEventListener("message", receive);
    if (!requestId) window.parent.postMessage({type: "collection-to-play:description-context-request", session}, parentOrigin);
    const timeout = requestId ? setTimeout(() => {
      setRequestId("");
      setBusy(false);
      setFeedback("O Libib não confirmou o preenchimento. Confira o formulário.");
    }, 30_000) : undefined;
    return () => {window.removeEventListener("message", receive); clearTimeout(timeout);};
  }, [parentOrigin, session, requestId]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setFeedback("");
    try {await operation();}
    catch (error) {setFeedback(error instanceof Error ? error.message : "Não foi possível concluir a ação.");}
    finally {setBusy(false);}
  };
  const readToken = async () => {
    const value = (await chrome.storage.local.get("tmdb.readToken"))["tmdb.readToken"];
    if (typeof value !== "string" || !value) throw new Error("Salve o token de leitura do TMDb.");
    return value;
  };
  const directors = [...new Set(selected?.credits?.crew?.filter(person => person.job === "Director")
    .map(person => person.name.trim()).filter(Boolean) ?? [])];
  const productArtwork = upcArtwork?.metadata.albumId === String(cards.upcitemdb?.id) ? upcArtwork : undefined;
  const lastfmArtwork = lastArtwork?.metadata.albumId === String(cards.lastfm?.id) ? lastArtwork : undefined;
  const selectedArtwork = selectedSource === "lastfm" ? lastfmArtwork : selectedSource === "upcitemdb" ? productArtwork : undefined;
  const poster = selectedArtwork?.previewUrl ?? (selectedSource === "tmdb" ? posterUrl(selected?.poster_path) : undefined);
  const usesBarcode = service === "discogs" || service === "upcitemdb";
  const descriptionValid = description.trim().length > 0 && description.length <= limit;
  const apply = async () => {
    if (busy || !fields.length || fields.includes("description") && (!confirmDescription || baseline === undefined || !descriptionValid)) return;
    setBusy(true);
    setFeedback("");
    try {
      const patch: Record<string, unknown> = {};
      if (manualFields.length) {
        for (const field of MOVIE_MANUAL_FIELDS) {
          if (fields.includes(field.key)) patch[field.key] = manualValues[field.key] ?? "";
        }
      }
      if (fields.includes("title")) patch.title = title;
      if (fields.includes("directors")) patch.directors = draftDirectors.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
      if (fields.includes("description")) patch.description = description;
      if (fields.includes("artwork") && draftPoster) {
        if (draftArtwork) patch.artwork = draftArtwork.file;
        else {
        const response = await fetch(draftPoster, {credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000)});
        if (!response.ok) throw new Error("Não foi possível baixar a capa do TMDb.");
        const blob = await response.blob();
        patch.artwork = new File([blob], draftPoster.split("/").at(-1) ?? "capa.jpg", {type: blob.type});
        }
      }
      const id = crypto.randomUUID();
      setRequestId(id);
      window.parent.postMessage({type: "collection-to-play:apply-metadata", session, requestId: id, patch,
        ...(fields.includes("description") ? {descriptionReplacement: {confirmed: true, expected: baseline}} : {})}, parentOrigin);
    } catch (error) {
      setBusy(false);
      setFeedback(error instanceof Error ? error.message : "Não foi possível preencher os campos.");
    }
  };

  function copy(key?: string) {
    if (!selected) return;
    const added: string[] = [];
    if (!key || key === "title") {setTitle(selected.title); added.push("title");}
    if ((!key || key === "directors") && directors.length) {setDraftDirectors(directors.join("\n")); added.push("directors");}
    if ((!key || key === "artwork") && poster) {
      const resource = selectedArtwork;
      setDraftArtwork(current => current === resource ? current : resource?.retain());
      setDraftPoster(poster); added.push("artwork");
    }
    if ((!key || key === "description") && baseline !== undefined && sourceDescription) {
      setDescription(sourceDescription); setDiscogsCredit(selected.release ? `https://www.discogs.com/release/${selected.id}` : ""); setConfirmDescription(false); added.push("description");
    }
    if (manualFields.length) {
      for (const [field, value] of Object.entries(manualSource)) {
        if ((!key || key === field) && value && manualFields.includes(field)) {
          setManualValues(current => ({...current, [field]: value}));
          added.push(field);
        }
      }
    }
    setFields(current => [...new Set([...current, ...added])]);
    setCopyOrigins(current => ({...current, ...Object.fromEntries(added.map(key => [key, {sources: [{service: selectedSource, albumId: String(selected.id)}], edited: false}]))}));
  }
  function reset(key: string) {
    setCopyOrigins(current => {const next = {...current}; delete next[key]; return next;});
    if (manualFields.length) setManualValues(current => ({...current, [key]: manualOriginal[key] ?? ""}));
    if (key === "title") setTitle(initialTitle);
    if (key === "directors") setDraftDirectors(initialDirectors);
    if (key === "artwork") {setDraftPoster(undefined);setDraftArtwork(undefined);}
    if (key === "description") {setDiscogsCredit(""); setDescription(baseline ?? ""); setConfirmDescription(false);}
    setFields(current => current.filter(field => field !== key));
  }
  function useInSearch(key: string, value: string) {
    if (key === "title") setQuery(value); else setBarcode(value);
    clearResults();
    setFeedback("Campo levado para a busca. Clique em Buscar vídeos para consultar.");
    requestAnimationFrame(() => document.getElementById(key === "title" ? "video-title" : "video-barcode")?.focus({preventScroll: true}));
  }
  function clearResults() {
    searchRevision.current++;setSearching(false);setSearchAppending(false);
    setResults([]);setDiscogsPage(undefined);setUpcPage(undefined);setLastfmPage(undefined);
  }
  function useReadCode(key: string, value: string) {
    if (busy || !manualFields.includes(key)) return;
    setManualValues(current => ({...current, [key]: value}));
    setCopyOrigins(current => {const next = {...current};delete next[key];return next;});
    setFields(current => [...new Set([...current, key])]);
    setFeedback("Código lido preenchido. Confira os campos antes de aplicar.");
    requestAnimationFrame(() => document.getElementById(`composed-${key}`)?.focus({preventScroll: true}));
  }
  function serviceReady(id: VideoService) {return id === "upcitemdb" || (id === "lastfm" ? lastfmConfigured : id === "tmdb" ? configured : discogsConfigured);}
  function tmdbDocument(detail: Details): AlbumDescription {
    const sections: DescriptionSection[] = [{field: "title", label: "Título", text: `Título: ${detail.title}`}];
    const names = detail.credits?.crew?.filter(person => person.job === "Director").map(person => person.name) ?? [];
    if (names.length) sections.push({field: "directors", label: "Diretores", text: `Diretores: ${names.join(", ")}`});
    if (detail.release_date) sections.push({field: "releaseDate", label: "Lançamento", text: `Lançamento: ${detail.release_date}`});
    if (detail.runtime) sections.push({field: "duration", label: "Duração", text: `Duração: ${detail.runtime} min`});
    if (detail.genres?.length) sections.push({field: "genres", label: "Gêneros", text: `Gêneros: ${detail.genres.map(genre => genre.name).join(", ")}`});
    if (detail.overview) sections.push({field: "about", label: "Sinopse", text: `Sinopse:\n${detail.overview}`});
    return {service: "tmdb", albumId: String(detail.id), sections, listedTracks: 0, notes: [],
      manualFields: detail.overview ? {notes: detail.overview} : {},
      text: formatDescriptionText(sections, {service: "tmdb", url: `https://www.themoviedb.org/movie/${detail.id}`}, {preserveLongText: true})};
  }
  async function searchVideos(append = false, chosenService = service) {
    const revision = ++searchRevision.current;
    setSearching(true); setSearchAppending(append);
    try {
      if (chosenService === "lastfm") {
        const page = await extensionRequest<MetadataSearchReply>({type: "metadata:search", service: "lastfm", sourceUrl,
          title: query.trim(), artist: discogsArtist.trim(), language: lastfmLanguage,
          ...(append && lastfmPage ? {nextPage: lastfmPage} : {})});
        if (revision !== searchRevision.current) return;
        if (page.connectionRequired) {setLastfmConfigured(false);return;}
        const candidates = "candidates" in page.resolution ? page.resolution.candidates : [];
        const movies = candidates.map(candidate => ({id: candidate.id, title: candidate.title, lastfm: candidate}));
        setLastfmPage("nextPage" in page.resolution ? page.resolution.nextPage : undefined);
        setDiscogsPage(undefined);setUpcPage(undefined);
        setResults(current => [...new Map((append ? [...current, ...movies] : movies).map(movie => [String(movie.id), movie])).values()]);
        setFeedback(movies.length ? "Confira o show e o artista. O Last.fm não identifica a edição DVD/Blu-ray." : "Nenhum resultado encontrado no Last.fm. Confira título e artista.");
      } else if (chosenService === "upcitemdb") {
        const page = await extensionRequest<UpcitemdbSearchReply>({type: "upcitemdb:search", sourceUrl, query: {
          title: query.trim(), artist: discogsArtist.trim(), barcode: barcode.trim(), media: "movie",
          ...(append && upcPage?.nextPage ? {nextPage: upcPage.nextPage} : {}),
        }});
        if (revision !== searchRevision.current) return;
        const movies = page.candidates.map(value => {
          const candidate = validateUpcitemdbCandidate(value);
          return {id: candidate.id, title: candidate.title, upcitemdb: candidate};
        });
        setUpcPage(page);setDiscogsPage(undefined);
        setResults(current => [...new Map((append ? [...current, ...movies] : movies).map(movie => [String(movie.id), movie])).values()]);
        setFeedback(movies.length ? "Confira a edição física; a busca por título não confirma o código do exemplar."
          : page.nextPage ? "Nenhum produto aproveitável nesta página. Você pode carregar mais resultados." : "Nenhum produto encontrado no UPCitemdb. Confira título ou código.");
      } else if (chosenService === "discogs") {
        const page = await extensionRequest<DiscogsSearchPage>({type: "discogs:search", query: {
          title: query.trim(), artist: discogsArtist.trim(), barcode: barcode.trim(), media: "movie",
          ...(append && discogsPage ? {page: discogsPage.page + 1, mode: discogsPage.mode} : {}),
        }});
        if (revision !== searchRevision.current) return;
        setDiscogsPage(page);
        const movies = page.candidates.map(candidate => ({id: Number(candidate.id), title: candidate.title,
          release_date: candidate.releaseDate ?? "", discogs: candidate}));
        setResults(current => append ? [...current, ...movies] : movies);
        setFeedback(movies.length ? "" : "Nenhuma edição de vídeo musical encontrada no Discogs. Confira título ou código.");
      } else {
        const credential = await readToken();
        if (revision !== searchRevision.current) return;
        let term = query.trim();
        let data = await tmdb<{results: Movie[]}>("search/movie", credential, {query: term, include_adult: "false"});
        if (revision !== searchRevision.current) return;
        const simplified = term.replace(/\s*(?:[-–—]\s*)?[([]?(?:blu[ -]?ray|dvd|vhs)[)\]]?\s*$/i, "").trim();
        if (!data.results.length && simplified && simplified !== term) {
          term = simplified;
          data = await tmdb<{results: Movie[]}>("search/movie", credential, {query: term, include_adult: "false"});
          if (revision !== searchRevision.current) return;
        }
        setDiscogsPage(undefined);
        setResults(data.results);
        setFeedback(data.results.length ? "" : `Nenhum vídeo encontrado para “${term}”. Exporte o diagnóstico nas configurações.`);
      }
    } catch (error) {if (revision === searchRevision.current) throw error;}
    finally {if (revision === searchRevision.current) setSearching(false);}
  }
  async function add(movie: Movie) {
    if (movie.lastfm) {
      const found = movie.lastfm;
      const data = found.lastfm ?? await extensionRequest<LastfmAlbum>({type: "lastfm:album", title: found.title,
        artist: found.artists[0]?.name ?? "", language: lastfmLanguage});
      const candidate = lastfmCandidate(data);
      if (candidate.id !== found.id) throw new Error("O Last.fm retornou outro resultado.");
      setCards(current => ({...current, lastfm: {id: candidate.id, title: candidate.title, lastfm: candidate, document: lastfmDescription(candidate)}}));
      setSelectedSource("lastfm");return;
    }
    if (movie.upcitemdb) {
      const candidate = validateUpcitemdbCandidate(movie.upcitemdb);
      setCards(current => ({...current, upcitemdb: {id: candidate.id, title: candidate.title, upcitemdb: candidate, document: candidate.description!}}));
      setSelectedSource("upcitemdb");return;
    }
    if (typeof movie.id !== "number" || !Number.isSafeInteger(movie.id) || movie.id < 1) throw new Error("Resultado inválido.");
    if (movie.discogs) {
      const result = await extensionRequest<{release: DiscogsRelease; description: AlbumDescription}>({type: "discogs:release", id: String(movie.id)});
      const release = result.release;
      if (!release.formats.some(format => /DVD|Blu-ray|VHS|Laserdisc|Video/i.test(format))) throw new Error("Esta edição não foi identificada como vídeo.");
      const detail: Details = {id: movie.id, title: release.title, release_date: release.released ?? "", document: result.description, release,
        credits: {crew: release.directors.map(name => ({name, job: "Director"}))}};
      setCards(current => ({...current, discogs: detail}));
      setSelectedSource("discogs");
    } else {
      const detail = await tmdb<Details>(`movie/${movie.id}`, await readToken(), {append_to_response: "credits"});
      if (detail.id !== movie.id || !detail.title?.trim()) throw new Error("O TMDb retornou outro vídeo.");
      detail.document = tmdbDocument(detail);
      setCards(current => ({...current, tmdb: detail}));
      setSelectedSource("tmdb");
    }
  }
  function extraSource(card: Details | undefined): Record<string, string> {
    if (card?.lastfm) {
      const values = card.document?.manualFields ?? {};
      return Object.fromEntries(["notes", "tags"].filter(key => values[key] !== undefined).map(key => [key, values[key]!]));
    }
    const releaseParts = card?.release_date?.split("-") ?? [];
    return card?.release || card?.upcitemdb ? {...card.document?.manualFields} : {
      ...card?.document?.manualFields,
      ensemble: card?.credits?.cast?.map(person => person.name).join(", ") ?? "",
      publisher: card?.production_companies?.map(company => company.name).join(", ") ?? "",
      publish_year: releaseParts[0] ?? "",
      publish_month: releaseParts[1] ?? "",
      publish_day: releaseParts[2] ?? "",
      length_of: card?.runtime ? String(card.runtime) : "",
    };
  }
  const manualSource = extraSource(selected);
  const catalogMatches = matchingCatalogSources(Object.values(cards).filter((card): card is Details => Boolean(card)).map(card => ({
    source: {service: card.lastfm ? "lastfm" as const : card.upcitemdb ? "upcitemdb" as const : card.release ? "discogs" as const : "tmdb" as const, albumId: String(card.id)},
    values: {title: card.title, directors: card.credits?.crew?.filter(person => person.job === "Director").map(person => person.name),
      description: baseline !== undefined ? card.document?.text : undefined,
      ...Object.fromEntries(manualFields.map(key => [key, extraSource(card)[key]]))},
  })),
    {title: initialTitle, directors: initialDirectors, description: baseline, ...manualOriginal},
    {title, directors: draftDirectors, description, ...manualValues});
  const includedData = [...fields, ...Object.keys(catalogMatches)];
  function availableCardData(card: Details): Record<string, boolean> {
    const extras = extraSource(card);
    return {title: Boolean(card.title.trim()),
      directors: Boolean(card.credits?.crew?.some(person => person.job === "Director" && person.name.trim())),
      artwork: Boolean(card.lastfm ? lastfmArtwork : card.upcitemdb ? productArtwork : posterUrl(card.poster_path)), description: baseline !== undefined && Boolean(card.document?.text.trim()),
      ...Object.fromEntries(manualFields.map(key => [key, Boolean(extras[key]?.trim())]))};
  }
  const items = [
    {key: "title", label: "Título", available: Boolean(selected?.title), value: selected?.title},
    {key: "directors", label: "Diretores", available: directors.length > 0, value: directors.join(", ")},
    {key: "artwork", label: "Capa", available: Boolean(poster), value: poster},
    {key: "description", label: "Descrição", available: baseline !== undefined && Boolean(sourceDescription), value: sourceDescription},
    ...MOVIE_MANUAL_FIELDS.filter(field => manualFields.includes(field.key)).map(field => ({
      key: field.key, label: field.label, available: Boolean(manualSource[field.key]), value: manualSource[field.key],
    })),
  ];
  const pendingItems = items.filter(item => item.available && copyButtonState(
    selected ? {service: selectedSource, albumId: String(selected.id)} : undefined,
    copyOrigins[item.key]?.sources ?? [], fields.includes(item.key), catalogMatches[item.key]) === "available");
  function copyPending(): void {
    if (busy) return;
    for (const item of pendingItems) copy(item.key);
  }
  const canApply = fields.length > 0 && (!fields.includes("title") || Boolean(title.trim())) &&
    (!fields.includes("directors") || Boolean(draftDirectors.trim())) &&
    (!fields.includes("description") || descriptionValid && confirmDescription);

  return <>
    <h1>{manual ? "Preencher entrada manual de vídeo" : "Compor dados do vídeo"}</h1><p class="intro">Escolha um vídeo nos serviços e copie os campos que deseja usar.</p>
    <div class="workspace">
      <section class="panel card card-border bg-base-100" aria-label="Buscar e escolher fontes">
        <form class="search-form" onSubmit={event => {
          event.preventDefault();
          void run(() => searchVideos());
        }}>
          <fieldset class="wide streaming-picker" id="streaming-service">
            <legend>Serviços</legend>
            <div class="streaming-choices">
              {VIDEO_SERVICES.map(id => <button key={id} class="btn streaming-choice" type="button"
                aria-pressed={service === id} disabled={busy} onClick={() => {
                  setService(id); clearResults();
                  if (!cards[id] && serviceReady(id) && (query.trim() || (id === "discogs" || id === "upcitemdb") && barcode.trim())) void run(() => searchVideos(false, id));
                }}>
                <span class="streaming-choice-name">{id === "tmdb" ? <ActionIcon name="video"/> : <StreamingIcon service={id}/>}<span>{streamingName(id)}</span></span>
                <span class="streaming-choice-status">{cards[id] && <><ActionIcon name="check"/>Adicionado</>}</span>
              </button>)}
            </div>
          </fieldset>
          {service === "upcitemdb" && <p class="note wide">Consultas limitadas no plano gratuito. Confira o código antes de buscar.</p>}
          {usesBarcode && <div class="wide"><label for="video-barcode">EAN ou UPC (opcional)</label><div class="search-input-group"><input id="video-barcode" class="input w-full" value={barcode} maxLength={32} disabled={busy} onInput={event => {setBarcode(event.currentTarget.value); clearResults();}}/>
            <BarcodeReaderButton target="search" fieldLabel="a busca" disabled={busy} onUse={value => {
              setBarcode(value);clearResults();setFeedback("Código lido preenchido. Clique em Buscar vídeos para consultar.");
              requestAnimationFrame(() => document.getElementById("video-barcode")?.focus({preventScroll: true}));
            }}/></div><p class="note">Consulta primeiro o código, depois o título se necessário.</p></div>}
          <div class="wide"><label for="video-title">Vídeo</label><div class="search-input-group">
            <input id="video-title" class="input w-full" value={query} maxLength={service === "lastfm" ? 200 : 512} disabled={busy} onInput={event => {setQuery(event.currentTarget.value); clearResults();}}/>
            <button class="btn btn-soft btn-square reset-search" type="button" aria-label="Restaurar título original" title="Restaurar título original" disabled={busy || query === initialTitle} onClick={() => {setQuery(initialTitle);clearResults();}}><ActionIcon name="refresh"/></button>
          </div></div>
          {service !== "tmdb" && <div class="wide"><label for="discogs-video-artist">{service === "lastfm" ? "Artista/banda (opcional)" : "Artista (opcional)"}</label><input id="discogs-video-artist" class="input w-full" value={discogsArtist} maxLength={200} disabled={busy} onInput={event => {setDiscogsArtist(event.currentTarget.value); clearResults();}}/></div>}
          {service === "lastfm" && <><div class="wide"><label for="video-lastfm-language">Idioma Last.fm</label><select id="video-lastfm-language" class="select w-full" disabled={busy} value={lastfmLanguage} onChange={event => {setLastfmLanguage(event.currentTarget.value as "pt" | "en");clearResults();}}><option value="pt">Português</option><option value="en">Inglês</option></select></div><p class="note wide">Fonte complementar para shows musicais. Confira artista e obra; a edição DVD/Blu-ray não é identificada.</p></>}
          <div class="wide search-actions"><button class="btn btn-primary" disabled={busy || !serviceReady(service) || (!query.trim() && !(usesBarcode && barcode.trim()))}><ActionIcon name="search"/>Buscar vídeos</button><span class="note">{searchName}</span></div>
        </form>
        {!serviceReady(service) && <div class="connection alert alert-warning alert-soft">
          <p>Configure a credencial {searchName} para buscar.</p>
          <a href={chrome.runtime.getURL("setup.html") + `#${service}-settings`} target="_blank" rel="noopener noreferrer">Abrir configurações</a><br/>
          <button class="btn btn-sm" type="button" onClick={() => {refreshCredential(); refreshDiscogs(); refreshLastfm();}}>Verificar configuração</button>
        </div>}
        <p class="status" role="status">{busy ? "Aguarde…" : feedback}</p>
        {results.length > 0 && (!searching || searchAppending) && <><span class="results-title">Resultados no {searchName}</span><ul class="results" id="video-results">{results.map(movie => {
          const image = posterUrl(movie.poster_path);
          return <li class="result card card-border" key={movie.id}>
            {movie.lastfm ? <AlbumArtwork album={movie.lastfm}/> : movie.upcitemdb ? <AlbumArtwork album={movie.upcitemdb}/> : movie.discogs ? <DiscogsSearchThumbnail album={movie.discogs}/> : image && <img class="thumb" src={image} alt="" referrerPolicy="no-referrer"/>}
            <div class="result-info"><h3>{movie.title}</h3>{movie.lastfm && <p>{movie.lastfm.artists.map(artist => artist.name).join(", ")}</p>}<p class="note">{movie.release_date?.slice(0, 4)}</p>{movie.discogs && <DiscogsEditionInfo album={movie.discogs}/>}{movie.upcitemdb && <UpcitemdbProductInfo album={movie.upcitemdb}/>}</div>
            <button class="btn btn-soft btn-sm" type="button" disabled={busy || Boolean(cards[service])} onClick={() => void run(() => add(movie))}><ActionIcon name="album-add"/>Adicionar vídeo</button>
          </li>;
        })}</ul></>}
        {searching && <SearchResultsSkeleton video/>}
        {service === "lastfm" && lastfmPage && <button class="more btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => void run(() => searchVideos(true))}>Carregar mais resultados</button>}
        {service === "upcitemdb" && upcPage?.nextPage && <button class="more btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => void run(() => searchVideos(true))}>Carregar mais resultados</button>}
        {service === "discogs" && discogsPage && discogsPage.page < discogsPage.pages && <button class="more btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => void run(() => searchVideos(true))}>Carregar mais resultados</button>}
        <div class="layout-heading" id="video-source"><h2>Vídeos escolhidos</h2><span class="badge badge-soft">{Object.values(cards).filter(Boolean).length} / {VIDEO_SERVICES.length}</span></div>
        <ul class="source-cards">{VIDEO_SERVICES.map(id => {
          const card = cards[id];
          if (!card) return null;
          const image = id === "lastfm" ? lastfmArtwork?.previewUrl : id === "upcitemdb" ? productArtwork?.previewUrl : posterUrl(card.poster_path);
          return <li class={`source-card card card-border${selectedSource === id ? " selected" : ""}`} key={id}>
            <button class="source-select" type="button" aria-pressed={selectedSource === id} disabled={busy} onClick={() => setSelectedSource(id)}>
              {image && <img class="thumb" src={image} alt="" referrerPolicy="no-referrer" onLoad={event => setSourceSize({url: image, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}/>}
              <span><span class="service">{id === "tmdb" ? <ActionIcon name="video"/> : <StreamingIcon service={id}/>}{streamingName(id)}</span><strong>{card.title}</strong>
                {image && sourceSize?.url === image && <ArtworkDimensions width={sourceSize!.width} height={sourceSize!.height}/>}
                {id === "upcitemdb" && !productArtwork && <span class="card-artwork-size">{upcArtworkLoading ? "Carregando capa…" : card.upcitemdb?.artworkUrl ? "Capa indisponível" : "Dados do produto"}</span>}
                {card.release && <span class="card-artwork-size">{[card.release.country, ...card.release.formats].filter(Boolean).join(" · ")}</span>}
                <UnusedDataBadge available={availableCardData(card)} included={includedData}/>
              </span>
            </button>
            <button class="remove btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => {
              setCards(current => {const next = {...current}; delete next[id]; return next;});
              if (selectedSource === id) setSelectedSource(VIDEO_SERVICES.find(other => other !== id && cards[other]) ?? "tmdb");
            }}><ActionIcon name="trash"/>Remover</button>
          </li>;
        })}</ul>
        {selected ? <>
          <section class="details" aria-label={`Dados do ${sourceName}`}>
            <div class="layout-heading"><h2>Dados do {sourceName}</h2><div class="source-copy-actions"><button class="btn btn-soft btn-sm" type="button" disabled={busy || !pendingItems.length} onClick={copyPending}>+ Pendentes</button><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => copy()}><ActionIcon name="copy"/>+ todos</button></div></div>
            {selected.release && <><DiscogsBatch release={selected.release}/><a class="note" href={`https://www.discogs.com/release/${selected.id}`} target="_blank" rel="noopener noreferrer">Data provided by Discogs.</a><p class="note">{selected.release.labels.join(", ")} · {selected.release.catalogNumbers.join(", ")}</p></>}
            {selected.lastfm && <><p>Artista/banda: {selected.lastfm.artists.map(artist => artist.name).join(", ")}</p>
              {lastArtworkLoading && <p class="note">Carregando capa…</p>}
              {lastArtworkError && <p class="note">{lastArtworkError} <button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => setLastArtworkAttempt(value => value + 1)}>Tentar obter a capa novamente</button></p>}
              {selected.document?.notes.map(note => <p class="note">{note}</p>)}</>}
            {selected.upcitemdb && <><UpcitemdbProductInfo album={selected.upcitemdb} showCodes={false}/>
              {upcArtworkLoading && <p class="note">Carregando capa… Você já pode usar os outros dados.</p>}
              {upcArtworkError && <><p class="note">{upcArtworkError}</p><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => setUpcArtworkAttempt(value => value + 1)}>Tentar obter a capa novamente</button></>}
              {selected.document?.notes.map(note => <p class="note">{note}</p>)}</>}
            {items.filter(item => item.value?.trim()).map(item => <div class="detail-field" key={item.key}><div><h3>{item.label}</h3>
              {item.key === "artwork" && item.value ? selectedArtwork ? <ArtworkPreview src={selectedArtwork.previewUrl} alt={`Capa do ${sourceName}`} metadata={selectedArtwork.metadata}/> : <VideoArtwork key={item.value} src={item.value} alt={`Capa do ${sourceName}`}/>
                : item.key === "description" && item.value ? <pre class="description-preview">{item.value}</pre>
                : <p>{item.value}</p>}
              {manualFields.length > 0 && selectedSource === "tmdb" && item.key === "publisher" && <p class="note">Produtoras da obra no TMDb. Confira o estúdio da sua edição.</p>}
              {manualFields.length > 0 && selectedSource === "tmdb" && item.key === "publish_year" && <p class="note">Data da obra no TMDb. Confira o lançamento da sua edição.</p>}
            </div><CopyFieldButton label={`Copiar ${item.label.toLowerCase()}`} target={{service: selectedSource, albumId: String(selected.id)}} matchedSource={catalogMatches[item.key]} sources={copyOrigins[item.key]?.sources ?? []} edited={Boolean(copyOrigins[item.key]?.edited)} included={fields.includes(item.key)} disabled={busy || !item.available} onCopy={() => copy(item.key)}/></div>)}
          </section>
        </> : <p class="empty">Adicione um vídeo nos resultados da busca.</p>}
        <p class="note">This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.</p>
        <p class="note video-attribution"><a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDb</a> · This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </section>
      <form class="panel draft card card-border bg-base-200" aria-label="Formulário principal" onSubmit={event => {event.preventDefault(); if (canApply) void apply();}}>
        <h2>Dados para o Libib</h2><p class="note">Marque os campos que deseja aplicar.</p>
        {items.map(({key, label}) => {
          const disabled = busy || key === "artwork" && !draftPoster || key === "description" && baseline === undefined;
          return <div class="draft-field" key={key}>
            <div class="field-heading">
              <input id={`include-${key}`} type="checkbox" aria-label={`Aplicar ${label.toLowerCase()}`} class="checkbox checkbox-primary checkbox-sm" disabled={disabled} checked={fields.includes(key)}
                onChange={event => setFields(event.currentTarget.checked ? [...fields, key] : fields.filter(field => field !== key))}/>
              <label for={key === "artwork" ? "include-artwork" : `composed-${key}`}>{label}</label>
              {(key === "ean_isbn13" || key === "upc_isbn10") && <BarcodeReaderButton
                target={key === "ean_isbn13" ? "ean" : "upc"} fieldLabel={label}
                disabled={busy || (manualLimits[key] ?? (key === "ean_isbn13" ? 13 : 12)) < (key === "ean_isbn13" ? 13 : 12)}
                onUse={value => useReadCode(key, value)}/>}
              {key === "title" && <UseInSearchButton label="título" value={title} disabled={busy} onUse={value => useInSearch(key, value)}/>}
              {usesBarcode && (key === "ean_isbn13" || key === "upc_isbn10") &&
                <UseInSearchButton label={label} value={manualValues[key] ?? ""} disabled={busy} onUse={value => useInSearch(key, value)}/>}
              {key === "description" && Object.values(cards).filter(card => card?.document).length > 1 && <button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => setMergeOpen(true)}><ActionIcon name="document"/>Combinar descrições</button>}
              <button class="btn btn-soft btn-square btn-sm" type="button" aria-label={`Restaurar ${label.toLowerCase()} original`} title={`Restaurar ${label.toLowerCase()} original`}
                disabled={disabled || !fields.includes(key)} onClick={() => reset(key)}><ActionIcon name="refresh"/></button>
            </div>
            {MOVIE_MANUAL_FIELDS.some(field => field.key === key) && <textarea
              id={`composed-${key}`} class="textarea w-full" rows={key === "notes" || key === "ensemble" ? 3 : 1}
              maxLength={manualLimits[key] ?? MOVIE_MANUAL_FIELDS.find(field => field.key === key)?.maxLength}
              value={manualValues[key] ?? ""} disabled={busy}
              onInput={event => {
                const value = event.currentTarget.value;
                setManualValues(current => ({...current, [key]: value})); markEdited(key);
                setFields(current => [...new Set([...current, key])]);
              }}/>}
            {key === "title" && <input id="composed-title" class="input w-full" maxLength={512} value={title} disabled={busy} onInput={event => {markEdited("title"); setTitle(event.currentTarget.value); setFields(current => [...new Set([...current, "title"])]);}}/>}
            {key === "directors" && <><textarea id="composed-directors" class="textarea w-full" rows={3} value={draftDirectors} disabled={busy} onInput={event => {markEdited("directors"); setDraftDirectors(event.currentTarget.value); setFields(current => [...new Set([...current, "directors"])]);}}/><p class="note">Um diretor por linha.</p></>}
            {key === "artwork" && (draftPoster ? draftArtwork ? <ArtworkPreview src={draftArtwork.previewUrl} alt="Capa escolhida para o Libib" metadata={draftArtwork.metadata}/> : <VideoArtwork key={draftPoster} src={draftPoster} alt="Capa escolhida para o Libib"/> : <p class="note">A capa atual será mantida.</p>)}
            {key === "description" && <>
              <textarea id="composed-description" class="textarea w-full" rows={7} value={description} disabled={disabled}
                onInput={event => {
                  let text = event.currentTarget.value;
                  if (discogsCredit && (!text.includes("Data provided by Discogs.") || !text.includes(discogsCredit))) {
                    text = text.trimEnd() + `\n\nData provided by Discogs.\n${discogsCredit}`;
                  }
                  markEdited("description"); setDescription(text); setConfirmDescription(false); setFields(current => [...new Set([...current, "description"])]);
                }}/>
              <p class="note">{description.length} / {limit} caracteres</p>
              {baseline !== undefined && <details class="original-description"><summary>Ver descrição atual do Libib</summary><pre class="description-preview">{baseline || "Sem descrição."}</pre></details>}
              {fields.includes("description") && <label class="description-confirm"><input type="checkbox" class="checkbox checkbox-primary checkbox-sm" checked={confirmDescription} disabled={busy}
                onChange={event => setConfirmDescription(event.currentTarget.checked)}/>Confirmo substituir a descrição atual pelo texto acima.</label>}
            </>}
          </div>;
        })}
        <p class="note">{manual ? "Confira os campos preenchidos e clique em Enviar no Libib." : full ? "Confira os campos preenchidos e salve pelo botão do Libib." : "Aplicar salva imediatamente os campos marcados no Libib."}</p>
        <button class="btn btn-primary" disabled={busy || !canApply}><ActionIcon name="check"/>{full ? "Preencher campos" : "Aplicar dados"}</button>
      </form>
    </div>
    {mergeOpen && <DescriptionMergeDialog maxLength={limit} cards={Object.entries(cards).filter(([, card]) => card?.document).map(([id, card]) => ({
      album: {service: id, id: String(card!.id), title: card!.title, url: card!.lastfm?.url ?? card!.upcitemdb?.url ?? (id === "tmdb" ? `https://www.themoviedb.org/movie/${card!.id}` : `https://www.discogs.com/release/${card!.id}`)},
      description: card!.document,
    }))} onCancel={() => setMergeOpen(false)} onUse={(text, sources) => {
      setDiscogsCredit(sources.some(source => source.service === "discogs") && cards.discogs ? `https://www.discogs.com/release/${cards.discogs.id}` : "");
      setCopyOrigins(current => ({...current, description: {sources: sources.map(source => ({service: source.service, albumId: source.albumId})), edited: false}}));
      setDescription(text); setConfirmDescription(false); setFields(current => [...new Set([...current, "description"])]); setMergeOpen(false);
    }}/>}
  </>;
}
