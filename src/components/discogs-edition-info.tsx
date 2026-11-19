import {useEffect, useRef, useState} from "preact/hooks";
import type {AlbumCandidate} from "../shared/contracts.js";
import {isDiscogsSearchThumbnailUrl, type DiscogsRelease} from "../streamings/discogs.js";
import {extensionRequest} from "./ui-components.js";

export function DiscogsSearchThumbnail({album}: {album: AlbumCandidate}) {
  const [failed, setFailed] = useState("");
  const url = album.searchThumbnailUrl;
  return album.service === "discogs" && url && isDiscogsSearchThumbnailUrl(url) && failed !== url
    ? <img class="thumb" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)}/>
    : <span class="thumb artwork-placeholder" aria-hidden="true">♪</span>;
}

export function DiscogsBatch({release}: {release?: DiscogsRelease | undefined}) {
  return release?.batchIds?.length ? <p class="note">{release.batchIds.length > 1 ? "Lotes" : "Lote"}: {release.batchIds.join(", ")}</p> : null;
}

export function DiscogsEditionInfo({album}: {album: AlbumCandidate}) {
  const [release, setRelease] = useState(album.discogs);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRelease(album.discogs);
    setError("");
    if (album.discogs?.detailsLoaded) return;
    let active = true;
    const load = () => {
      observer?.disconnect();
      void extensionRequest<{release: DiscogsRelease}>({type: "discogs:release", id: album.id})
        .then(result => {if (active) setRelease(result.release);})
        .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : "Não foi possível consultar o lote.");});
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load();
    });
    if (observer && container.current) observer.observe(container.current);
    else load();
    return () => {active = false; observer?.disconnect();};
  }, [album, attempt]);
  return <div ref={container}>
    <p class="note">{[release?.country, release?.formats.join(", "), release?.catalogNumbers.join(", ")].filter(Boolean).join(" · ")}</p>
    <DiscogsBatch release={release}/>
    {error && <button class="btn btn-ghost btn-sm" type="button" title={error} onClick={() => setAttempt(value => value + 1)}>Tentar consultar lote novamente</button>}
    <a class="note" href={album.url} target="_blank" rel="noopener noreferrer">Data provided by Discogs.</a>
  </div>;
}
