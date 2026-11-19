import {UpcitemdbProductInfo} from "../../components/upcitemdb-product-info.js";
import {CopyFieldButton} from "../../components/copy-field-button.js";
import {copyButtonState, compositionCopySources, matchingCatalogSources} from "../../albums/field-copy-status.js";
import {DiscogsBatch, DiscogsEditionInfo, DiscogsSearchThumbnail} from "../../components/discogs-edition-info.js";
import {lastfmCandidate} from "../../albums/lastfm-source.js";
import type {LastfmAlbum} from "../../streamings/lastfm.js";
import {ManualMusicFields, type ManualMusicField} from "../../components/manual-music-fields.js";
import {UnusedDataBadge} from "../../components/unused-data-badge.js";
import {UseInSearchButton} from "../../components/use-in-search-button.js";
import {SearchResultsSkeleton} from "../../components/search-results-skeleton.js";
import {BarcodeReaderButton} from "../../components/barcode-reader.js";
import {MUSIC_MANUAL_FIELDS} from "../../shared/manual-entry-fields.js";
import {VideoEditor} from "./video-editor.js";
import {DescriptionMergeDialog} from "../../components/description-merge-dialog.js";
import type {MergeCard, MergeSelection} from "../../albums/description-merge.js";
import {rankDescriptionCompleteness} from "../../albums/description-completeness.js";
import {DESCRIPTION_LIMIT, descriptionLimit, descriptionText, descriptionUsesDetails, type AlbumDescription, type DescriptionReplacement} from "../../albums/album-description.js";
import {ActionIcon, AlbumArtwork, ArtworkDimensions, ArtworkPreview, StreamingIcon} from "../../components/ui-components.js";
import {render} from "preact";
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {AlbumComposition, type CompositionField, type CompositionPatch, type FieldSource} from "../../albums/album-composition.js";
import {loadAlbumArtworkResource, type AlbumArtworkFile} from "../../albums/album-artwork.js";
import {MetadataSearchSession, isMetadataService, metadataQueryKey, metadataUsesProductCode, metadataProductCode} from "../../streamings/metadata-search.js";
import {METADATA_SERVICE_IDS, isSupportedCatalogUrl, type AlbumCandidate, type AppReply, type AppRequest, type MetadataServiceId, type MetadataServicesReply} from "../../shared/contracts.js";
import {describeLibibApplyResult, isLibibApplyResult, describeLibibPatchResult, isLibibPatchResult, type LibibPatchResult, type LibibApplyResult} from "../../libib/libib-metadata.js";

const params = new URLSearchParams(location.search);
const sourceUrl = params.get("source") ?? "", session = params.get("session") ?? "";
const manual = params.get("editor") === "manual";
const full = params.get("editor") === "full" || manual, selective = params.get("selective") === "true";
const initialTitle = (params.get("title") ?? "").slice(0, 512), initialArtist = (params.get("artist") ?? "").slice(0, 2000);
const initialService = params.get("service");
const names: Record<MetadataServiceId, string> = {spotify: "Spotify", "youtube-music": "YouTube Music", "apple-music": "iTunes", deezer: "Deezer", lastfm: "Last.fm", discogs: "Discogs", tmdb: "TMDb", upcitemdb: "UPCitemdb"};
const labels = {title: "Título", artists: "Artistas", artwork: "Capa", description: "Descrição"};
async function request<T>(message: AppRequest): Promise<T> {
  const reply: AppReply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error("A extensão não respondeu. Reabra o editor.");
  if (!reply.ok) {const error = new Error(reply.error.message); error.name = message.type === "metadata:artwork" ? "ArtworkError" : "Error"; Object.assign(error, {code: reply.error.code}); throw error;}
  return reply.data;
}
function origin(source: FieldSource): string {
  const value = source.kind === "manual" ? source.basedOn : source;
  const name = value.kind === "catalog" ? "Libib" : value.kind === "complementary" ? `Last.fm · ${value.albumTitle}` : value.kind === "merged" ? `Descrição combinada${value.sources.length ? ` · ${value.sources.map(source => names[source.service]).join(", ")}` : ""}` : `${names[value.service]}${value.albumTitle ? ` · ${value.albumTitle}` : ""}`;
  return source.kind === "manual" ? `Edição manual · ${name}` : name;
}
function applyToLibib(patch: CompositionPatch, signal: AbortSignal, descriptionReplacement?: DescriptionReplacement): Promise<LibibApplyResult | LibibPatchResult | {filled: true}> {
  return new Promise((resolve, reject) => {
    if (!session || window.parent === window || signal.aborted) {reject(new Error("Reabra esta ação no editor do Libib.")); return;}
    const requestId = crypto.randomUUID(), parentOrigin = new URL(sourceUrl).origin;
    const finish = (): void => {clearTimeout(timer); window.removeEventListener("message", receive); signal.removeEventListener("abort", abort);};
    const receive = (event: MessageEvent): void => {
      if (!event.isTrusted || event.source !== window.parent || event.origin !== parentOrigin || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data["type"] !== "collection-to-play:metadata-applied" || data["session"] !== session || data["requestId"] !== requestId) return;
      finish();
      if (full && data["filled"] === true) resolve({filled: true});
      else if (!full && isLibibPatchResult(data["patchResult"])) resolve(data["patchResult"]);
      else if (!full && isLibibApplyResult(data["result"])) resolve(data["result"]);
      else reject(new Error(typeof data["error"] === "string" ? data["error"].slice(0, 300) : "Confira o item no Libib antes de tentar novamente."));
    };
    const abort = (): void => {finish(); reject(new Error("Editor encerrado."));};
    const timer = setTimeout(() => {finish(); reject(new Error("A confirmação demorou. Confira o item no Libib."));}, 75_000);
    window.addEventListener("message", receive); signal.addEventListener("abort", abort, {once: true});
    window.parent.postMessage({type: "collection-to-play:apply-metadata", session, requestId,
      ...(descriptionReplacement ? {descriptionReplacement} : {}), ...(selective ? {patch} : {metadata: {title: patch.title, artists: patch.artists}})}, parentOrigin);
  });
}

function ResetSearchIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/></svg>;
}

function MetadataEditor() {
  const [manualAvailable, setManualAvailable] = useState<string[]>([]);
  const [manualLimits, setManualLimits] = useState<Record<string, number>>({});
  const [manualInitial, setManualInitial] = useState<Record<string, string>>({});
  const [manualDraft, setManualDraft] = useState<Record<string, ManualMusicField>>({});
  const manualInitialized = useRef(false);
  const [contextReady, setContextReady] = useState(!session || window.parent === window);
  const initialSearchStarted = useRef(false);
  const alive = useRef(true), applyingRef = useRef(false), revision = useRef(0), applyController = useRef(new AbortController());
  const [service, setService] = useState<MetadataServiceId>(isMetadataService(initialService) ? initialService : "spotify");
  const [title, setTitle] = useState(initialTitle.slice(0, 200)), [artist, setArtist] = useState(initialArtist.slice(0, 200));
  const [discogsBarcode, setDiscogsBarcode] = useState(params.get("ean") ?? params.get("upc") ?? "");
  const [lastfmLanguage,setLastfmLanguage] = useState<"pt"|"en">("pt");
  const [descriptionMaxLength, setDescriptionMaxLength] = useState(DESCRIPTION_LIMIT);
  const [descriptionAvailable, setDescriptionAvailable] = useState(false), [originalDescription, setOriginalDescription] = useState("");
  const [descriptionConfirmed, setDescriptionConfirmed] = useState(false);
  const [connections, setConnections] = useState<MetadataServicesReply>(), [required, setRequired] = useState(false);
  const [results, setResults] = useState<readonly AlbumCandidate[]>([]), [searching, setSearching] = useState(false);
  const [searchAppending, setSearchAppending] = useState(false);
  const [status, setStatus] = useState(""), [feedback, setFeedback] = useState(""), [applying, setApplying] = useState(false), [applied, setApplied] = useState(false);
  const [preparingMerge, setPreparingMerge] = useState(false), [mergeCards, setMergeCards] = useState<readonly MergeCard[]>();
  const mergePreparingRef = useRef(false);
  const [adding, setAdding] = useState(false);
  const busy = applying || preparingMerge || adding;
  const [, update] = useState(0);
  const searchSession = useMemo(() => new MetadataSearchSession(service, {
    services: () => request({type: "metadata:services"}),
    search: (selected, query, nextPage) => request({type: "metadata:search", service: selected, ...query, ...(nextPage ? {nextPage} : {})}),
  }), []);
  const model = useMemo(() => new AlbumComposition({title: initialTitle, artists: initialArtist ? [initialArtist] : []}, {
    loadDescription: async (album, signal) => {
      const result = await request<AlbumDescription>({type: "metadata:description", album: {...album, title: album.title ?? "", artists: album.artists ?? []}, sourceUrl});
      if (signal.aborted) throw new Error("Geração cancelada.");return result;
    },
    loadArtwork: (album, signal) => loadAlbumArtworkResource<AlbumCandidate>({...album, title: album.title ?? "", artists: album.artists ?? []},
      value => request<AlbumArtworkFile>({type: "metadata:artwork", album: value, sourceUrl}), {signal}),
  }), []);
  const snapshot = model.snapshot(), selected = snapshot.cards.find(card => card.album.service === snapshot.selectedService);
  const largestArtwork = Math.max(0, ...snapshot.cards.map(card => card.artwork ? card.artwork.metadata.width * card.artwork.metadata.height : 0));
  const largestArtworkCount = snapshot.cards.filter(card => card.artwork && card.artwork.metadata.width * card.artwork.metadata.height === largestArtwork).length;
  const comparingArtwork = snapshot.cards.some(card => card.loadingArtwork);
  const descriptionRanks = rankDescriptionCompleteness(snapshot.cards);
  const descriptionStatus = new Map(snapshot.cards.map((card, index) => [card.album.service, descriptionRanks[index]!]));
  const missingCardData = new Map(snapshot.cards.map(card => {
    const missing = [!card.album.title?.trim() ? "título" : undefined,
      !card.album.artists?.some(artist => artist.name.trim()) && card.album.service !== "upcitemdb" ? "artistas" : undefined,
      !card.artwork && !card.loadingArtwork && card.album.service !== "discogs" && (card.album.service !== "upcitemdb" || Boolean(card.album.artworkUrl)) ? "capa" : undefined].filter(Boolean);
    const warnings = [missing.length ? `Dados indisponíveis: ${missing.join(", ")}.${card.artworkError ? ` ${card.artworkError.message}` : ""}` : "", descriptionStatus.get(card.album.service)?.warning].filter(Boolean);
    return [card.album.service, {text: warnings.join(" "), tone: missing.length || descriptionStatus.get(card.album.service)?.tone === "error" ? "error" : warnings.length ? "partial" : "ok"}];
  }));
  const manualPatch = Object.fromEntries(Object.entries(manualDraft).filter(([, field]) => field.included).map(([key, field]) => [key, field.value]));
  const patch = {...model.changes(), ...manualPatch}, hasChanges = Object.keys(patch).length > 0;
  function extraSource(card: typeof selected): Record<string, string> {
    const values: Record<string, string> = {...card?.description?.manualFields};
    const releaseParts = card?.album.releaseDate?.split("-") ?? [];
    for (const [index, key] of ["publish_year", "publish_month", "publish_day"].entries()) {
      if (releaseParts[index] && /^\d+$/.test(releaseParts[index]!)) values[key] ??= releaseParts[index]!;
    }
    for (const code of [card?.album.ean, card?.album.upc]) {
      if (code && /^\d{13}$/.test(code)) values["ean_isbn13"] ??= code;
      if (code && /^\d{12}$/.test(code)) values["upc_isbn10"] ??= code;
    }
    return values;
  }
  const manualSource = extraSource(selected);
  const catalogMatches = matchingCatalogSources(snapshot.cards.map(card => ({
    source: {service: card.album.service as MetadataServiceId, albumId: card.album.id},
    values: {title: card.album.title, artists: card.album.artists?.map(artist => artist.name),
      description: descriptionAvailable ? card.description?.text : undefined,
      ...Object.fromEntries(manualAvailable.map(key => [key, extraSource(card)[key]]))},
  })),
    {title: initialTitle, artists: initialArtist, description: originalDescription, ...manualInitial},
    {title: snapshot.fields.title.value, artists: snapshot.fields.artists.value, description: snapshot.fields.description.value,
      ...Object.fromEntries(manualAvailable.map(key => [key, manualDraft[key]?.value ?? manualInitial[key]]))});
  const includedData = [...Object.keys(snapshot.fields).filter(key => snapshot.fields[key as CompositionField].included),
    ...Object.keys(manualPatch), ...Object.keys(catalogMatches)];
  function availableCardData(card: NonNullable<typeof selected>): Record<string, boolean> {
    const extras = extraSource(card);
    return {title: Boolean(card.album.title?.trim()), artists: Boolean(card.album.artists?.some(artist => artist.name.trim())),
      artwork: Boolean(card.artwork), description: descriptionAvailable && Boolean(card.description?.text.trim()),
      ...Object.fromEntries(manualAvailable.map(key => [key, Boolean(extras[key]?.trim())]))};
  }
  const pendingFields = selected ? Object.entries(availableCardData(selected)).filter(([key, available]) => {
    if (!available) return false;
    const target = {service: selected.album.service as MetadataServiceId, albumId: selected.album.id};
    if (["title", "artists", "artwork", "description"].includes(key)) {
      const field = snapshot.fields[key as CompositionField];
      return copyButtonState(target, compositionCopySources(field.source).sources, field.included, catalogMatches[key]) === "available";
    }
    const field = manualDraft[key];
    return copyButtonState(target, field?.source ? [field.source] : [], Boolean(field?.included), catalogMatches[key]) === "available";
  }).map(([key]) => key) : [];
  function copyPending(): void {
    if (busy || applyingRef.current || !selected) return;
    for (const key of pendingFields) {
      if (["title", "artists", "artwork", "description"].includes(key)) model.copyField(key as CompositionField);
      else editManual(key, {value: manualSource[key]!, included: true, note: sourceNotes[key],
        source: {service: selected.album.service as MetadataServiceId, albumId: selected.album.id}});
    }
    setFeedback("Campos pendentes copiados para o formulário. Nenhuma alteração foi salva.");
  }
  function editManual(key: string, field: ManualMusicField) {
    setManualDraft(current => ({...current, [key]: field}));
    setApplied(false);
  }
  const sourceNotes = selected?.description?.manualFieldNotes ?? {};
  const extraProps = {sourceIdentity: selected ? {service: selected.album.service as MetadataServiceId, albumId: selected.album.id} : undefined, catalogMatches, limits: manualLimits, sourceNotes, available: manualAvailable, source: manualSource, draft: manualDraft, initial: manualInitial, busy, onChange: editManual,
    onUseInSearch: metadataUsesProductCode(service) ? (key: string, value: string) => useInSearch(key, value) : undefined};
  const legacyAllowed = patch.title !== undefined && patch.artists !== undefined && patch.artwork === undefined && patch.description === undefined;
  const descriptionReady = !snapshot.fields.description.included || descriptionAvailable && descriptionConfirmed && Boolean(snapshot.fields.description.value.trim()) && snapshot.fields.description.value.length <= descriptionMaxLength;
  const canApply = !preparingMerge && descriptionReady && hasChanges && (selective || legacyAllowed) && window.parent !== window && Boolean(session);
  const connection = connections?.services.find(item => item.id === service);
  const connectionNeeded = service==="lastfm" ? Boolean(connection&&!connection.connected) : required || Boolean(connection?.requiresAuthentication && !connection.connected);
  const cached = searchSession.snapshot();
  const query = {...metadataProductCode(service, discogsBarcode), title: title.trim(), artist: artist.trim(), sourceUrl, language:lastfmLanguage};
  const more = Boolean(cached.nextPage && cached.query && metadataQueryKey(cached.query) === metadataQueryKey(query));
  async function refreshConnections(): Promise<void> {
    try {const value = await searchSession.refreshServices(); if (alive.current) {setConnections(value); setRequired(false);}}
    catch {if (alive.current) setStatus("Não foi possível verificar a conexão. Tente novamente.");}
  }
  async function search(append = false): Promise<void> {
    delete query.ean; delete query.upc;
    Object.assign(query, metadataProductCode(searchSession.service, discogsBarcode));
    const generation = ++revision.current; setSearchAppending(append); setSearching(true); setStatus("Buscando álbuns…");
    try {
      const reply = await searchSession.search(query, append);
      if (!alive.current || generation !== revision.current || !reply) return;
      if (reply.connectionRequired) setRequired(true);
      if (reply.resolution.status === "failed") setStatus(reply.resolution.message);
      else {
        const albums = searchSession.snapshot().albums;
        setResults(albums);
        setStatus(reply.resolution.status === "choose" && reply.resolution.notice ? reply.resolution.notice : reply.resolution.status === "choose" && reply.resolution.incomplete && !reply.resolution.nextPage
          ? "A busca atingiu o limite de resultados. Refine título ou artista, ou adicione um dos álbuns encontrados."
          : albums.length ? "Adicione um álbum à lista para consultar seus dados." : "Nenhum álbum encontrado. Ajuste a busca.");
      }
    } catch (error) {if (alive.current && generation === revision.current) setStatus(error instanceof Error ? error.message : "Não foi possível buscar.");}
    finally {if (alive.current && generation === revision.current) setSearching(false);}
  }
  const previousDescription = useRef({value: snapshot.fields.description.value, included: snapshot.fields.description.included});
  useEffect(() => {
    const receiveContext = (event: MessageEvent): void => {
      if (!event.isTrusted || event.source !== window.parent || !isSupportedCatalogUrl(sourceUrl) || event.origin !== new URL(sourceUrl).origin || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message["type"] !== "collection-to-play:description-context" || message["session"] !== session) return;
      setContextReady(true);
      if (!manualInitialized.current && Array.isArray(message["manualFields"]) && message["manualValues"] && typeof message["manualValues"] === "object") {
        const raw = message["manualValues"] as Record<string, unknown>;
        const values: Record<string, string> = {};
        for (const field of MUSIC_MANUAL_FIELDS) {
          if (typeof raw[field.key] === "string") values[field.key] = raw[field.key] as string;
        }
        manualInitialized.current = true;
        setDiscogsBarcode(current => values["ean_isbn13"] || values["upc_isbn10"] || current);
        setManualInitial(values);
        setManualAvailable(message["manualFields"].filter((key): key is string => typeof key === "string" && MUSIC_MANUAL_FIELDS.some(field => field.key === key)));
        const rawLimits = message["manualLimits"] as Record<string, unknown> | undefined;
        setManualLimits(Object.fromEntries(MUSIC_MANUAL_FIELDS.map(field => {
          const limit = rawLimits?.[field.key];
          return [field.key, typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? Math.min(limit, field.maxLength) : field.maxLength];
        })));
      }
      const supported = message["available"] === true && typeof message["description"] === "string" && message["description"].length <= 200_000;
      setDescriptionAvailable(supported);setDescriptionMaxLength(descriptionLimit(message["maxLength"]));
      if (supported) {setOriginalDescription(message["description"] as string);model.initializeDescription(message["description"] as string);}
    };
    window.addEventListener("message", receiveContext);
    if (session && window.parent !== window && isSupportedCatalogUrl(sourceUrl)) window.parent.postMessage({type: "collection-to-play:description-context-request", session}, new URL(sourceUrl).origin);
    return () => window.removeEventListener("message", receiveContext);
  }, []);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = model.subscribe(() => {if (alive.current) {
      const current = model.snapshot().fields.description;
      if (previousDescription.current.value !== current.value || previousDescription.current.included !== current.included) setDescriptionConfirmed(false);
      previousDescription.current = {value: current.value, included: current.included};
      update(value => value + 1);setApplied(false);
    }});
    const refresh = (): void => {void refreshConnections();};
    const visible = (): void => {if (!document.hidden) refresh();};
    const storage = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {if (area === "local" && changes["spotify.session"]) refresh();};
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible); chrome.storage.onChanged.addListener(storage);
    void refreshConnections(); document.body.dataset["ready"] = "true";
    return () => {alive.current = false; revision.current++; searchSession.invalidate(); applyController.current.abort(); unsubscribe(); model.dispose();
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); chrome.storage.onChanged.removeListener(storage);};
  }, []);
  useEffect(() => {
    if (!contextReady || !connections || initialSearchStarted.current) return;
    initialSearchStarted.current = true;
    void search();
  }, [contextReady, connections]);
  function changeService(next: string): void {
    if (!isMetadataService(next) || applyingRef.current || mergePreparingRef.current) return;
    searchSession.selectService(next); revision.current++; setSearching(false); setService(next); setRequired(false);
    const cached = searchSession.snapshot();
    setResults(cached.query && metadataQueryKey(cached.query) === metadataQueryKey(query) ? cached.albums : []);
    if (model.snapshot().cards.some(card => card.album.service === next)) setStatus("Álbum deste streaming já adicionado.");
    else void search();
  }
  function editQuery(value: string, field: "title" | "artist"): void {
    searchSession.invalidate(); revision.current++; setSearching(false); setResults([]);
    if (field === "title") setTitle(value); else setArtist(value);
  }
  function editBarcode(value: string): void {
    searchSession.clearResults(); revision.current++; setSearching(false); setResults([]); setDiscogsBarcode(value);
  }
  function resetQuery(field: "title" | "artist"): void {
    editQuery((field === "title" ? initialTitle : initialArtist).slice(0, 200), field);
    document.getElementById(field === "title" ? "search-title" : "search-artist")?.focus({preventScroll: true});
  }
  function useInSearch(field: string, value: string): void {
    const code = field === "ean_isbn13" || field === "upc_isbn10";
    if (code) {
      editBarcode(value);
    } else editQuery(value.slice(0, 200), field === "title" ? "title" : "artist");
    setFeedback("Campo levado para a busca. Clique em Buscar álbuns para consultar.");
    requestAnimationFrame(() => document.getElementById(code ? "discogs-barcode" : field === "title" ? "search-title" : "search-artist")?.focus({preventScroll: true}));
  }
  async function add(album: AlbumCandidate): Promise<void> {
    if (adding || applyingRef.current) return;
    setAdding(true);
    try {
      const candidate = album.service === "discogs"
        ? (await request<{candidate: AlbumCandidate}>({type: "discogs:release", id: album.id})).candidate
        : album.service === "lastfm" && !album.lastfm ? lastfmCandidate(await request<LastfmAlbum>({type: "lastfm:album",
          title: album.title, artist: album.artists[0]!.name, language: album.id.endsWith("#en") ? "en" : "pt"})) : album;
      if (!alive.current) return;
      model.addAlbum(candidate);
      model.selectAlbum(candidate.service as MetadataServiceId);
      if (candidate.service !== "discogs" && (candidate.service !== "upcitemdb" || candidate.artworkUrl)) void model.loadArtwork(candidate.service as MetadataServiceId);
      requestAnimationFrame(() => {
        if (alive.current) document.getElementById(`source-${candidate.service}`)?.focus({preventScroll: true});
      });
      setFeedback("Álbum adicionado. Use + para copiar cada campo.");
    } catch (error) {if (alive.current) setFeedback(error instanceof Error ? error.message : "Não foi possível adicionar.");}
    finally {if (alive.current) setAdding(false);}
  }
  function copy(field?: CompositionField): void {
    if (applyingRef.current) return;
    const copied = field ? model.copyField(field) : model.copyAll();
    if (!field) {
      setManualDraft(current => {
        const next = {...current};
        for (const [key, value] of Object.entries(manualSource)) {
          if (manualAvailable.includes(key) && value) next[key] = {value, included: true, note: sourceNotes[key], source: selected ? {service: selected.album.service as MetadataServiceId, albumId: selected.album.id} : undefined};
        }
        return next;
      });
    }
    setFeedback(copied ? `${field ? `${labels[field]} ${field === "artists" ? "copiados" : field === "title" ? "copiado" : "copiada"}` : "Campos disponíveis copiados"} para o formulário. Nenhuma alteração foi salva.` : "Este campo ainda não está disponível.");
    if (copied) requestAnimationFrame(() => document.getElementById(field === "artwork" ? "include-artwork" : field === "artists" ? "composed-artists" : field === "description" ? "composed-description" : "composed-title")?.focus({preventScroll: true}));
  }
  function copyFieldButton(field: CompositionField, label: string, disabled: boolean) {
    const composed = snapshot.fields[field];
    return <CopyFieldButton label={label} target={selected ? {service: selected.album.service as MetadataServiceId, albumId: selected.album.id} : undefined}
      matchedSource={catalogMatches[field]}
      {...compositionCopySources(composed.source)} included={composed.included} disabled={disabled} onCopy={() => copy(field)}/>;
  }
  async function openDescriptionMerge(): Promise<void> {
    if (mergePreparingRef.current || applyingRef.current || !descriptionAvailable || !model.snapshot().cards.length) return;
    mergePreparingRef.current = true;setPreparingMerge(true);setFeedback("Preparando as descrições dos álbuns adicionados…");
    try {
      await model.prepareDescriptions();
      if (!alive.current) return;
      const cards = model.snapshot().cards.map(({album, description, descriptionError}) => ({album, description, descriptionError}));
      if (!cards.some(card => card.description)) {setFeedback("Não foi possível preparar nenhuma descrição. Tente novamente.");return;}
      setMergeCards(cards);setFeedback("");
    } catch (error) {if (alive.current) setFeedback(error instanceof Error ? error.message : "Não foi possível preparar as descrições.");}
    finally {mergePreparingRef.current = false;if (alive.current) setPreparingMerge(false);}
  }
  function closeDescriptionMerge(): void {
    setMergeCards(undefined);
    requestAnimationFrame(() => {if (alive.current) document.getElementById("combine-descriptions")?.focus({preventScroll: true});});
  }
  function useDescriptionMerge(text: string, sources: readonly MergeSelection[]): void {
    model.useMergedDescription(descriptionText(text, descriptionMaxLength), sources);setDescriptionConfirmed(false);setMergeCards(undefined);
    setFeedback("Descrição combinada preenchida. Confira o texto e confirme a substituição antes de aplicar.");
    requestAnimationFrame(() => {if (alive.current) document.getElementById("composed-description")?.focus({preventScroll: true});});
  }
  function resetDraftButton(field: CompositionField) {
    const fieldLabels = {title: "título original", artists: "artistas originais", artwork: "capa original", description: "descrição original"};
    const current = snapshot.fields[field];
    return <button class="btn btn-soft btn-square btn-sm" id={`reset-composed-${field}`} type="button" aria-label={`Restaurar ${fieldLabels[field]}`} title={`Restaurar ${fieldLabels[field]}`}
      disabled={busy || field === "description" && !descriptionAvailable || current.source.kind === "catalog" && !current.included}
      onClick={() => {
        model.resetField(field);
        setFeedback(`${labels[field]}: valor original restaurado. O campo será mantido no Libib.`);
        if (field !== "artwork") document.getElementById(`composed-${field}`)?.focus({preventScroll: true});
      }}><ResetSearchIcon/></button>;
  }
  async function apply(): Promise<void> {
    if (!canApply || applyingRef.current || applied) return;
    applyingRef.current = true; setApplying(true); setFeedback(full ? "Preenchendo campos…" : "Salvando os campos escolhidos…");
    try {
      const result = await applyToLibib(patch, applyController.current.signal, snapshot.fields.description.included ? {confirmed: descriptionConfirmed, expected: originalDescription} : undefined);
      if (!alive.current) return;
      if ("filled" in result) {setApplied(true); setFeedback("Campos preenchidos. Salve pelo botão do Libib.");}
      else if ("fields" in result) {
        for (const [field, state] of Object.entries(result.fields)) if (state === "saved") {
          if (MUSIC_MANUAL_FIELDS.some(definition => definition.key === field)) setManualDraft(current => ({...current, [field]: {...current[field]!, included: false}}));
          else model.setIncluded(field === "image" ? "artwork" : field === "creators" ? "artists" : field === "description" ? "description" : "title", false);
        }
        setApplied(Object.values(result.fields).every(state => state === "saved")); setFeedback(describeLibibPatchResult(result));
      }
      else {setApplied(result.title === "saved" && result.creators === "saved"); setFeedback(describeLibibApplyResult(result));}
    } catch (error) {if (alive.current) setFeedback(error instanceof Error ? error.message : "Confira o item no Libib.");}
    finally {applyingRef.current = false; if (alive.current) setApplying(false);}
  }
  return <>
    <h1>{manual ? "Preencher entrada manual de música" : "Compor dados do álbum"}</h1><p class="intro">Escolha até um álbum por serviço e copie os campos que deseja usar.</p>
    <div class="workspace"><section class="panel card card-border bg-base-100" aria-label="Buscar e escolher fontes">
      <form class="search-form" id="metadata-search" onSubmit={event => {event.preventDefault(); void search();}}>
        <fieldset class="wide streaming-picker" id="streaming-service"><legend>Serviços</legend><div class="streaming-choices music-services">
          {METADATA_SERVICE_IDS.map(id => {
            const added = snapshot.cards.some(card => card.album.service === id);
            return <button key={id} id={`streaming-service-${id}`} type="button" class="btn streaming-choice" aria-pressed={service === id}
              aria-label={`${names[id]}${added ? ", álbum adicionado" : ", nenhum álbum adicionado"}`} disabled={busy} onClick={() => changeService(id)}>
              <span class="streaming-choice-name"><StreamingIcon service={id}/><span>{names[id]}</span></span>
              <span class="streaming-choice-status">{added && <><ActionIcon name="check"/>Adicionado</>}</span>
            </button>;
          })}
        </div></fieldset>
        {metadataUsesProductCode(service) && <div class="wide"><label for="discogs-barcode">EAN ou UPC (opcional)</label><div class="search-input-group"><input id="discogs-barcode" class="input w-full" value={discogsBarcode} maxLength={32} disabled={busy}
          onInput={event => editBarcode(event.currentTarget.value)}/><BarcodeReaderButton target="search" fieldLabel="a busca" disabled={busy} onUse={value => {
            editBarcode(value);setStatus("Código lido preenchido. Clique em Buscar álbuns para consultar.");
            requestAnimationFrame(() => document.getElementById("discogs-barcode")?.focus({preventScroll: true}));
          }}/></div><p class="note">Busca primeiro pelo código. Sem resultado, usa título e artista.</p></div>}
        {service==="lastfm"&&<div class="wide"><label for="lastfm-language">Idioma da busca Last.fm</label><select id="lastfm-language" class="select w-full" value={lastfmLanguage} disabled={busy} onChange={event=>{searchSession.invalidate();revision.current++;setSearching(false);setResults([]);setLastfmLanguage(event.currentTarget.value as "pt"|"en");setStatus("Idioma alterado. Busque novamente no Last.fm.");}}><option value="pt">Português</option><option value="en">Inglês</option></select><p class="note">O idioma retornado pode diferir do solicitado. Sem reprodução pelo Last.fm.</p></div>}
        {service === "upcitemdb" && <p class="note wide">Consultas limitadas no plano gratuito. Confira o código antes de buscar.</p>}
        <div><label for="search-title">Álbum</label><div class="search-input-group"><input class="input w-full" id="search-title" required={(service !== "discogs" && service !== "upcitemdb") || !discogsBarcode.trim()} maxLength={200} value={title} disabled={busy} onInput={event => editQuery(event.currentTarget.value, "title")}/><button class="btn btn-soft btn-square reset-search" type="button" aria-label="Restaurar álbum original" title="Restaurar álbum original" disabled={busy || title === initialTitle.slice(0, 200)} onClick={() => resetQuery("title")}><ResetSearchIcon/></button></div></div>
        <div><label for="search-artist">Artista (opcional)</label><div class="search-input-group"><input class="input w-full" id="search-artist" maxLength={200} value={artist} disabled={busy} onInput={event => editQuery(event.currentTarget.value, "artist")}/><button class="btn btn-soft btn-square reset-search" type="button" aria-label="Restaurar artista original" title="Restaurar artista original" disabled={busy || artist === initialArtist.slice(0, 200)} onClick={() => resetQuery("artist")}><ResetSearchIcon/></button></div></div>
        <div class="wide search-actions"><button type="submit" class="btn btn-primary" disabled={searching || busy}>{searching ? <span class="loading loading-spinner loading-xs" aria-hidden="true"/> : <ActionIcon name="search"/>}Buscar álbuns</button><span class="note">{names[service]}</span></div>
      </form>
      {connectionNeeded && <div class="connection alert alert-warning alert-soft" id="connection-required"><p>{service==="discogs"?"Configure seu token pessoal Discogs para buscar.":service==="lastfm"?"Configure sua API key Last.fm para buscar.":`Conecte sua conta ${names[service]} para buscar.`} Os dados montados serão mantidos.</p><a href={connections?.configurationUrl ?? chrome.runtime.getURL("setup.html")} target="_blank" rel="noopener noreferrer">Abrir configurações</a><br/><button class="btn btn-sm" type="button" disabled={busy} onClick={() => void refreshConnections()}>Verificar conexão</button></div>}
      <p class="status" id="search-status" role="status" aria-live="polite">{status}</p>
      {results.length > 0 && (!searching || searchAppending) && <><span class="results-title" id="search-results-title">Resultados no {names[service]}</span><ul class="results" id="search-results">{results.map(album => <li class="result card card-border" key={`${album.service}:${album.id}`}>
        {album.service === "discogs" ? <DiscogsSearchThumbnail album={album}/> : <AlbumArtwork album={album}/>}
        <div class="result-info"><h3>{album.title}</h3>{album.artists.length > 0 && <p class="note">{album.artists.map(value => value.name).join(", ")}</p>}{album.releaseDate && <p class="note">{album.releaseDate}</p>}{album.discogs && <DiscogsEditionInfo album={album}/>}<UpcitemdbProductInfo album={album}/></div>
        <button class="btn btn-soft btn-sm" type="button" disabled={busy || snapshot.cards.some(card => card.album.service === album.service)} onClick={() => void add(album)}><ActionIcon name="album-add"/>Adicionar álbum</button>
      </li>)}</ul></>}
      {searching && <SearchResultsSkeleton/>}
      {more && <button class="more btn btn-soft btn-sm" type="button" disabled={searching || busy} onClick={() => void search(true)}>Carregar mais resultados</button>}
      <div class="layout-heading"><h2>Álbuns escolhidos</h2><span class="badge badge-soft">{snapshot.cards.length} / {METADATA_SERVICE_IDS.length}</span></div>
      {!snapshot.cards.length && <p class="empty">Adicione um álbum nos resultados da busca.</p>}
      <ul class="source-cards">{snapshot.cards.map(card => <li class={`source-card card card-border${card.album.service === snapshot.selectedService ? " selected" : ""}${missingCardData.get(card.album.service)?.tone === "error" ? " source-incomplete" : missingCardData.get(card.album.service)?.tone === "partial" ? " source-partial" : ""}`} key={card.album.service}>
        {missingCardData.get(card.album.service)?.text && <span class={`source-warning${missingCardData.get(card.album.service)?.tone === "partial" ? " source-info" : ""}`} role="img" aria-label={missingCardData.get(card.album.service)?.text} title={missingCardData.get(card.album.service)?.text} tabIndex={0}>{missingCardData.get(card.album.service)?.tone === "partial" ? "i" : "!"}</span>}
        <button type="button" id={`source-${card.album.service}`} class="source-select" aria-pressed={card.album.service === snapshot.selectedService} disabled={busy} onClick={() => {model.selectAlbum(card.album.service as MetadataServiceId); if (card.album.service !== "discogs" && (card.album.service !== "upcitemdb" || card.album.artworkUrl)) void model.loadArtwork(card.album.service as MetadataServiceId);}}>
          {card.artwork && <img class="thumb" src={card.artwork.previewUrl} alt=""/>}<span><span class="service"><StreamingIcon service={card.album.service}/>{names[card.album.service as MetadataServiceId]}</span><strong>{card.album.title ?? card.album.id}</strong>
            {card.artwork ? <><ArtworkDimensions width={card.artwork.metadata.width} height={card.artwork.metadata.height}/>
              {card.artwork.metadata.width * card.artwork.metadata.height === largestArtwork && <span class="artwork-best" title="Comparação pelo total de pixels das capas carregadas nos álbuns escolhidos."><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>{comparingArtwork ? "Maior resolução até agora" : largestArtworkCount > 1 ? "Maior resolução · empate" : "Maior resolução"}</span>}</>
              : <span class="card-artwork-size">{card.album.service === "discogs" ? "Dados da edição física" : card.album.service === "upcitemdb" && !card.album.artworkUrl ? "Dados do produto" : card.loadingArtwork ? "Carregando capa…" : "Capa indisponível"}</span>}
            <span class="card-description-status" title={descriptionStatus.get(card.album.service)?.summary}>{card.loadingDescription ? "Consultando descrição…" : !card.description && !card.descriptionError && descriptionUsesDetails(card.album.service) ? "Descrição não consultada" : `Descrição: ${descriptionStatus.get(card.album.service)?.score}/6 dados`}</span>
            {descriptionStatus.get(card.album.service)?.best && <span class="description-best" title={`Comparação dos seis grupos de dados disponíveis, independente do tamanho do texto. ${descriptionStatus.get(card.album.service)?.summary}`}><ActionIcon name="document"/>{descriptionStatus.get(card.album.service)?.provisional ? "Descrição mais completa · até agora" : descriptionStatus.get(card.album.service)?.tied ? "Descrição mais completa · empate" : "Descrição mais completa"}</span>}
            <UnusedDataBadge available={availableCardData(card)} included={includedData}/>
          </span>
        </button><button class="remove btn btn-ghost btn-sm" type="button" disabled={busy} aria-label={`Remover álbum do ${names[card.album.service as MetadataServiceId]}`} onClick={() => {model.removeAlbum(card.album.service as MetadataServiceId); document.getElementById(`streaming-service-${card.album.service}`)?.focus({preventScroll: true});}}><ActionIcon name="trash"/>Remover</button>
      </li>)}</ul>
      <section class="details" aria-label="Dados da fonte selecionada">
        {selected ? <><div class="layout-heading"><h2>Dados do {names[selected.album.service as MetadataServiceId]}</h2><div class="source-copy-actions"><button class="btn btn-soft btn-sm" type="button" disabled={busy || !pendingFields.length} onClick={copyPending}>+ Pendentes</button><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => copy()}><ActionIcon name="copy"/>+ todos</button></div></div>
          {selected.album.service === "discogs" && <><DiscogsBatch release={selected.album.discogs}/><a class="note" href={selected.album.url} target="_blank" rel="noopener noreferrer">Data provided by Discogs.</a></>}
          <div class="detail-field"><div><h3>Título</h3><p>{selected.album.title || "Não informado"}</p></div>{copyFieldButton("title", "Copiar título", Boolean(busy || !selected.album.title?.trim()))}</div>
          {selected.album.service === "upcitemdb" && <UpcitemdbProductInfo album={selected.album as AlbumCandidate} showCodes={false}/>}
          {(selected.album.service !== "upcitemdb" || Boolean(selected.album.artists?.length)) && <div class="detail-field"><div><h3>Artistas</h3><ul class="artist-list">{selected.album.artists?.map(value => <li key={value.id}>{value.name}</li>)}</ul></div>{copyFieldButton("artists", "Copiar artistas", Boolean(busy || !selected.album.artists?.length))}</div>}
          {(selected.artwork || selected.loadingArtwork) && <div class="detail-field"><div><h3>Capa</h3>{selected.artwork ? <><ArtworkPreview src={selected.artwork.previewUrl} alt={`Capa de ${selected.album.title ?? "álbum"}`} metadata={selected.artwork.metadata}/>
            {selected.artwork.metadata.warnings.includes("low-resolution") && <p class="warning alert alert-warning alert-soft">Capa abaixo de 300 × 300 pixels. Você pode usá-la com menor qualidade.</p>}
            {selected.artwork.metadata.warnings.includes("unavailable-variants") && <p class="note">Algumas variantes não puderam ser usadas. Esta é a maior capa válida obtida.</p>}</> : <p class="note">Carregando capa… + todos copia os campos já disponíveis.</p>}
            {selected.artworkError && <button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => void model.loadArtwork(selected.album.service as MetadataServiceId)}>Tentar obter a capa novamente</button>}
          </div>{copyFieldButton("artwork", "Copiar capa", Boolean(busy || !selected.artwork))}</div>}
          <div class="detail-field"><div><h3>Descrição</h3>
            {selected.description ? <><pre class="description-preview">{selected.description.text}</pre>{selected.description.notes.map(note => <p class="note">{note}</p>)}</>
              : <p class="note">{selected.loadingDescription ? "Consultando os dados do disco…" : selected.descriptionError ?? (descriptionUsesDetails(selected.album.service) ? "Gere uma descrição com os dados disponíveis desta fonte." : "Dados insuficientes para montar a descrição.")}</p>}
            {!selected.description && descriptionUsesDetails(selected.album.service) && <button id="generate-description" class="btn btn-soft btn-sm" type="button" disabled={busy || selected.loadingDescription || !descriptionAvailable} onClick={() => void model.loadDescription(selected.album.service as MetadataServiceId)}>Gerar descrição</button>}
          </div>{copyFieldButton("description", "Copiar descrição", Boolean(busy || !descriptionAvailable || !selected.description))}</div>
          <ManualMusicFields side="source" {...extraProps}/>
        </> : <p class="note">Selecione um card para consultar seus dados. O formulário só muda quando você copiar um campo.</p>}
      </section>
    </section><form class="panel draft card card-border bg-base-200" aria-label="Formulário principal" onSubmit={event => {event.preventDefault(); void apply();}}>
      <h2>Dados para o Libib</h2><p class="note">Marque os campos que deseja aplicar. Os demais serão mantidos no Libib.</p>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-title" type="checkbox" aria-label="Aplicar título" checked={snapshot.fields.title.included} disabled={busy} onChange={event => model.setIncluded("title", event.currentTarget.checked)}/><label for="composed-title">Título</label><UseInSearchButton label="título" value={snapshot.fields.title.value} disabled={busy} onUse={value => useInSearch("title", value)}/>{resetDraftButton("title")}</div><input class="input w-full" id="composed-title" aria-describedby="title-origin" maxLength={512} value={snapshot.fields.title.value} disabled={busy} onInput={event => model.editTitle(event.currentTarget.value)}/><span id="title-origin" class="origin">Origem: {origin(snapshot.fields.title.source)}</span></div>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-artists" type="checkbox" aria-label="Aplicar artistas" checked={snapshot.fields.artists.included} disabled={busy} onChange={event => model.setIncluded("artists", event.currentTarget.checked)}/><label for="composed-artists">Artistas</label><UseInSearchButton label="artistas" value={snapshot.fields.artists.value.join(", ")} disabled={busy} onUse={value => useInSearch("artists", value)}/>{resetDraftButton("artists")}</div><textarea class="textarea w-full" id="composed-artists" aria-describedby="artists-origin" rows={3} value={snapshot.fields.artists.value.join("\n")} disabled={busy} onInput={event => model.editArtists(event.currentTarget.value.split(/\r?\n/))}/><span id="artists-origin" class="origin">Origem: {origin(snapshot.fields.artists.source)}</span><p class="note">Um artista por linha.</p></div>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-artwork" type="checkbox" aria-label="Aplicar capa" checked={snapshot.fields.artwork.included} disabled={busy || !snapshot.fields.artwork.value} onChange={event => model.setIncluded("artwork", event.currentTarget.checked)}/><label for="include-artwork">Capa</label>{resetDraftButton("artwork")}</div>
        {snapshot.fields.artwork.value ? <><ArtworkPreview src={snapshot.fields.artwork.value.previewUrl} alt="Capa escolhida para o Libib" metadata={snapshot.fields.artwork.value.metadata}/></> : <p class="note">A capa atual do Libib será mantida.</p>}
        <span class="origin">Origem: {origin(snapshot.fields.artwork.source)}</span>
      </div>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-description" type="checkbox" aria-label="Aplicar descrição" checked={snapshot.fields.description.included} disabled={busy || !descriptionAvailable} onChange={event => model.setIncluded("description", event.currentTarget.checked)}/><label for="composed-description">Descrição</label><button class="btn btn-soft btn-sm" id="combine-descriptions" type="button" disabled={busy || !descriptionAvailable || !snapshot.cards.length} onClick={() => void openDescriptionMerge()}>{preparingMerge ? <span class="loading loading-spinner loading-xs" aria-hidden="true"/> : <ActionIcon name="document"/>}{preparingMerge ? "Preparando…" : "Combinar descrições"}</button>{resetDraftButton("description")}</div>
        <textarea class="textarea w-full" id="composed-description" rows={7} maxLength={descriptionMaxLength} disabled={busy || !descriptionAvailable} value={snapshot.fields.description.value} onInput={event => model.editDescription(event.currentTarget.value)}/>
        <p class="note" role="status">{snapshot.fields.description.value.length.toLocaleString("pt-BR")} / {descriptionMaxLength.toLocaleString("pt-BR")} caracteres{snapshot.fields.description.value.length > descriptionMaxLength ? ". Reduza o texto antes de aplicar." : ""}</p>
        <span id="description-origin" class="origin">Origem: {origin(snapshot.fields.description.source)}</span>
        {!descriptionAvailable && <p class="note">A descrição só pode ser alterada quando o campo nativo estiver disponível. Reabra esta ação pelo editor do Libib.</p>}
        {descriptionAvailable && <details class="original-description"><summary>Ver descrição atual do Libib</summary><pre class="description-preview">{originalDescription || "Sem descrição."}</pre></details>}
        {snapshot.fields.description.included && <label class="description-confirm"><input id="confirm-description" type="checkbox" class="checkbox checkbox-primary checkbox-sm" disabled={busy} checked={descriptionConfirmed} onChange={event => setDescriptionConfirmed(event.currentTarget.checked)}/>Confirmo substituir a descrição atual pelo texto acima.</label>}
      </div>
      <ManualMusicFields side="draft" {...extraProps}/>
      <p class="note">{manual ? "Confira os campos preenchidos e clique em Enviar no Libib." : full ? "Preencher apenas prepara os campos. Você salva pelo botão Salvar do Libib." : "Aplicar salva imediatamente apenas os campos marcados no Libib."}</p>
      {!selective && hasChanges && !legacyAllowed && <p class="warning alert alert-warning alert-soft">Reabra a busca pelo Libib para aplicar os campos separadamente, incluindo a capa.</p>}
      <button class="btn btn-primary" id="apply-composition" type="submit" disabled={!canApply || busy || applied}>{applying ? <span class="loading loading-spinner loading-xs" aria-hidden="true"/> : <ActionIcon name="check"/>}{applying ? "Aguarde…" : full ? "Preencher campos" : "Aplicar dados"}</button>
      <p class={`apply-feedback${feedback ? " alert alert-info alert-soft" : ""}`} id="composition-feedback" role="status" aria-live="polite">{feedback}</p>
    </form></div>
    {mergeCards && <DescriptionMergeDialog cards={mergeCards} maxLength={descriptionMaxLength} onUse={useDescriptionMerge} onCancel={closeDescriptionMerge}/>}
  </>;
}

const root = document.getElementById("editor-root");
if (root) {
  if (!isSupportedCatalogUrl(sourceUrl)) root.textContent = "Abra esta ação pelo editor de um álbum no Libib.";
  else {root.replaceChildren(); render(params.get("media") === "movie" && session ? <VideoEditor sourceUrl={sourceUrl} session={session}/> : <MetadataEditor/>, root); window.addEventListener("pagehide", () => render(null, root), {once: true});}
}
