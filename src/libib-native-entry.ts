import {registerLibibNativeBridge, type LibibJQuery} from "./libib-native.js";

registerLibibNativeBridge(window, () => (window as unknown as {jQuery?: LibibJQuery}).jQuery);
