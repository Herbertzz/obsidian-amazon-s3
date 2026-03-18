import { fileTypeFromBuffer } from "file-type";
import { MarkdownView, App, TFile } from "obsidian";
import { parse } from "path-browserify";
import { AmazonS3UploaderPluginSettings } from "settings";
import { AnyObj } from "types";

interface Link {
    path: string;
    alt: string;
    source: string;
    type: 'network' | 'local';
}

// REGEX_FILE 可匹配以下格式（图片用 ![]() 前缀，普通文件用 []() 前缀）：
//   ![[alt](<./path/image.png>)   带尖括号路径，本地文件（路径中需含扩展名）
//   ![alt](./path/image.png)      标准 Markdown 图片/文件链接（路径中需含扩展名）
//   ![alt](image.png "title")     带可选标题的本地链接
//   ![alt](https://example.com/x) 网络链接（http/https，无需扩展名）
const REGEX_FILE = /\!?\[(.*?)\]\(<(\S+\.\w+)>\)|\!?\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|\!?\[(.*?)\]\((https?:\/\/.*?)\)/g;
// REGEX_WIKI_FILE 可匹配以下格式：
//   ![[image.png]]          Wiki 风格图片嵌入
//   ![[image.png|alias]]    带别名的 Wiki 风格图片嵌入
const REGEX_WIKI_FILE = /\!\[\[(.*?)(\s*?\|.*?)?\]\]/g;

const IMAGE_EXT_LIST = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "tiff",
    "bmp",
    "ico",
    "avif",
    "heic",
    "heif",
];

export default class Helper {
    private app: App;
    private settings: AmazonS3UploaderPluginSettings;

    constructor(app: App, settings: AmazonS3UploaderPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    // 获取当前文件的 frontmatter 对象
    getFrontmatter(): Record<string, any> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return {};
        }

        const cache = this.app.metadataCache.getFileCache(activeFile);
        return cache?.frontmatter ?? {};
    }

    // 获取 frontmatter 中指定 key 的值，若不存在则返回默认值
    getFrontmatterValue<T>(key: string, defaultValue: T | undefined = undefined): T | undefined {
        let value = defaultValue;
        const frontmatter = this.getFrontmatter();
        if (frontmatter.hasOwnProperty(key)) {
            value = frontmatter[key] as T;
        }
        return value;
    }

    // 获取当前 Markdown 编辑器实例
    getEditor() {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
            return mdView.editor;
        } else {
            return null;
        }
    }

    // 获取当前 Markdown 编辑器中的文本内容
    getValue() {
        const editor = this.getEditor();
        return editor?.getValue();
    }

    setValue(value: string) {
        const editor = this.getEditor();
        if (!editor) {
            return;
        }

        const { left, top } = editor.getScrollInfo();
        const position = editor.getCursor();

        editor.setValue(value);
        editor.scrollTo(left, top);
        editor.setCursor(position);
    }

    // 获取当前文件中的所有文件链接 (包含本地文件、网络文件、本地图片、网络图片)
    getCurrentLinks(): Link[] {
        return this.getLink(this.getValue() ?? "");
    }

    // 从指定字符串中获取所有链接, 并根据设置过滤掉不需要处理的链接
    getLink(value: string): Link[] {
        const matches = value.matchAll(REGEX_FILE);
        const WikiMatches = value.matchAll(REGEX_WIKI_FILE);

        let fileArray: Link[] = [];

        for (const match of matches) {
            const source = match[0];

            const alt = match[1] ?? match[3] ?? match[5] ?? "";
            const path = match[2] ?? match[4] ?? match[6] ?? "";

            fileArray.push({
                path: path,
                alt: alt,
                source: source,
                type: path.startsWith("http") ? "network" : "local",
            });
        }

        for (const match of WikiMatches) {
            const path = match[1] ?? "";
            const source = match[0];
            let alt = parse(match[1] ?? '').name;
            if (match[2]) {
                alt = `${alt}${match[2]}`;
            }
            fileArray.push({
                path: path,
                alt: alt,
                source: source,
                type: path.startsWith("http") ? "network" : "local",
            });
        }

        return this.filterLinks(fileArray);
    }

    // 过滤链接列表，返回符合设置要求的链接
    private filterLinks(links: Link[]) {
        const filteredLinks: Link[] = [];

        for (const match of links) {
            if (match.type === 'network') {
                if (this.settings.workOnNetWork) {
                    if (!this.hasBlackDomain(match.path, this.settings.newWorkBlackDomains)) {
                        filteredLinks.push(match);
                    }
                }
            } else {
                filteredLinks.push(match);
            }
        }

        return filteredLinks;
    }

    // 判断链接是否包含黑名单中的域名
    hasBlackDomain(src: string, blackDomains: string) {
        if (blackDomains.trim() === "") {
            return false;
        }
        const blackDomainList = blackDomains.split(",").filter(item => item !== "");
        let url = new URL(src);
        const domain = url.hostname;

        return blackDomainList.some(blackDomain => domain.includes(blackDomain));
    }

    // 生成 Markdown 链接, 根据文件扩展名判断是图片链接还是普通文件链接
    makeLink(path: string, description: string = '', realExtension?: string): string {
        if (realExtension) {
            if (this.isImage(realExtension)) {
                return this.makeImageLink(path, description);
            } else {
                return this.makeFileLink(path, description);
            }
        }

        const ext = parse(path).ext.slice(1);
        if (ext && this.isImage(ext)) {
            return this.makeImageLink(path, description);
        }
        return this.makeFileLink(path, description);
    }

    // 生成 Markdown 文件链接
    makeFileLink(path: string, description: string = ''): string {
        return `[${description}](${encodeURI(path)})`
    }

    // 生成 Markdown 图片链接
    makeImageLink(path: string, description: string = ""): string {
        return `![${description}](${encodeURI(path)})`
    }


    // 判断文件是否为图片
    isImage(ext: string) {
        return IMAGE_EXT_LIST.includes(ext.toLowerCase());
    }

    // 根据文件内容识别文件类型，返回扩展名和 MIME 类型
    async getFileType(buffer: ArrayBuffer): Promise<{ ext: string; mime: string } | undefined> {
        return await fileTypeFromBuffer(buffer)
    }

    // 通过文件内容判断文件是否允许上传下载
    async isAllowFile(buffer: ArrayBuffer | TFile | File): Promise<boolean> {
        const path = buffer instanceof TFile ? buffer.path : buffer instanceof File ? buffer.name : "";
        let ext = this.getExtension(path);

        // 如果没有扩展名且提供了文件数据，则尝试通过文件内容识别类型
        if (!ext && buffer) {
            if (buffer instanceof TFile) {
                buffer = await this.app.vault.readBinary(buffer);
            }
            if (buffer instanceof File) {
                buffer = await buffer.arrayBuffer();
            }
            const type = await this.getFileType(buffer);
            ext = (type?.ext ?? '').toLowerCase();
        }

        // 如果仍然无法识别扩展名，则默认不允许处理
        if (!ext) {
            return false;
        }

        return this.settings.allowedImageTypes.includes(ext) || this.settings.allowedFileTypes.includes(ext);
    }

    // 通过扩展名判断是否允许上传下载
    isAllowFileByExt(pathOrExt: string): boolean {
        let ext = this.getExtension(pathOrExt);
        if (!ext) {
            return false;
        }

        return this.settings.allowedImageTypes.includes(ext) || this.settings.allowedFileTypes.includes(ext);
    }

    // 从路径中提取扩展名
    getExtension(pathOrExt: string): string {
        if (!pathOrExt) return "";

        if (pathOrExt.includes(".")) {
            return pathOrExt.split('.').pop()?.toLowerCase() || "";
        }

        if (!pathOrExt.includes("/") && !pathOrExt.includes("\\")) {
            return pathOrExt.toLowerCase();
        }

        return "";
    }

    // 将数组转换为对象，key 为对象的某个属性值，value 为对象本身
    arrayToObject<T extends AnyObj>(arr: T[], key: string): { [key: string]: T } {
        const obj: { [key: string]: T } = {};
        arr.forEach(element => {
            obj[element[key]] = element;
        });
        return obj;
    }
}