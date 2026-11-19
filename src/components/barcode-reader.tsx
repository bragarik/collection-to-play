import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from "preact/hooks";
import {BarcodeReaderSession, cameraScanArea} from "../barcodes/barcode-reader.js";
import {barcodeValueForTarget, parseBarcodeReading, type BarcodeReading, type BarcodeTarget} from "../barcodes/barcode-decoder.js";

function ReaderIcon({photo}: {photo: boolean}) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    {photo ? <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>
      : <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 7v10m3-10v10m4-10v10m3-10v10"/></>}
  </svg>;
}

export interface BarcodeReaderProps {
  readonly target: BarcodeTarget;
  readonly onUse: (value: string, reading: BarcodeReading) => void;
  readonly disabled?: boolean;
  readonly fieldLabel?: string;
}

let photoFallback: boolean | undefined;
const availabilityListeners = new Set<(photo: boolean) => void>();
function cameraAvailability(available: boolean): void {
  photoFallback = !available;
  for (const listener of availabilityListeners) listener(photoFallback);
}

export function BarcodeReaderButton({target, onUse, disabled, fieldLabel}: BarcodeReaderProps) {
  const [open, setOpen] = useState(false), [photo, setPhoto] = useState(photoFallback ?? typeof navigator.mediaDevices?.getUserMedia !== "function");
  useEffect(() => {
    availabilityListeners.add(setPhoto);
    if (photoFallback !== undefined) setPhoto(photoFallback);
    return () => {availabilityListeners.delete(setPhoto);};
  }, []);
  const label = (photo ? "Selecionar foto do código de barras" : "Ler código de barras") + (fieldLabel ? ` para ${fieldLabel}` : "");
  return <>
    <button class="barcode-reader-trigger btn btn-soft btn-square btn-sm" type="button" aria-label={label} title={label} aria-haspopup="dialog"
      disabled={disabled} onClick={() => setOpen(true)}><ReaderIcon photo={photo}/></button>
    {open && <BarcodeReaderDialog target={target} initialPhoto={photo} onCameraAvailability={cameraAvailability}
      onUse={(value, reading) => {setOpen(false);onUse(value, reading);}} onCancel={() => setOpen(false)}/>}
  </>;
}

export function BarcodeReaderDialog({target, initialPhoto = false, onCameraAvailability, onUse, onCancel}: {
  readonly target: BarcodeTarget;
  readonly initialPhoto?: boolean;
  readonly onCameraAvailability?: (available: boolean) => void;
  readonly onUse: BarcodeReaderProps["onUse"];
  readonly onCancel: () => void;
}) {
  const [, refresh] = useState(0), [edited, setEdited] = useState<{reading: BarcodeReading; code: string}>();
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const id = useId();
  const session = useMemo(() => new BarcodeReaderSession(() => refresh(value => value + 1)), []);
  const state = session.snapshot();
  const code = state.reading && edited?.reading === state.reading ? edited.code : state.reading?.code ?? "";
  useLayoutEffect(() => {
    const node = dialog.current!;
    const cancel = (event: Event) => {event.preventDefault();session.close();onCancel();};
    const close = () => {session.close();onCancel();};
    const hidden = () => {if (document.hidden && ["camera", "opening"].includes(session.snapshot().mode)) session.usePhoto("A câmera foi pausada. Selecione uma foto ou abra a câmera novamente.");};
    const pageHide = () => session.close();
    node.addEventListener("cancel", cancel);node.addEventListener("close", close);
    document.addEventListener("visibilitychange", hidden);window.addEventListener("pagehide", pageHide);
    node.showModal();
    if (initialPhoto) session.usePhoto();else void session.startCamera();
    return () => {
      session.dispose();node.removeEventListener("cancel", cancel);node.removeEventListener("close", close);
      document.removeEventListener("visibilitychange", hidden);window.removeEventListener("pagehide", pageHide);node.close();
    };
  }, []);
  useEffect(() => {if (state.mode === "camera") onCameraAvailability?.(true);else if (state.cameraUnavailable) onCameraAvailability?.(false);}, [state.mode, state.cameraUnavailable]);
  useEffect(() => {
    const stream = state.stream, element = video.current;
    if (!stream || !element) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {if (!stopped && session.snapshot().stream === stream) session.usePhoto("Não foi possível mostrar a câmera. Selecione uma foto ou tente novamente.");};
    element.srcObject = stream;
    void element.play().catch(fail);
    const canvas = document.createElement("canvas");
    const capture = async () => {
      if (stopped || session.snapshot().stream !== stream) return;
      try {
        if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
          const area = cameraScanArea(element.videoWidth, element.videoHeight);
          if (!area) {fail();return;}
          if (guide.current) {
            const scale = Math.min(element.clientWidth / element.videoWidth, element.clientHeight / element.videoHeight);
            const left = (element.clientWidth - element.videoWidth * scale) / 2;
            const top = (element.clientHeight - element.videoHeight * scale) / 2;
            Object.assign(guide.current.style, {left: `${left + area.x * scale}px`, top: `${top + area.y * scale}px`,
              width: `${area.width * scale}px`, height: `${area.height * scale}px`});
          }
          canvas.width = area.width;canvas.height = area.height;
          const context = canvas.getContext("2d");
          if (!context) {fail();return;}
          context.drawImage(element, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
          if (!stopped) {if (!blob) {fail();return;}await session.readFrame(blob);}
        }
      } catch {fail();return;}
      if (!stopped && session.snapshot().stream === stream) timer = setTimeout(() => void capture(), 250);
    };
    void capture();
    return () => {stopped = true;clearTimeout(timer);element.pause();element.srcObject = null;canvas.width = canvas.height = 0;};
  }, [state.stream]);

  const reading = parseBarcodeReading({codeResult: {code, format: code.length === 12 ? "upc_a" : "ean_13"}});
  const value = reading ? barcodeValueForTarget(reading, target) : undefined;
  const cancel = () => {session.close();onCancel();};
  return <dialog class="barcode-reader" ref={dialog} aria-labelledby={`${id}-title`} onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "file") {
      event.preventDefault();event.stopPropagation();
    }
  }}>
    <header class="barcode-reader-header"><h2 id={`${id}-title`}>Ler código de barras</h2>
      <button class="btn btn-ghost btn-sm" type="button" onClick={cancel}>Cancelar leitura</button></header>
    <div class="barcode-reader-body">
      <p class="note">Aponte para o EAN/UPC ou selecione uma foto. Confira o código antes de preencher.</p>
      <p role="status" aria-live="polite">{state.message}</p>
      <div class="barcode-reader-camera" hidden={state.mode !== "camera"}>
        <video ref={video} hidden={state.mode !== "camera"} muted playsInline aria-label="Prévia da câmera"/>
        <div class="barcode-reader-guide" ref={guide} aria-hidden="true"/>
      </div>
      {state.mode === "camera" && <p class="note">Enquadre todas as barras dentro da mira, na horizontal e com margem nas laterais. Ajuste a distância até ficarem nítidas.</p>}
      {state.mode === "opening" && <span class="loading loading-spinner" aria-label="Abrindo câmera"/>}
      {state.mode === "reading" && <span class="loading loading-spinner" aria-label="Lendo foto"/>}
      {state.mode === "review" && <div class="barcode-reader-review">
        <label for={`${id}-code`}>Código lido</label>
        <input id={`${id}-code`} class="input w-full" value={code} inputMode="numeric" maxLength={13} autoComplete="off"
          onInput={event => {if (state.reading) setEdited({reading: state.reading, code: event.currentTarget.value});}}/>
        {!reading && <p role="alert">Confira os dígitos: o código EAN/UPC não é válido.</p>}
        {reading && !value && <p role="alert">Este EAN não tem representação UPC-A equivalente. Use o campo EAN.</p>}
        {value && value !== code && <p class="note">Valor equivalente para o campo {target.toUpperCase()}: {value}</p>}
        <button class="btn btn-primary" type="button" disabled={!value} onClick={() => {if (reading && value) {session.close();onUse(value, reading);}}}>Usar código</button>
      </div>}
      <div class="barcode-reader-actions">
        {state.mode !== "photo" && state.mode !== "reading" && <button class="btn btn-soft btn-sm" type="button" onClick={() => session.usePhoto()}>Usar foto</button>}
        {(state.mode === "photo" || state.mode === "review" || state.mode === "reading") && <label class="barcode-reader-file">Selecionar foto
          <input type="file" accept="image/jpeg,image/png,image/webp,image/bmp" disabled={state.mode === "reading"}
            onChange={event => {const image = event.currentTarget.files?.[0];event.currentTarget.value = "";if (image) void session.readPhoto(image);}}/>
        </label>}
        {!["camera", "opening", "reading"].includes(state.mode) && typeof navigator.mediaDevices?.getUserMedia === "function" &&
          <button class="btn btn-soft btn-sm" type="button" onClick={() => void session.startCamera()}>Tentar câmera novamente</button>}
      </div>
    </div>
  </dialog>;
}
