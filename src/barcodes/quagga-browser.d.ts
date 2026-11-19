// The package's root declarations use legacy syntax rejected by TypeScript 7.
// Describe only the packaged browser API used by the decoder.
declare module "@ericblade/quagga2/dist/quagga.min.js" {
  const Quagga: {
    decodeSingle(config: {
      src: string;
      numOfWorkers: 0;
      locate: boolean;
      inputStream: {size: number};
      locator: {halfSample: boolean; patchSize: "medium"};
      decoder: {readers: ("upc_reader" | "ean_reader")[]};
    }): Promise<unknown>;
  };
  export default Quagga;
}
