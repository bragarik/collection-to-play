import {BarcodeDecodeError, decodeBarcode, parseBarcodeReading, type BarcodeReading} from "./barcode-decoder.js";

export interface BarcodeReaderState {
  readonly mode: "idle" | "opening" | "camera" | "photo" | "reading" | "review";
  readonly message: string;
  readonly cameraUnavailable: boolean;
  readonly stream: MediaStream | undefined;
  readonly reading: BarcodeReading | undefined;
}
interface ReaderEnvironment {
  getCamera?(constraints: MediaStreamConstraints): Promise<MediaStream>;
  decode?(image: Blob, options: {signal: AbortSignal}): Promise<BarcodeReading | undefined>;
}

/** Centered scan area in source-video pixels, without downsampling the bars. */
export function cameraScanArea(width: number, height: number): {x: number; y: number; width: number; height: number} | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return;
  const scanWidth = Math.max(1, Math.round(width * .7));
  const scanHeight = Math.max(1, Math.round(height * .35));
  return {x: Math.floor((width - scanWidth) / 2), y: Math.floor((height - scanHeight) / 2), width: scanWidth, height: scanHeight};
}

function cameraError(error: unknown): string {
  const name = error && typeof error === "object" ? (error as {name?: unknown}).name : undefined;
  const message = error && typeof error === "object" ? (error as {message?: unknown}).message : undefined;
  if (name === "NotAllowedError" && typeof message === "string" && /^permission denied by system$/i.test(message.trim())) {
    return "O sistema operacional bloqueou o acesso do navegador à câmera. Libere a câmera nas configurações de privacidade do sistema e tente novamente, ou selecione uma foto.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") return "Acesso à câmera bloqueado ou não autorizado. Selecione uma foto do código.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Nenhuma câmera encontrada. Selecione uma foto do código.";
  if (name === "NotReadableError" || name === "TrackStartError") return "A câmera está ocupada ou indisponível. Selecione uma foto do código.";
  return "Não foi possível abrir a câmera neste navegador. Selecione uma foto do código.";
}
function stopStream(stream: MediaStream): void {for (const track of stream.getTracks()) track.stop();}

export class BarcodeReaderSession {
  private state: BarcodeReaderState = {mode: "idle", message: "", cameraUnavailable: false, stream: undefined, reading: undefined};
  private revision = 0;
  private controller = new AbortController();
  private disposed = false;
  private decoding = false;
  private previous: BarcodeReading | undefined;
  private ended: (() => void) | undefined;
  private readonly decode: NonNullable<ReaderEnvironment["decode"]>;
  private readonly getCamera: NonNullable<ReaderEnvironment["getCamera"]>;

  constructor(private readonly changed: (state: BarcodeReaderState) => void, environment: ReaderEnvironment = {}) {
    this.decode = environment.decode ?? decodeBarcode;
    this.getCamera = environment.getCamera ?? (constraints => {
      if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("Camera unavailable"));
      return navigator.mediaDevices.getUserMedia(constraints);
    });
  }
  snapshot(): BarcodeReaderState {return {...this.state};}
  private publish(update: Partial<BarcodeReaderState>): void {
    this.state = {...this.state, ...update};
    if (!this.disposed) this.changed(this.snapshot());
  }
  private stopCamera(): void {
    if (this.state.stream) {
      if (this.ended) for (const track of this.state.stream.getVideoTracks()) track.removeEventListener("ended", this.ended);
      stopStream(this.state.stream);
    }
    this.ended = undefined;
    this.state = {...this.state, stream: undefined};
  }
  private reset(): number {
    this.revision++;
    this.controller.abort();
    this.controller = new AbortController();
    this.previous = undefined;
    this.decoding = false;
    this.stopCamera();
    return this.revision;
  }
  async startCamera(): Promise<void> {
    if (this.disposed) return;
    const revision = this.reset();
    this.publish({mode: "opening", message: "Aguardando acesso à câmera…", reading: undefined});
    let stream: MediaStream | undefined;
    try {
      stream = await this.getCamera({audio: false, video: {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}}});
      if (this.disposed || revision !== this.revision) {stopStream(stream);return;}
      if (!stream.getVideoTracks().some(track => track.readyState === "live")) {
        stopStream(stream);stream = undefined;throw new DOMException("No live camera", "NotFoundError");
      }
      this.ended = () => this.usePhoto("A câmera foi interrompida. Selecione uma foto ou tente a câmera novamente.");
      for (const track of stream.getVideoTracks()) track.addEventListener("ended", this.ended);
      this.publish({mode: "camera", stream, cameraUnavailable: false, message: "Aponte a câmera para o código de barras.", reading: undefined});
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      if (stream) stopStream(stream);
      this.publish({mode: "photo", stream: undefined, cameraUnavailable: true, message: cameraError(error), reading: undefined});
    }
  }
  usePhoto(message = "Selecione uma foto nítida do código de barras."): void {
    if (this.disposed) return;
    this.reset();
    this.publish({mode: "photo", message, reading: undefined});
  }
  async readPhoto(image: Blob): Promise<void> {
    if (this.disposed) return;
    const revision = this.reset();
    this.publish({mode: "reading", message: "Lendo código da foto…", reading: undefined});
    try {
      const reading = parseBarcodeReading({codeResult: await this.decode(image, {signal: this.controller.signal})});
      if (this.disposed || revision !== this.revision) return;
      this.publish({mode: reading ? "review" : "photo", reading,
        message: reading ? "Confira o código antes de usar." : "Nenhum EAN ou UPC válido encontrado. Tente uma foto mais próxima e nítida."});
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      this.publish({mode: "photo", message: error instanceof BarcodeDecodeError ? error.message : "Não foi possível ler a foto. Selecione outra imagem.", reading: undefined});
    }
  }
  async readFrame(image: Blob): Promise<void> {
    if (this.disposed || this.decoding || this.state.mode !== "camera") return;
    const revision = this.revision;
    this.decoding = true;
    try {
      const reading = parseBarcodeReading({codeResult: await this.decode(image, {signal: this.controller.signal})});
      if (this.disposed || revision !== this.revision) return;
      if (reading && this.previous?.code === reading.code && this.previous.format === reading.format) {
        this.reset();
        this.publish({mode: "review", reading, message: "Confira o código antes de usar."});
      } else {
        this.previous = reading;
        this.publish({message: reading ? "Confirmando a leitura… Mantenha o código na câmera." : "Aponte a câmera para o código de barras."});
      }
    } catch {
      if (!this.disposed && revision === this.revision) this.usePhoto("Não foi possível ler a câmera. Selecione uma foto ou tente novamente.");
    } finally {if (revision === this.revision) this.decoding = false;}
  }
  close(): void {
    this.reset();
    if (!this.disposed) this.publish({mode: "idle", message: "", reading: undefined});
  }
  dispose(): void {this.disposed = true;this.reset();}
}
