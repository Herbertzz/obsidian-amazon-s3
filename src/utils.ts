import { extname } from "path-browserify";
import { Readable } from "stream";

export interface IStringKeyMap<T> {
  [key: string]: T;
}

const IMAGE_EXT_LIST = [
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".gif",
  ".svg",
  ".tiff",
  ".webp",
  ".avif",
];

export function isAnImage(ext: string) {
  return IMAGE_EXT_LIST.includes(ext.toLowerCase());
}
export function isAssetTypeAnImage(path: string): boolean {
  return isAnImage(extname(path));
}

export async function streamToString(stream: Readable) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  // @ts-ignore
  return Buffer.concat(chunks).toString("utf-8");
}

export function getUrlAsset(url: string): string {
  const afterSlash = url.slice(1 + url.lastIndexOf("/"));
  const withoutQuery = afterSlash.split("?")[0] ?? afterSlash;
  return withoutQuery.split("#")[0] ?? withoutQuery;
}

export function getLastImage(list: string[]): string | undefined {
  const reversedList = list.reverse();
  return reversedList.find(item => item && item.startsWith("http"));
}

interface AnyObj {
  [key: string]: any;
}

export function arrayToObject<T extends AnyObj>(
  arr: T[],
  key: string
): { [key: string]: T } {
  const obj: { [key: string]: T } = {};
  arr.forEach(element => {
    obj[element[key]] = element;
  });
  return obj;
}

export function bufferToArrayBuffer(buffer: Buffer) {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i] as number;
  }
  return arrayBuffer;
}

export function arrayBufferToBuffer(arrayBuffer: ArrayBuffer) {
  const buffer = Buffer.alloc(arrayBuffer.byteLength);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; ++i) {
    buffer[i] = view[i] as number;
  }
  return buffer;
}

export function uuid() {
  return Math.random().toString(36).slice(2);
}