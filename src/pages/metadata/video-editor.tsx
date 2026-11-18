import {ARTWORK_BYTE_LIMIT, imageFormat} from "../../albums/album-artwork.js";
import {describeLibibPatchResult, isLibibPatchResult} from "../../libib/libib-metadata.js";
import {ActionIcon, ArtworkDimensions, ArtworkPreview, type ArtworkPreviewMetadata} from "../../components/ui-components.js";
import {useEffect, useState} from "preact/hooks";
import {descriptionLimit} from "../../albums/album-description.js";

interface Movie {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
}
interface Details extends Movie {
  overview?: string;
  runtime?: number;
  genres?: {name: string}[];
  credits?: {crew?: {name: string; job: string}[]};
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
  const full = params.get("editor") === "full";
  const initialTitle = params.get("title") ?? "";
  const initialDirectors = params.get("artist") ?? "";
  const [query, setQuery] = useState(initialTitle);
  const [title, setTitle] = useState(initialTitle);
  const [draftDirectors, setDraftDirectors] = useState(initialDirectors);
  const [draftPoster, setDraftPoster] = useState<string>();
  const [sourceSize, setSourceSize] = useState<{url: string; width: number; height: number}>();
  const [sourceDescription, setSourceDescription] = useState("");
  const [configured, setConfigured] = useState(false);
  const [results, setResults] = useState<Movie[]>([]);
  const [selected, setSelected] = useState<Details>();
  const [description, setDescription] = useState("");
  const [baseline, setBaseline] = useState<string>();
  const [limit, setLimit] = useState(descriptionLimit());
  const [fields, setFields] = useState<string[]>([]);
  const [confirmDescription, setConfirmDescription] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const refreshCredential = () => void chrome.storage.local.get("tmdb.readToken")
    .then(value => setConfigured(Boolean(value["tmdb.readToken"])))
    .catch(() => setFeedback("Não foi possível ler a credencial TMDb."));
  useEffect(() => {refreshCredential();}, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.isTrusted || event.origin !== parentOrigin || event.source !== window.parent || event.data?.session !== session) return;
      const data = event.data;
      if (data.type === "collection-to-play:description-context" && typeof data.description === "string") {
        setBaseline(data.description);
        setDescription(current => baseline === undefined && !current ? data.description : current);
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
  const poster = posterUrl(selected?.poster_path);
  const descriptionValid = description.trim().length > 0 && description.length <= limit;
  const apply = async () => {
    if (busy || !fields.length || fields.includes("description") && (!confirmDescription || baseline === undefined || !descriptionValid)) return;
    setBusy(true);
    setFeedback("");
    try {
      const patch: Record<string, unknown> = {};
      if (fields.includes("title")) patch.title = title;
      if (fields.includes("directors")) patch.directors = draftDirectors.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
      if (fields.includes("description")) patch.description = description;
      if (fields.includes("artwork") && draftPoster) {
        const response = await fetch(draftPoster, {credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000)});
        if (!response.ok) throw new Error("Não foi possível baixar a capa do TMDb.");
        const blob = await response.blob();
        patch.artwork = new File([blob], draftPoster.split("/").at(-1) ?? "capa.jpg", {type: blob.type});
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
    if ((!key || key === "artwork") && poster) {setDraftPoster(poster); added.push("artwork");}
    if ((!key || key === "description") && baseline !== undefined && sourceDescription) {
      setDescription(sourceDescription); setConfirmDescription(false); added.push("description");
    }
    setFields(current => [...new Set([...current, ...added])]);
  }
  function reset(key: string) {
    if (key === "title") setTitle(initialTitle);
    if (key === "directors") setDraftDirectors(initialDirectors);
    if (key === "artwork") setDraftPoster(undefined);
    if (key === "description") {setDescription(baseline ?? ""); setConfirmDescription(false);}
    setFields(current => current.filter(field => field !== key));
  }
  async function add(movie: Movie) {
    if (!Number.isSafeInteger(movie.id) || movie.id < 1) throw new Error("Resultado inválido.");
    const detail = await tmdb<Details>(`movie/${movie.id}`, await readToken(), {append_to_response: "credits"});
    if (detail.id !== movie.id || !detail.title?.trim()) throw new Error("O TMDb retornou outro vídeo.");
    setSelected(detail);
    setSourceDescription([
      detail.overview?.trim(),
      detail.release_date?.slice(0, 4) && `Ano: ${detail.release_date.slice(0, 4)}`,
      detail.runtime && `Duração: ${detail.runtime} min`,
      detail.genres?.length && `Gêneros: ${detail.genres.map(genre => genre.name).join(", ")}`,
      `Fonte: TMDb\nhttps://www.themoviedb.org/movie/${detail.id}`,
    ].filter(Boolean).join("\n\n"));
    requestAnimationFrame(() => document.getElementById("video-source")?.scrollIntoView({block: "nearest"}));
  }
  const items = [
    {key: "title", label: "Título", available: Boolean(selected?.title), value: selected?.title},
    {key: "directors", label: "Diretores", available: directors.length > 0, value: directors.join(", ")},
    {key: "artwork", label: "Capa", available: Boolean(poster), value: poster},
    {key: "description", label: "Descrição", available: baseline !== undefined && Boolean(sourceDescription), value: sourceDescription},
  ];
  const canApply = fields.length > 0 && (!fields.includes("title") || Boolean(title.trim())) &&
    (!fields.includes("directors") || Boolean(draftDirectors.trim())) &&
    (!fields.includes("description") || descriptionValid && confirmDescription);

  return <>
    <h1>Compor dados do vídeo</h1><p class="intro">Escolha um vídeo no TMDb e copie os campos que deseja usar.</p>
    <div class="workspace">
      <section class="panel card card-border bg-base-100" aria-label="Buscar e escolher fontes">
        <form class="search-form" onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            setResults([]);
            const credential = await readToken();
            const original = query.trim();
            let searched = original;
            let data = await tmdb<{results: Movie[]}>("search/movie", credential, {query: original, include_adult: "false"});
            const simplified = original.replace(/\s*(?:[-–—]\s*)?[([]?(?:blu[ -]?ray|dvd|vhs)[)\]]?\s*$/i, "").trim();
            if (!data.results.length && simplified && simplified !== original) {
              searched = simplified;
              data = await tmdb<{results: Movie[]}>("search/movie", credential, {query: simplified, include_adult: "false"});
            }
            setResults(data.results);
            if (!data.results.length) setFeedback(`Nenhum vídeo encontrado para “${searched}”. O diagnóstico está disponível em Configurações → Credencial TMDb.`);
            else requestAnimationFrame(() => document.getElementById("video-results")?.scrollIntoView({block: "nearest"}));
          });
        }}>
          <fieldset class="wide streaming-picker" id="streaming-service">
            <legend>Serviços</legend>
            <div class="streaming-choices">
              <button class="btn streaming-choice" id="streaming-service-tmdb" type="button"
                aria-pressed="true" aria-label={`TMDb, ${selected ? "vídeo adicionado" : "nenhum vídeo adicionado"}`} disabled={busy}>
                <span class="streaming-choice-name"><ActionIcon name="video"/><span>TMDb</span></span>
                <span class="streaming-choice-status">{selected && <><ActionIcon name="check"/>Adicionado</>}</span>
              </button>
            </div>
          </fieldset>
          <div class="wide"><label for="video-title">Vídeo</label><div class="search-input-group">
            <input id="video-title" class="input w-full" value={query} maxLength={512} disabled={busy} onInput={event => setQuery(event.currentTarget.value)}/>
            <button class="btn btn-soft btn-square reset-search" type="button" aria-label="Restaurar título original" title="Restaurar título original" disabled={busy || query === initialTitle} onClick={() => setQuery(initialTitle)}><ActionIcon name="refresh"/></button>
          </div></div>
          <div class="wide search-actions"><button class="btn btn-primary" disabled={busy || !configured || !query.trim()}><ActionIcon name="search"/>Buscar vídeos</button><span class="note">TMDb</span></div>
        </form>
        {!configured && <div class="connection alert alert-warning alert-soft">
          <p>Configure seu token de leitura do TMDb para buscar.</p>
          <a href={chrome.runtime.getURL("setup.html") + "#tmdb-settings"} target="_blank" rel="noopener noreferrer">Abrir configurações</a><br/>
          <button class="btn btn-sm" type="button" onClick={refreshCredential}>Verificar configuração</button>
        </div>}
        <p class="status" role="status">{busy ? "Aguarde…" : feedback}</p>
        {results.length > 0 && <><span class="results-title">Resultados no TMDb</span><ul class="results" id="video-results">{results.map(movie => {
          const image = posterUrl(movie.poster_path);
          return <li class="result card card-border" key={movie.id}>
            {image && <img class="thumb" src={image} alt="" referrerPolicy="no-referrer"/>}
            <div class="result-info"><h3>{movie.title}</h3><p class="note">{movie.release_date?.slice(0, 4)}</p></div>
            <button class="btn btn-soft btn-sm" type="button" disabled={busy || Boolean(selected)} onClick={() => void run(() => add(movie))}><ActionIcon name="album-add"/>Adicionar vídeo</button>
          </li>;
        })}</ul></>}
        <div class="layout-heading" id="video-source"><h2>Vídeo escolhido</h2><span class="badge badge-soft">{selected ? 1 : 0} / 1</span></div>
        {selected ? <>
          <ul class="source-cards"><li class="source-card card card-border selected">
            <button class="source-select" type="button" aria-pressed="true" disabled={busy}>{poster && <img class="thumb" src={poster} alt="" referrerPolicy="no-referrer" onLoad={event => {
              setSourceSize({url: poster, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight});
            }}/>}<span><span class="service"><ActionIcon name="video"/>TMDb</span><strong>{selected.title}</strong>{sourceSize && sourceSize.url === poster && <ArtworkDimensions width={sourceSize.width} height={sourceSize.height}/>}</span></button>
            <button class="remove btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setSelected(undefined)}><ActionIcon name="trash"/>Remover</button>
          </li></ul>
          <section class="details" aria-label="Dados do TMDb">
            <div class="layout-heading"><h2>Dados do TMDb</h2><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => copy()}><ActionIcon name="copy"/>+ todos</button></div>
            {items.map(item => <div class="detail-field" key={item.key}><div><h3>{item.label}</h3>
              {item.key === "artwork" && item.value ? <VideoArtwork key={item.value} src={item.value} alt="Capa do TMDb"/>
                : item.key === "description" && item.value ? <pre class="description-preview">{item.value}</pre>
                : <p>{item.value || "Não informado"}</p>}
            </div><button class="btn btn-soft btn-square btn-sm" type="button" aria-label={`Copiar ${item.label.toLowerCase()}`} disabled={busy || !item.available} onClick={() => copy(item.key)}>+</button></div>)}
          </section>
        </> : <p class="empty">Adicione um vídeo nos resultados da busca.</p>}
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
              <button class="btn btn-soft btn-square btn-sm" type="button" aria-label={`Restaurar ${label.toLowerCase()} original`} title={`Restaurar ${label.toLowerCase()} original`}
                disabled={disabled || !fields.includes(key)} onClick={() => reset(key)}><ActionIcon name="refresh"/></button>
            </div>
            {key === "title" && <input id="composed-title" class="input w-full" maxLength={512} value={title} disabled={busy} onInput={event => {setTitle(event.currentTarget.value); setFields(current => [...new Set([...current, "title"])]);}}/>}
            {key === "directors" && <><textarea id="composed-directors" class="textarea w-full" rows={3} value={draftDirectors} disabled={busy} onInput={event => {setDraftDirectors(event.currentTarget.value); setFields(current => [...new Set([...current, "directors"])]);}}/><p class="note">Um diretor por linha.</p></>}
            {key === "artwork" && (draftPoster ? <VideoArtwork key={draftPoster} src={draftPoster} alt="Capa escolhida para o Libib"/> : <p class="note">A capa atual será mantida.</p>)}
            {key === "description" && <>
              <textarea id="composed-description" class="textarea w-full" rows={7} value={description} disabled={disabled}
                onInput={event => {setDescription(event.currentTarget.value); setConfirmDescription(false); setFields(current => [...new Set([...current, "description"])]);}}/>
              <p class="note">{description.length} / {limit} caracteres</p>
              {baseline !== undefined && <details class="original-description"><summary>Ver descrição atual do Libib</summary><pre class="description-preview">{baseline || "Sem descrição."}</pre></details>}
              {fields.includes("description") && <label class="description-confirm"><input type="checkbox" class="checkbox checkbox-primary checkbox-sm" checked={confirmDescription} disabled={busy}
                onChange={event => setConfirmDescription(event.currentTarget.checked)}/>Confirmo substituir a descrição atual pelo texto acima.</label>}
            </>}
          </div>;
        })}
        <p class="note">{full ? "Confira os campos preenchidos e salve pelo botão do Libib." : "Aplicar salva imediatamente os campos marcados no Libib."}</p>
        <button class="btn btn-primary" disabled={busy || !canApply}><ActionIcon name="check"/>{full ? "Preencher campos" : "Aplicar dados"}</button>
      </form>
    </div>
  </>;
}
