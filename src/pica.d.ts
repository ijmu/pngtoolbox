declare module "pica" {
  type PicaInstance = { resize(from: HTMLCanvasElement, to: HTMLCanvasElement, options?: { quality?: number; alpha?: boolean }): Promise<HTMLCanvasElement> };
  export default function pica(options?: { features?: string[] }): PicaInstance;
}
