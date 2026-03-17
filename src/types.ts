import type { TFile } from "obsidian";

export interface Image {
  path: string;
  name: string;
  source: string;
  type?: 'network' | 'local';
  file?: TFile | null;
}

export interface FileData {
  path: string;
  name: string;
  source: string;
  type?: 'network' | 'local';
  data?: ArrayBuffer;
}
