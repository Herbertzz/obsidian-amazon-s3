import { MarkdownView, App } from "obsidian";
import { parse } from "path-browserify";
import { AmazonS3UploaderPluginSettings } from "settings";

interface Link {
    path: string;
    name: string;
    source: string;
    type: 'network' | 'local';
}

// ![](./dsa/aa.png) local image should has ext, support ![](<./dsa/aa.png>), support ![](image.png "alt")
// ![](https://dasdasda) internet image should not has ext
const REGEX_FILE = /\!?\[(.*?)\]\(<(\S+\.\w+)>\)|\!?\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|\!?\[(.*?)\]\((https?:\/\/.*?)\)/g;
const REGEX_WIKI_FILE = /\!\[\[(.*?)(\s*?\|.*?)?\]\]/g;

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

    getEditor() {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
            return mdView.editor;
        } else {
            return null;
        }
    }

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
    getAllFiles(): Link[] {
        return this.getLink(this.getValue() ?? "");
    }

    // 从指定字符串中获取所有链接, 并根据设置过滤掉不需要处理的链接
    getLink(value: string): Link[] {
        const matches = value.matchAll(REGEX_FILE);
        const WikiMatches = value.matchAll(REGEX_WIKI_FILE);

        let fileArray: Link[] = [];

        for (const match of matches) {
            const source = match[0];

            const name = match[1] ?? match[3] ?? match[5] ?? "";
            const path = match[2] ?? match[4] ?? match[6] ?? "";

            fileArray.push({
                path: path,
                name: name,
                source: source,
                type: path.startsWith("http") ? "network" : "local",
            });
        }

        for (const match of WikiMatches) {
            let name = parse(match[1] ?? '').name;
            const path = match[1] ?? "";
            const source = match[0];
            if (match[2]) {
                name = `${name}${match[2]}`;
            }
            fileArray.push({
                path: path,
                name: name,
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
    async makeLink(path: string, description: string = '', realExtension?: string): Promise<string> {
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
        const IMAGE_EXT_LIST = [
            "png",
            "jpg",
            "jpeg",
            "bmp",
            "gif",
            "svg",
            "tiff",
            "webp",
            "avif",
        ];
        return IMAGE_EXT_LIST.includes(ext.toLowerCase());
    }
}