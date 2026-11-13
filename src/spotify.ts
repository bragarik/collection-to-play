import type { AlbumCandidate, AlbumQuery, AlbumSearchPage, StreamingAdapter } from "./contracts.js";
import { StreamingError } from "./resolution.js";
import { albumSearchTitle } from "./album-search-title.js";
import { normalizeProductCode, productCodesMatch, productCodeVariants } from "./identifiers.js";

export interface SpotifySearchEvent {
  readonly at: string;
  readonly kind: "request" | "response" | "page" | "album-details" | "identifier-check";
  readonly endpoint: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly strategy?: "identifier" | "filtered" | "free-text";
  readonly expression?: string;
  readonly offset?: number;
  readonly total?: number;
  readonly returnedOffset?: number;
  readonly returnedLimit?: number;
  readonly returnedQuery?: string;
  readonly hasNext?: boolean;
  readonly candidates?: readonly AlbumCandidate[];
  readonly externalIds?: {readonly upc: string | null; readonly ean: string | null};
  readonly requestedIdentifier?: string;
  readonly matchesIdentifier?: boolean;
}

export interface SpotifySession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface SpotifyEnvironment {
  readonly clientId: string;
  readonly redirectUrl: string;
  readonly launchAuth: (url: string) => Promise<string | undefined>;
  readonly store: {
    load(): Promise<unknown>;
    save(session: SpotifySession): Promise<void>;
    clear(): Promise<void>;
  };
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(hash)), state: base64url(crypto.getRandomValues(new Uint8Array(32))) };
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}`;
}

function sessionFrom(value: unknown): SpotifySession | undefined {
  const data = object(value);
  if (!data || !text(data["accessToken"]) || !text(data["refreshToken"]) ||
    typeof data["expiresAt"] !== "number" || !Number.isFinite(data["expiresAt"])) return undefined;
  return { accessToken: data["accessToken"], refreshToken: data["refreshToken"], expiresAt: data["expiresAt"] };
}

function artworkFrom(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.flatMap((entry: unknown) => {
    const image = object(entry);
    if (!image || typeof image["url"] !== "string") return [];
    try {
      const url = new URL(image["url"]);
      if (url.protocol !== "https:" || url.hostname !== "i.scdn.co" || url.username || url.password || url.port || !url.pathname.startsWith("/image/")) return [];
      const width = typeof image["width"] === "number" && image["width"] > 0 ? image["width"] : Infinity;
      return [{url: url.href, width}];
    } catch { return []; }
  });
  return images.filter(image => image.width >= 96).sort((a, b) => a.width - b.width)[0]?.url ?? images[0]?.url;
}

function parseAlbum(value: unknown): AlbumCandidate {
  const data = object(value);
  const external = object(data?.["external_urls"]);
  if (!data || !text(data["id"]) || !/^[a-zA-Z0-9]{22}$/.test(data["id"]) ||
    !text(data["name"]) || !text(external?.["spotify"]) || !Array.isArray(data["artists"])) {
    throw new StreamingError("invalid-response", "O Spotify retornou dados de álbum incompletos.");
  }
  const url = new URL(external["spotify"]);
  if (url.origin !== "https://open.spotify.com" || url.username || url.password ||
    !new RegExp(`^/(?:intl-[a-z]{2}/)?album/${data["id"]}/?$`).test(url.pathname)) {
    throw new StreamingError("invalid-response", "O Spotify retornou um link de álbum inválido.");
  }
  const artists = data["artists"].map((value: unknown) => {
    const artist = object(value);
    if (!artist || !text(artist["id"]) || !text(artist["name"])) {
      throw new StreamingError("invalid-response", "O Spotify retornou dados de artista incompletos.");
    }
    return { id: artist["id"], name: artist["name"] };
  });
  if (artists.length === 0) throw new StreamingError("invalid-response", "O Spotify não informou o artista do álbum.");
  const identifiers = object(data["external_ids"]);
  const upc = typeof identifiers?.["upc"] === "string" ? normalizeProductCode(identifiers["upc"]) : undefined;
  const ean = typeof identifiers?.["ean"] === "string" ? normalizeProductCode(identifiers["ean"]) : undefined;
  const artworkUrl = artworkFrom(data["images"]);
  return {
    service: "spotify", id: data["id"], title: data["name"], artists, url: url.href,
    ...(text(data["release_date"]) ? { releaseDate: data["release_date"] } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    ...(upc ? { upc } : {}),
    ...(ean ? { ean } : {}),
  };
}

export class SpotifyClient implements StreamingAdapter {
  readonly id = "spotify" as const;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private connecting: Promise<void> | undefined;
  private refreshing: Promise<SpotifySession> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private retryAt = 0;

  constructor(private readonly environment: SpotifyEnvironment) {
    this.fetcher = environment.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = environment.now ?? Date.now;
  }

  private mutateStore(operation: () => Promise<void>): Promise<void> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => {});
    return next;
  }

  private async save(session: SpotifySession, revision: number): Promise<void> {
    await this.mutateStore(async () => {
      if (revision !== this.revision) throw new StreamingError("cancelled", "Conexão cancelada.");
      await this.environment.store.save(session);
    });
  }

  async status(): Promise<{ connected: boolean }> {
    await this.writes;
    return { connected: Boolean(sessionFrom(await this.environment.store.load())) };
  }

  async disconnect(): Promise<void> {
    this.revision++;
    this.connecting = undefined;
    this.refreshing = undefined;
    await this.mutateStore(() => this.environment.store.clear());
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const pending = this.authorize(this.revision);
    this.connecting = pending;
    try { await pending; }
    finally { if (this.connecting === pending) this.connecting = undefined; }
  }

  private async authorize(revision: number): Promise<void> {
    const { verifier, challenge, state } = await createPkce();
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: this.environment.clientId, response_type: "code", redirect_uri: this.environment.redirectUrl,
      code_challenge_method: "S256", code_challenge: challenge, state, show_dialog: "true",
    }).toString();
    let returned: string | undefined;
    try { returned = await this.environment.launchAuth(url.href); }
    catch { throw new StreamingError("cancelled", "A conexão não foi concluída. Tente novamente e autorize na janela do Spotify."); }
    if (!returned || revision !== this.revision) throw new StreamingError("cancelled", "Conexão cancelada.");
    let callback: URL;
    try { callback = new URL(returned); }
    catch { throw new StreamingError("authentication-required", "O retorno de autorização é inválido."); }
    const expected = new URL(this.environment.redirectUrl);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname ||
      callback.searchParams.get("state") !== state || callback.hash) {
      throw new StreamingError("authentication-required", "Não foi possível confirmar a origem da autorização. Conecte novamente.");
    }
    if (callback.searchParams.has("error")) throw new StreamingError("cancelled", "A autorização do Spotify foi recusada.");
    const code = callback.searchParams.get("code");
    if (!code) throw new StreamingError("authentication-required", "O Spotify não retornou o código de autorização.");
    const session = await this.requestToken({
      grant_type: "authorization_code", code, redirect_uri: this.environment.redirectUrl, code_verifier: verifier,
    });
    await this.save(session, revision);
  }

  private async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const remaining = Math.ceil((this.retryAt - this.now()) / 1000);
    if (remaining > 0) throw new StreamingError("rate-limited", `Aguarde ${remaining} segundos antes de tentar novamente.`, remaining);
    try {
      return await this.fetcher(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      if (signal?.aborted) throw new StreamingError("cancelled", "Busca cancelada.");
      throw new StreamingError("network", "Não foi possível consultar o Spotify. Confira sua conexão e tente novamente.");
    }
  }

  private async verifyResponse(response: Response): Promise<void> {
    if (response.ok) return;
    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const parsed = header && /^\d+$/.test(header) ? Number(header) : NaN;
      const seconds = Number.isFinite(parsed) ? parsed : 30;
      this.retryAt = this.now() + seconds * 1000;
      throw new StreamingError("rate-limited", `O Spotify limitou as consultas. Aguarde ${seconds} segundos.`, seconds);
    }
    if (response.status === 400 || response.status === 401) {
      throw new StreamingError("authentication-required", "A autorização expirou ou o cadastro do aplicativo é inválido. Confira o Client ID e o Redirect URI e conecte novamente.");
    }
    if (response.status === 403) {
      throw new StreamingError("unavailable", "O Spotify recusou acesso ao aplicativo. Confira o Premium do proprietário e a lista de usuários autorizados no Developer Dashboard.");
    }
    throw new StreamingError("unavailable", "O Spotify não concluiu a consulta. Tente novamente mais tarde.");
  }

  private async json(response: Response): Promise<unknown> {
    try { return await response.json(); }
    catch { throw new StreamingError("invalid-response", "O Spotify retornou uma resposta inválida."); }
  }

  private async requestToken(fields: Record<string, string>, previousRefresh?: string): Promise<SpotifySession> {
    const response = await this.request("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: this.environment.clientId }),
    });
    await this.verifyResponse(response);
    const data = object(await this.json(response));
    const refresh = data?.["refresh_token"] ?? previousRefresh;
    if (!data || !text(data["access_token"]) || !text(refresh) ||
      typeof data["token_type"] !== "string" || data["token_type"].toLowerCase() !== "bearer" ||
      typeof data["expires_in"] !== "number" || !Number.isFinite(data["expires_in"]) || data["expires_in"] <= 0) {
      throw new StreamingError("invalid-response", "O Spotify não retornou uma sessão válida.");
    }
    return { accessToken: data["access_token"], refreshToken: refresh, expiresAt: this.now() + data["expires_in"] * 1000 };
  }

  private async refresh(previousAccess: string): Promise<SpotifySession> {
    if (this.refreshing) return this.refreshing;
    const revision = this.revision;
    const pending = (async () => {
      await this.writes;
      const current = sessionFrom(await this.environment.store.load());
      if (!current) throw new StreamingError("authentication-required", "Conecte sua conta Spotify para buscar álbuns.");
      if (current.accessToken !== previousAccess && current.expiresAt > this.now() + 30000) return current;
      try {
        const session = await this.requestToken({ grant_type: "refresh_token", refresh_token: current.refreshToken }, current.refreshToken);
        await this.save(session, revision);
        return session;
      } catch (error) {
        if (error instanceof StreamingError && error.code === "authentication-required") {
          await this.mutateStore(async () => { if (revision === this.revision) await this.environment.store.clear(); });
        }
        throw error;
      }
    })();
    this.refreshing = pending;
    try { return await pending; }
    finally { if (this.refreshing === pending) this.refreshing = undefined; }
  }

  private async session(): Promise<SpotifySession> {
    await this.writes;
    const session = sessionFrom(await this.environment.store.load());
    if (!session) throw new StreamingError("authentication-required", "Conecte sua conta Spotify para buscar álbuns.");
    return session.expiresAt > this.now() + 30000 ? session : this.refresh(session.accessToken);
  }

  private async authorizedGet(url: string, signal?: AbortSignal, diagnostic?: (event: SpotifySearchEvent) => void): Promise<unknown> {
    const revision = this.revision;
    let session = await this.session();
    const checkCancelled = (): void => {
      if (revision !== this.revision || signal?.aborted) throw new StreamingError("cancelled", "Busca cancelada.");
    };
      checkCancelled();
      const fetchData = async (): Promise<Response> => {
        const started = this.now();
        diagnostic?.({ at: new Date(this.now()).toISOString(), kind: "request", endpoint: url });
        const response = await this.request(url, { headers: { Authorization: `Bearer ${session.accessToken}` } }, signal);
        diagnostic?.({ at: new Date(this.now()).toISOString(), kind: "response", endpoint: url, status: response.status, durationMs: Math.max(0, this.now() - started) });
        return response;
      };
      let response = await fetchData();
      if (response.status === 401) { session = await this.refresh(session.accessToken); response = await fetchData(); }
      if (response.status === 401) await this.disconnect();
      await this.verifyResponse(response);
      const data = await this.json(response);
      checkCancelled();
      return data;
  }

  async albumDetails(id: string, signal?: AbortSignal, diagnostic?: (event: SpotifySearchEvent) => void): Promise<{album: AlbumCandidate; externalIds: {upc: string | null; ean: string | null}}> {
    if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new StreamingError("invalid-query", "ID de álbum inválido.");
    const endpoint = `https://api.spotify.com/v1/albums/${id}`;
    const data = await this.authorizedGet(endpoint, signal, diagnostic);
    let album: AlbumCandidate;
    try { album = parseAlbum(data); }
    catch { throw new StreamingError("invalid-response", "O Spotify retornou detalhes de álbum inválidos."); }
    if (album.id !== id) throw new StreamingError("invalid-response", "O Spotify retornou detalhes de outro álbum.");
    const identifiers = object(object(data)?.["external_ids"]);
    const raw = (value: unknown): string | null => typeof value === "string" ? value.slice(0, 64) : null;
    const externalIds = {upc: raw(identifiers?.["upc"]), ean: raw(identifiers?.["ean"])};
    diagnostic?.({at: new Date(this.now()).toISOString(), kind: "album-details", endpoint, candidates: [album], externalIds});
    return {album, externalIds};
  }

  async search(query: AlbumQuery, signal?: AbortSignal, cursor?: string, diagnostic?: (event: SpotifySearchEvent) => void): Promise<readonly AlbumCandidate[] | AlbumSearchPage> {
    if (!query.title.trim()) throw new StreamingError("invalid-query", "Informe o título do álbum.");
    const revision = this.revision;
    await this.session();
    const checkCancelled = (): void => {
      if (revision !== this.revision || signal?.aborted) throw new StreamingError("cancelled", "Busca cancelada.");
    };
    checkCancelled();
    const get = async (url: string): Promise<unknown> => {
      checkCancelled(); const data = await this.authorizedGet(url, signal, diagnostic); checkCancelled(); return data;
    };
    const parse = (value: unknown): AlbumCandidate => {
      try { return parseAlbum(value); }
      catch (error) {
        if (error instanceof StreamingError) throw error;
        throw new StreamingError("invalid-response", "O Spotify retornou um link de álbum inválido.");
      }
    };
    const clean = (value: string): string => value.replace(/["\\]/g, " ").trim();
    const searches: { expression: string; identifier?: string }[] = [
      ...productCodeVariants(query.upc, query.ean).map((code) => ({ expression: `upc:${code}`, identifier: code })),
      { expression: `album:"${clean(albumSearchTitle(query))}"${query.artist.trim() ? ` artist:"${clean(query.artist)}"` : ""}` },
      { expression: [clean(albumSearchTitle(query)), clean(query.artist)].filter(Boolean).join(" ") },
    ];
    const binding = JSON.stringify([query.title, query.artist, query.upc ?? "", query.ean ?? ""]);
    let startStrategy = 0;
    let startOffset = 0;
    if (cursor !== undefined) {
      try {
        if (cursor.length > 4096) throw new Error();
        const parsed: unknown = JSON.parse(cursor);
        if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== binding ||
          !Number.isInteger(parsed[1]) || parsed[1] < 0 || parsed[1] >= searches.length ||
          !Number.isInteger(parsed[2]) || parsed[2] < 10 || parsed[2] > 1000 || parsed[2] % 10 !== 0) throw new Error();
        startStrategy = parsed[1]; startOffset = parsed[2];
      } catch { throw new StreamingError("invalid-query", "Continuação inválida. Faça uma nova busca."); }
    }
    const details = new Map<string, AlbumCandidate>();
    for (let index = startStrategy; index < searches.length; index++) {
      const strategy = searches[index]!;
      const results: AlbumCandidate[] = [];
      let complete = false;
      let offset = index === startStrategy ? startOffset : 0;
      for (let page = 0; page < 5 && offset <= 1000; page++, offset += 10) {
        const url = new URL("https://api.spotify.com/v1/search");
        url.search = new URLSearchParams({
          q: strategy.expression, type: "album", limit: "10", offset: String(offset),
        }).toString();
        const data = object(await get(url.href));
        const albums = object(data?.["albums"]);
        if (!albums || !Array.isArray(albums["items"]) || !(albums["next"] === null || typeof albums["next"] === "string")) {
          throw new StreamingError("invalid-response", "O Spotify não retornou uma lista válida de álbuns.");
        }
        const candidates = albums["items"].map(parse);
        const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
        let returnedQuery: string | undefined;
        try {
          if (typeof albums["href"] === "string") returnedQuery = new URL(albums["href"]).searchParams.get("q")?.slice(0, 500);
        } catch { /* An echoed search URL is optional diagnostic metadata. */ }
        diagnostic?.({ at: new Date(this.now()).toISOString(), kind: "page", endpoint: url.href,
          strategy: strategy.identifier ? "identifier" : index === searches.length - 1 ? "free-text" : "filtered",
          expression: strategy.expression, offset, hasNext: albums["next"] !== null,
          ...(numeric(albums["total"]) ? { total: albums["total"] } : {}),
          ...(numeric(albums["offset"]) ? { returnedOffset: albums["offset"] } : {}),
          ...(numeric(albums["limit"]) ? { returnedLimit: albums["limit"] } : {}),
          ...(returnedQuery !== undefined ? { returnedQuery } : {}),
          candidates: candidates.slice(0, 50),
        });
        results.push(...candidates);
        if (albums["next"] === null) { complete = true; break; }
      }
      const wrap = (candidates: readonly AlbumCandidate[]): readonly AlbumCandidate[] | AlbumSearchPage =>
        !complete || cursor !== undefined
          ? { candidates, complete: false, ...(!complete && offset <= 1000
            ? { nextPage: JSON.stringify([binding, index, offset]) } : {}) }
          : candidates;
      if (results.length === 0 && complete && cursor === undefined) continue;
      if (!strategy.identifier) return wrap(results);

      const verified: AlbumCandidate[] = [];
      for (const result of results) {
        checkCancelled();
        let candidate = result;
        if (!productCodesMatch(candidate.upc, strategy.identifier) && !productCodesMatch(candidate.ean, strategy.identifier)) {
          candidate = details.get(result.id) ?? (await this.albumDetails(result.id, signal, diagnostic)).album;
          if (candidate.id !== result.id) throw new StreamingError("invalid-response", "O Spotify retornou detalhes de outro álbum.");
          details.set(result.id, candidate);
        }
        checkCancelled();
        const matchesIdentifier = productCodesMatch(candidate.upc, strategy.identifier) || productCodesMatch(candidate.ean, strategy.identifier);
        diagnostic?.({at: new Date(this.now()).toISOString(), kind: "identifier-check", endpoint: `https://api.spotify.com/v1/albums/${candidate.id}`,
          requestedIdentifier: strategy.identifier, matchesIdentifier, candidates: [candidate]});
        if (matchesIdentifier) verified.push(candidate);
      }
      if (verified.length > 0 || !complete || cursor !== undefined) return wrap(verified);
    }
    return [];
  }
}
