import {descriptionLimit, descriptionText, assertDescriptionReplacement, type DescriptionReplacement} from "../albums/album-description.js";
import {isSupportedCatalogUrl} from "../shared/contracts.js";
import {prepareAlbumMetadata} from "./libib-metadata.js";
import {ARTWORK_BYTE_LIMIT, imageFormat} from "../albums/album-artwork.js";
import {readLibibItemFields, prepareLibibItemFields, type LibibItemFieldKey, type LibibTextControl} from "./libib-item-fields.js";

export interface LibibFullEditor {
  readonly form: HTMLFormElement;
  readonly joinId: string;
  readonly media: "music" | "movie";
  readonly title: HTMLInputElement;
  readonly creators: HTMLInputElement;
  readonly description?: HTMLInputElement | HTMLTextAreaElement;
  readonly extraFields: ReadonlyMap<LibibItemFieldKey, LibibTextControl>;
}

export function readDescriptionControl(form: HTMLFormElement): HTMLInputElement | HTMLTextAreaElement | undefined {
  const controls = form.querySelectorAll?.<HTMLInputElement | HTMLTextAreaElement>('input[name="description"],textarea[name="description"]');
  const control = controls?.[0];
  if (!control || controls?.length !== 1 || control.disabled || control.readOnly || !control.isConnected || control.form !== form ||
    control.classList.contains("no-post") || control.getClientRects && !control.getClientRects().length || control.tagName !== "TEXTAREA" && !(control.tagName === "INPUT" && control.type === "text")) return undefined;
  return control;
}

export function readLibibFullEditor(form: HTMLFormElement, pageUrl: string, allowMovie = false): LibibFullEditor | undefined {
  if (!isSupportedCatalogUrl(pageUrl) || form.id !== "edit-item-form" || !form.isConnected || !form.getClientRects().length ||
    form.ownerDocument.defaultView?.getComputedStyle(form).visibility === "hidden" || form.method.toLowerCase() !== "post" ||
    form.parentElement?.id !== "edit-item-details") return undefined;
  try {
    const action = new URL(form.getAttribute("action") ?? "", pageUrl);
    if (action.origin !== "https://www.libib.com" || action.pathname !== "/library/edit-item/submit") return undefined;
  } catch {return undefined;}
  const joinId = form.querySelector<HTMLInputElement>('input[name="join_id"]')?.value;
  const title = form.querySelector<HTMLInputElement>('input[name="title"]');
  const creators = form.querySelector<HTMLInputElement>('input[name="creators"]');
  if (!joinId || !/^[1-9]\d{0,19}$/.test(joinId) || !title || !creators ||
    title.type !== "text" || creators.type !== "text" || title.disabled || creators.disabled || title.readOnly || creators.readOnly) return undefined;
  const cards = [...form.ownerDocument.querySelectorAll<HTMLElement>(".item[data-join-id]")].filter(card => card.dataset["joinId"] === joinId);
  const music = cards.length ? cards.some(card => card.classList.contains("music")) :
    [...form.closest("#item-details-info")?.querySelectorAll(".details-view .media-tag") ?? []]
      .some(tag => /^(music|música|musica)$/i.test(tag.textContent?.trim() ?? ""));
  const movie = allowMovie && (cards.some(card => card.classList.contains("movie")) ||
    [...form.ownerDocument.querySelectorAll<HTMLElement>('.jump-edit[data-item-type="movie"][data-join-id]')]
      .some(editor => editor.dataset["joinId"] === joinId));
  if (!music && !movie || music && movie) return undefined;
  const description = readDescriptionControl(form);
  const media = movie ? "movie" : "music";
  return {form, joinId, media, title, creators, extraFields: readLibibItemFields(form, media), ...(description ? {description} : {})};
}

/** Changes only the two text inputs; saving stays under the native form's control. */
export function fillLibibFullEditor(context: LibibFullEditor, pageUrl: string, value: unknown): void {
  const prepared = prepareAlbumMetadata(value);
  const current = readLibibFullEditor(context.form, pageUrl);
  if (!current || current.joinId !== context.joinId || current.title !== context.title || current.creators !== context.creators) {
    throw new Error("A edição mudou. Reabra a busca no item que deseja alterar.");
  }
  current.title.value = prepared.metadata.title;
  current.creators.value = prepared.creatorsText;
}

/** Validates every chosen value before changing controls; native Save remains the only write action. */
export async function fillLibibFullEditorPatch(context: LibibFullEditor, pageUrl: string, value: unknown, options: {
  readonly isCurrent?: () => boolean;
  readonly descriptionReplacement?: DescriptionReplacement;
  readonly signal?: AbortSignal;
  readonly decode?: (file: File) => Promise<{readonly width: number; readonly height: number; close(): void}>;
} = {}): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Escolha os campos que deseja preencher.");
  const patch = value as Record<string, unknown>, keys = Object.keys(patch);
  const creatorKey = context.media === "movie" ? "directors" : "artists";
  if (!keys.length || keys.some(key => !["title", creatorKey, "artwork", "description", ...context.extraFields.keys()].includes(key) || patch[key] === undefined)) {
    throw new Error("Escolha somente os campos disponíveis para este item.");
  }
  const assertCurrent = (): LibibFullEditor => {
    const current = readLibibFullEditor(context.form, pageUrl, context.media === "movie");
    if (options.signal?.aborted || options.isCurrent?.() === false || !current || current.joinId !== context.joinId ||
      current.media !== context.media || current.title !== context.title || current.creators !== context.creators ||
      keys.some(key => context.extraFields.has(key as LibibItemFieldKey) && current.extraFields.get(key as LibibItemFieldKey) !== context.extraFields.get(key as LibibItemFieldKey))) throw new Error("A edição mudou. Reabra a busca no item que deseja alterar.");
    return current;
  };
  const extraPatch = Object.fromEntries(keys.filter(key => context.extraFields.has(key as LibibItemFieldKey)).map(key => [key, patch[key]]));
  prepareLibibItemFields(assertCurrent().extraFields, extraPatch);
  let description: string | undefined;
  if (keys.includes("description")) {
    const control = assertCurrent().description;
    if (!control) throw new Error("O campo de descrição não está disponível neste editor.");
    assertDescriptionReplacement(control.value, options.descriptionReplacement);
    description = descriptionText(patch["description"], descriptionLimit(control.maxLength));
  }
  let title: string | undefined, creators: string | undefined, image: HTMLInputElement | undefined, files: FileList | undefined;
  if (keys.includes("title")) {
    if (typeof patch["title"] !== "string" || !patch["title"].trim() || patch["title"].length > 512) throw new Error("Informe um título válido com até 512 caracteres.");
    title = patch["title"].trim();
  }
  if (keys.includes(creatorKey)) {
    // Reuse the captured creator serialization without requiring an unchosen title.
    creators = prepareAlbumMetadata({title: "Dados do item", artists: patch[creatorKey]}).creatorsText;
  }
  if (keys.includes("artwork")) {
    const candidates = [...context.form.querySelectorAll<HTMLInputElement>('input[name="image"]')];
    image = candidates.length === 1 ? candidates[0] : undefined;
    if (!image || image.type !== "file" || image.disabled || !image.isConnected || image.form !== context.form || image.classList.contains("no-post")) {
      throw new Error("O campo de capa do Libib não foi reconhecido. Aplique a imagem pelo formulário nativo.");
    }
    const file = patch["artwork"];
    if (!(file instanceof File) || file.size <= 0 || file.size > ARTWORK_BYTE_LIMIT) throw new Error("Escolha uma imagem válida com até 20 MB.");
    imageFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    let bitmap;
    try {bitmap = await (options.decode ?? (image => createImageBitmap(image)))(file);}
    catch {throw new Error("Não foi possível validar o arquivo da capa.");}
    const {width, height} = bitmap; bitmap.close();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("A capa não tem dimensões válidas.");
    assertCurrent();
    if (context.form.querySelectorAll('input[name="image"]').length !== 1 || context.form.querySelector('input[name="image"]') !== image || image.type !== "file" || image.disabled || !image.isConnected || image.form !== context.form || image.classList.contains("no-post")) {
      throw new Error("O campo de capa mudou. Reabra a busca neste item.");
    }
    const Transfer = context.form.ownerDocument.defaultView?.DataTransfer;
    if (!Transfer) throw new Error("O navegador não permitiu preparar o arquivo. Use o campo de capa do Libib.");
    const transfer = new Transfer(); transfer.items.add(file); files = transfer.files;
    if (files.length !== 1) throw new Error("Não foi possível preparar o arquivo da capa.");
  }
  const current = assertCurrent();
  const extraValues = prepareLibibItemFields(current.extraFields, extraPatch);
  if (description !== undefined) {
    assertDescriptionReplacement(current.description?.value, options.descriptionReplacement);
    descriptionText(description, descriptionLimit(current.description?.maxLength));
  }
  const previous = {description: current.description?.value, title: current.title.value, creators: current.creators.value, files: image?.files};
  const previousExtras = [...extraValues].map(([control]) => ({control, value: control.value}));
  try {
    if (image && files) image.files = files;
    if (description !== undefined && current.description) current.description.value = description;
    if (title !== undefined) current.title.value = title;
    if (creators !== undefined) current.creators.value = creators;
    for (const [control, text] of extraValues) control.value = text;
  } catch {
    if (description !== undefined && current.description && previous.description !== undefined) current.description.value = previous.description;
    if (title !== undefined) current.title.value = previous.title;
    if (creators !== undefined) current.creators.value = previous.creators;
    for (const {control, value} of previousExtras) control.value = value;
    if (image && previous.files) {try {image.files = previous.files;} catch { /* Preserve the original failure. */ }}
    throw new Error("Não foi possível preencher os campos. Confira o formulário do Libib.");
  }
}
