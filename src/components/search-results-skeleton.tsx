import {ActionIcon} from "./ui-components.js";

export function SearchResultsSkeleton({video = false}: {video?: boolean}) {
  return <section class={`results-loading${video ? " results-loading-video" : ""}`} aria-label="Buscando resultados" aria-busy="true">
    <ul class="results" aria-hidden="true">{[0, 1, 2].map(index => <li class="result card card-border" key={index}>
      <span class="skeleton search-skeleton-cover">{video ? <ActionIcon name="video"/> :
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9a7 7 0 0 1 3-3m6 12a7 7 0 0 0 3-3"/></svg>}</span>
      <div class="result-info"><span class="skeleton search-skeleton-title"/><span class="skeleton search-skeleton-detail"/><span class="skeleton search-skeleton-meta"/></div>
      <span class="search-skeleton-action">+</span>
    </li>)}</ul>
  </section>;
}
