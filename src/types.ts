import type { TFile } from "obsidian";

export interface FileInfo {
    path: string;
    name: string;
    source: string;
    type?: "network" | "local";
}

export interface FileInfoWithTFile extends FileInfo {
    tfile: TFile | null;
}

export interface FileInfoWithBuffer extends FileInfo {
    data?: ArrayBuffer;
    realExtension?: string; // 实际文件扩展名, 从文件内容解析得到
    mimeType?: string; // 文件 MIME 类型, 从文件内容解析得到
}

export interface RefererRule {
    domain: string;
    referer: string;
}
