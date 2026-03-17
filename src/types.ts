import type { TFile } from "obsidian";

export interface AnyObj {
  [key: string]: any;
}

export interface FileInfo {
  path: string;
  name: string;
  source: string;
  type?: 'network' | 'local';
}

export interface FileInfoWithTFile extends FileInfo {
  tfile: TFile | null;
}

export interface FileData {
  path: string;
  name: string;
  source: string;
  type?: 'network' | 'local';
  data?: ArrayBuffer;
  realExtension?: string; // 实际文件扩展名, 从文件内容解析得到
  mimeType?: string; // 文件 MIME 类型, 从文件内容解析得到
}
