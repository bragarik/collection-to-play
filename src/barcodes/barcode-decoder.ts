import {normalizeProductCode} from "../albums/identifiers.js";

export interface BarcodeReading {
  readonly code: string;
  readonly format: "ean_13" | "upc_a";
}
export type BarcodeTarget = "search" | "ean" | "upc";
export const BARCODE_IMAGE_BYTE_LIMIT = 12 * 1024 * 1024;
export const BARCODE_IMAGE_PIXEL_LIMIT = 24_000_000;

export class BarcodeDecodeError extends Error {
  constructor(readonly code: "invalid-image" | "unavailable" | "cancelled") {
    super(code === "cancelled" ? "Leitura cancelada." : code === "invalid-image"
      ? "Use uma imagem JPEG, PNG, WebP ou BMP válida de até 12 MB e 24 megapixels."
      : "Não foi possível ler esta imagem. Tente outra foto.");
    this.name = "BarcodeDecodeError";
  }
}

export function parseBarcodeReading(value: unknown): BarcodeReading | undefined {
  if (!value || typeof value !== "object") return;
  const result = (value as {codeResult?: unknown}).codeResult;
  if (!result || typeof result !== "object") return;
  const {code, format} = result as {code?: unknown; format?: unknown};
  if (typeof code !== "string" || !/^[0-9]+$/.test(code) || normalizeProductCode(code) !== code) return;
  if (format === "ean_13" && code.length === 13 || format === "upc_a" && code.length === 12) return {code, format};
  return;
}

/** Convert only the equivalent UPC-A / zero-prefixed EAN-13 representation. */
export function barcodeValueForTarget(reading: BarcodeReading, target: BarcodeTarget): string | undefined {
  const valid = parseBarcodeReading({codeResult: reading});
  if (!valid) return;
  const code = valid.code;
  if (target === "search") return code;
  if (target === "ean") return code.length === 12 ? `0${code}` : code;
  if (target === "upc") return code.length === 12 ? code : code.startsWith("0") ? code.slice(1) : undefined;
  return;
}

type ReadImage = (source: string, size: number) => Promise<unknown>;
type DecoderEnvironment = {
  readonly readImage?: ReadImage;
  readonly urls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};
let library: Promise<typeof import("@ericblade/quagga2/dist/quagga.min.js")> | undefined;
async function readQuaggaImage(source: string, size: number): Promise<unknown> {
  // Reject broken files before Quagga's asynchronous image callbacks run.
  const image = new Image();
  image.src = source;
  try {await image.decode();} catch {throw new BarcodeDecodeError("invalid-image");}
  if (!image.naturalWidth || !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > BARCODE_IMAGE_PIXEL_LIMIT) throw new BarcodeDecodeError("invalid-image");
  let module: typeof import("@ericblade/quagga2/dist/quagga.min.js");
  try {module = await (library ??= import("@ericblade/quagga2/dist/quagga.min.js"));}
  catch {library = undefined; throw new BarcodeDecodeError("unavailable");}
  return module.default.decodeSingle({
    src: source, numOfWorkers: 0, locate: true,
    inputStream: {size}, locator: {halfSample: true, patchSize: "medium"},
    decoder: {readers: ["upc_reader", "ean_reader"]},
  });
}

// Quagga owns shared state. Keep reads sequential, including across consumers.
let pendingRead: Promise<unknown> = Promise.resolve();
export function createBarcodeDecoder({readImage = readQuaggaImage, urls = URL}: DecoderEnvironment = {}) {
  return (image: Blob, {signal}: {readonly signal?: AbortSignal} = {}): Promise<BarcodeReading | undefined> => {
    const checkCancelled = () => {if (signal?.aborted) throw new BarcodeDecodeError("cancelled");};
    const operation = async (): Promise<BarcodeReading | undefined> => {
      checkCancelled();
      if (!(image instanceof Blob) || !image.size || image.size > BARCODE_IMAGE_BYTE_LIMIT ||
        !/^image\/(?:jpeg|png|webp|bmp)$/.test(image.type)) throw new BarcodeDecodeError("invalid-image");
      let source: string | undefined;
      try {
        source = urls.createObjectURL(image);
        for (const size of [0, 800]) {
          checkCancelled();
          const raw = await readImage(source, size);
          checkCancelled();
          const reading = parseBarcodeReading(raw);
          if (reading) return reading;
        }
        return;
      } catch (error) {
        checkCancelled();
        throw error instanceof BarcodeDecodeError ? error : new BarcodeDecodeError("unavailable");
      } finally {
        // Cancellation must not revoke a source while Quagga is still reading it.
        if (source !== undefined) urls.revokeObjectURL(source);
      }
    };
    const result = pendingRead.then(operation);
    pendingRead = result.catch(() => undefined);
    return result;
  };
}

/** Input can be a selected photo or an image Blob captured from a video frame. */
export const decodeBarcode = createBarcodeDecoder();
