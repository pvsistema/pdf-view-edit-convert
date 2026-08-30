// Описания для библиотек чтения снимков: своих типов они не поставляют

declare module 'utif' {
  export type IFD = {
    width: number;
    height: number;
    [key: string]: unknown;
  };
  const UTIF: {
    decode: (buffer: ArrayBuffer | Uint8Array) => IFD[];
    decodeImage: (buffer: ArrayBuffer | Uint8Array, ifd: IFD) => void;
    toRGBA8: (ifd: IFD) => Uint8Array;
  };
  export default UTIF;
}

declare module 'heic-decode' {
  const decode: (input: { buffer: Uint8Array }) => Promise<{
    width: number;
    height: number;
    data: Uint8Array;
  }>;
  export default decode;
}
