import { isSupportedCatalogUrl } from "./contracts.js";
import { assessLibibCompatibility, type LibibObservation } from "./libib-diagnostics.js";

export function collectLibibObservation(root: Document): LibibObservation | undefined {
  if (!isSupportedCatalogUrl(root.location.href)) return undefined;
  const wrapper = root.querySelector("#library-items-wrapper");
  const cards = [...root.querySelectorAll("#library-items-wrapper .item.music")];
  const details = [...root.querySelectorAll("#item-details-info .item-dv.details-view")].find(element =>
    element.getClientRects().length > 0 && root.defaultView?.getComputedStyle(element).visibility !== "hidden");
  const media = details ? [...details.querySelectorAll(".media-tag")].map(tag => tag.textContent?.trim() ?? "") : [];
  const music = media.some(value => /^(music|música|musica)$/i.test(value));
  const otherMedia = media.some(value => /^(books?|livros?|movies?|filmes?|video games?|board games?)$/i.test(value));
  return {
    page: root.readyState === "loading" || root.querySelector("#library-items")?.getAttribute("aria-busy") === "true" ? "loading" : "ready",
    collection: {containerFound: Boolean(wrapper), musicItems: cards.length,
      itemsWithTitleElement: cards.filter(card => card.querySelector(".item-title")).length},
    ...(details && (music || otherMedia) ? {details: {music, titleElementFound: Boolean(details.querySelector(".item-title"))}} : {}),
    // Editing selectors and save semantics are not established yet.
  };
}

export function createLibibObservationPublisher(environment: {
  collect(): LibibObservation | undefined;
  send(observation: LibibObservation): Promise<void>;
  readonly settleMs?: number;
}): {schedule(): void; stop(): void} {
  let published: string | undefined;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; pending = undefined; published = undefined; revision++;
  };
  return {stop, schedule(): void {
    const observation = environment.collect();
    if (!observation) {stop(); return;}
    const signature = JSON.stringify(assessLibibCompatibility(observation));
    if (signature === published) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined; pending = undefined;
      return;
    }
    if (signature === pending) return;
    if (timer !== undefined) clearTimeout(timer);
    pending = signature;
    const generation = revision;
    timer = setTimeout(() => {
      timer = undefined;
      const current = environment.collect();
      if (!current || JSON.stringify(assessLibibCompatibility(current)) !== signature) {
        if (generation === revision && pending === signature) pending = undefined;
        return;
      }
      published = undefined;
      void Promise.resolve().then(() => environment.send(current)).then(() => {
        if (generation === revision && pending === signature) published = signature;
      }).catch(() => {
        // A later observation retries after delivery or storage failure.
      }).finally(() => {
        if (generation === revision && pending === signature) pending = undefined;
      });
    }, environment.settleMs ?? 500);
  }};
}
