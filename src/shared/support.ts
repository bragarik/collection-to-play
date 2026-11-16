import QRCode from "qrcode";

export type SupportMethod = "pix" | "bitcoin" | "lightning" | "paypal";
export interface SupportOption {readonly id: SupportMethod; readonly label: string; readonly value: string; readonly note: string; readonly url?: string}

/** Public receiving details only. Empty entries remain unavailable. */
export const SUPPORT_RECEIVING = {
  pix: "00020126870014BR.GOV.BCB.PIX0136e55c5a8e-2dd8-4ad0-a601-30a5dfc380380225Doacao Collection to play5204000053039865802BR5922RICARDO CASSIANO BRAGA6009SAO PAULO622605222PbJ3t2ykvYJnABO15WZTr63048618",
  bitcoin: "BC1QKU5HUK3PHDWHGLFRQ583RVR8UQMMSG49GV7KRN",
  lightning: "lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx7twd93kzmr5v9kxc7fcxgt45zg2",
  paypal: "https://www.paypal.com/donate/?business=bragarik%40gmail.com&currency_code=BRL&item_name=Collection%20to%20Play",
} satisfies Record<SupportMethod, string>;

export function supportOptions(receiving: Readonly<Record<SupportMethod, string>> = SUPPORT_RECEIVING): readonly SupportOption[] {
  const values: SupportOption[] = [];
  const add = (id: SupportMethod, label: string, note: string): void => {
    const value = receiving[id].trim();
    if (!value) return;
    if (id === "paypal") {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com"].includes(url.hostname)) throw new Error("Informe um link público de recebimento do PayPal.");
      values.push({id, label, value, note, url: value});
    } else values.push({id, label, value, note});
  };
  add("pix", "Pix", "Copie o código ou leia o QR Code no aplicativo do seu banco.");
  add("bitcoin", "Bitcoin", "Endereço de recebimento na rede principal do Bitcoin.");
  add("lightning", "Lightning — sats", "Use uma carteira compatível com Lightning Address ou LNURL.");
  add("paypal", "PayPal", "Conclua o apoio na página do PayPal.");
  return values;
}

export function supportQr(value: string): {readonly size: number; readonly path: string} {
  if (!value.trim() || new TextEncoder().encode(value).length > 2048) throw new Error("Não foi possível preparar este QR Code.");
  const {modules} = QRCode.create(value, {errorCorrectionLevel: "M"});
  let path = "";
  for (let row = 0; row < modules.size; row++) for (let column = 0; column < modules.size; column++) {
    if (modules.get(row, column)) path += `M${column + 4} ${row + 4}h1v1h-1z`;
  }
  return {size: modules.size + 8, path};
}
