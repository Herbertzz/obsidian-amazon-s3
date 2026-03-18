import { App, Editor, EmbedCache, LinkCache, MarkdownView, normalizePath, Notice, TFile } from "obsidian";
import { fileTypeFromBuffer } from 'file-type';
import { FileInfoWithTFile } from "types";
import { TemplateParser } from "./templateParser";
import { PutObjectCommand, S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import Helper from "./helper";
import { AmazonS3UploaderPluginSettings } from "./settings";
import { basename, dirname, resolve } from "path-browserify";
import { Downloader } from "./downloader";


export class Uploader {
    private app: App;
    private settings: AmazonS3UploaderPluginSettings;
    private helper: Helper;
    private downloader: Downloader;

    constructor(app: App, settings: AmazonS3UploaderPluginSettings) {
        this.app = app;
        this.settings = settings;
        this.helper = new Helper(this.app, this.settings);
        this.downloader = new Downloader(this.app, this.settings);
    }

    // 上传所有文件
    async uploadAll() {
        const activeFile = this.app.workspace.getActiveFile();
        const fileMap = this.helper.arrayToObject(this.app.vault.getFiles(), "name");
        const filePathMap = this.helper.arrayToObject(this.app.vault.getFiles(), "path");

        const fileList: FileInfoWithTFile[] = [];
        const links = this.helper.getCurrentLinks();
        for (const link of links) {
            if (link.type === "network") {
                const result = await this.downloader.precheckDownload(link.path);
                if (result.canDownload) {
                    fileList.push({
                        path: link.path,
                        name: link.alt,
                        source: link.source,
                        type: 'network',
                        tfile: null,
                    });
                }
                continue;
            }

            const path = decodeURI(link.path);
            const fileName = basename(path);
            let file: TFile | undefined | null;

            // 优先匹配绝对路径
            if (filePathMap[path]) {
                file = filePathMap[path];
            }

            // 相对路径
            if ((!file && path.startsWith("./")) || path.startsWith("../")) {
                const filePath = normalizePath(resolve(dirname(activeFile?.path || ""), path));
                file = filePathMap[filePath];
            }

            // 尽可能短路径
            if (!file) {
                file = fileMap[fileName];
            }

            if (file) {
                if (await this.helper.isAllowFile(file)) {
                    fileList.push({
                        path: normalizePath(file.path),
                        name: link.alt,
                        source: link.source,
                        type: 'local',
                        tfile: file,
                    });
                }
            }
        }

        if (fileList.length === 0) {
            new Notice("没有找到任何文件！");
            return;
        }

        new Notice(`已找到 ${fileList.length} 个文件！`);

        // 下载网络文件到本地
        if (this.settings.workOnNetWork) {
            new Notice("正在下载网络文件...");
            for (const item of fileList) {
                if (item.type !== "network") {
                    continue;
                }

                const downloadResult = await this.downloader.download(item.path);
                if (!downloadResult.success) {
                    console.error(`Failed to download ${item.path}:`, downloadResult.error);
                    new Notice(`下载 ${item.name} 失败！`);
                    continue;
                }

                item.path = downloadResult.filePath ?? '';
                item.type = 'local';

                const tfile = this.app.vault.getAbstractFileByPath(item.path);
                if (tfile instanceof TFile) {
                    item.tfile = tfile;
                } else {
                    console.error(`Downloaded file not found in vault: ${item.path}`);
                    new Notice(`下载 ${item.name} 成功，但未找到文件！`);
                }
            }
        }

        // 上传文件并获取 URL
        const uploadUrlList: string[] = [];
        for (const file of fileList) {
            if (!file.tfile) {
                continue;
            }

            try {
                const url = await this.upload(file.tfile);
                uploadUrlList.push(url);
            } catch (error) {
                console.error(`Failed to upload ${file.path}:`, error);
                new Notice(`上传 ${file.name} 失败！`);
            }
        }

        if (fileList.length !== uploadUrlList.length) {
            new Notice("警告：文件列表与上传成功的文件数量不一致");
            return;
        }

        const currentFile = this.app.workspace.getActiveFile();
        if (activeFile?.path !== currentFile?.path) {
            new Notice("当前文件已变更，上传失败");
            return;
        }

        // 替换上传的文件
        const editorContent = this.helper.getValue();
        if (!editorContent) {
            new Notice("无法获取编辑器内容！");
            return;
        }

        let content: string = editorContent;
        fileList.map(item => {
            const uploadImage = uploadUrlList.shift();
            content = content.split(item.source).join(`![${item.name}](${uploadImage})`);
        });

        this.helper.setValue(content);

        // 删除本地原文件
        if (this.settings.deleteSource) {
            fileList.map(file => {
                if (file.tfile && file.type === 'local') {
                    void this.app.fileManager.trashFile(file.tfile);
                }
            });
        }
    }

    // 监听文件菜单的上传操作
    async fileMenuUpload(file: TFile) {
        if (!await this.helper.isAllowFile(file)) {
            new Notice("不允许上传此类型的文件！");
        }

        // 上传文件并获取 URL
        const url = await this.upload(file);
        if (!url) {
            new Notice(`上传 ${file.name} 失败！`);
            return;
        }

        // 寻找所有引用了该文件的链接（包括普通链接和嵌入图片）
        const backlinks: { file: TFile, links: (LinkCache | EmbedCache)[] }[] = [];
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        for (const linkPath in resolvedLinks) {
            if (resolvedLinks?.[linkPath]?.[file.path]) {
                const linkFile = this.app.vault.getAbstractFileByPath(linkPath);
                if (!(linkFile instanceof TFile)) continue;
                const linkFileCache = this.app.metadataCache.getFileCache(linkFile);
                if (!(linkFileCache)) continue;

                // 合并所有的普通链接和嵌入图片
                const allLinks = [...(linkFileCache.embeds || []), ...(linkFileCache.links || [])];
                // 过滤出指向当前文件的链接
                const relevantLinks = allLinks.filter(link => {
                    const resolvedPath = this.app.metadataCache.getFirstLinkpathDest(link.link, linkPath);
                    return resolvedPath?.path === file.path;
                });
                if (relevantLinks.length > 0) {
                    backlinks.push({
                        file: linkFile,
                        links: relevantLinks,
                    });
                }
            }
        }

        // 替换所有链接为新的 URL
        for (const backlink of backlinks) {
            await this.app.vault.process(backlink.file, content => {
                let updatedContent = content;
                backlink.links.forEach(link => {
                    const originalText = link.original;
                    const prefix = originalText.startsWith("!") ? "!" : "";
                    const altText = link.displayText || "";
                    const newMarkdownLink = `${prefix}[${altText}](${url})`;

                    updatedContent = updatedContent.split(originalText).join(newMarkdownLink);
                });
                return updatedContent;
            })
        }

        if (this.settings.deleteSource) {
            await this.app.fileManager.trashFile(file);
        }

        new Notice(`文件 ${file.name} 已上传并替换 ${backlinks.length} 个链接！`);
    }

    // 监听剪贴板事件，自动上传文件
    async onClipboardAutoUpload(evt: ClipboardEvent, editor: Editor, markdownView: MarkdownView) {
        const allowUpload = this.helper.getFrontmatterValue("image-auto-upload", this.settings.uploadByClipboardSwitch);
        if (!allowUpload) {
            return;
        }

        if (!evt.clipboardData) {
            return;
        }

        const files = evt.clipboardData.files;
        const text = evt.clipboardData.getData("text/plain");

        // 过滤出允许上传的文件
        const filteredFiles: File[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files.item(i);
            if (!file) {
                continue;
            }
            if (await this.helper.isAllowFile(file)) {
                filteredFiles.push(file);
            }
        }

        // 如果剪贴板中既有文件又有文本内容，根据设置决定是否上传
        if (!this.settings.applyFile && filteredFiles.length > 0 && text) {
            return;
        }

        // 拦截默认行为
        evt.preventDefault();

        const uploadList: File[] = [...filteredFiles];

        // 剪贴板内容有md格式的文件时
        if (this.settings.workOnNetWork) {
            const linkList = this.helper.getLink(text).filter(link => link.type === 'network');

            // 下载预检
            const canDownloadList = await Promise.all(
                linkList.map(link => this.downloader.precheckDownload(link.path))
            );
            const validLinkList = linkList.filter((_, index) => canDownloadList?.[index]?.canDownload);

            // 下载网络文件到本地
            if (validLinkList.length !== 0) {
                for (const link of validLinkList) {
                    const res = await this.downloader.download(link.path);
                    if (!res.success || !res.filePath) {
                        console.error(`Failed to download ${link.path}:`, res.error);
                        new Notice(`下载 ${link.alt} 失败！`);
                        continue;
                    }

                    const tfile = this.app.vault.getAbstractFileByPath(res.filePath);
                    if (!(tfile instanceof TFile)) {
                        console.error(`Downloaded file not found in vault: ${res.filePath}`);
                        new Notice(`下载 ${link.alt} 成功，但未找到文件！`);
                        continue;
                    }

                    const arrayBuffer = await this.app.vault.readBinary(tfile);
                    const file = new File([arrayBuffer], tfile.name, {
                        type: res.mimeType,
                        lastModified: tfile.stat.mtime,
                    });

                    uploadList.push(file);
                }
            }
        }

        if (uploadList.length === 0) {
            return;
        }

        // 开始上传
        for (const file of uploadList) {
            let pasteId = this.makeID();
            this.insertTemporaryText(editor, pasteId);

            try {
                const url = await this.upload(file);
                if (url) {
                    const fileType = await fileTypeFromBuffer(await file.arrayBuffer());
                    this.embedMarkdownLink(editor, pasteId, fileType?.ext ?? '', url, file.name);
                } else {
                    this.handleFailedUpload(editor, pasteId, "文件不存在")
                }
            } catch (e) {
                const reason = e instanceof Error ? e.message : String(e);
                this.handleFailedUpload(editor, pasteId, reason);
            }
        }
    }

    // 监听拖拽事件，自动上传文件  
    async onDropAutoUpload(evt: DragEvent, editor: Editor) {
        // 如果按住了 Ctrl/Cmd，放行，执行 Obsidian 默认行为（保存到本地）
        if (evt.ctrlKey || evt.metaKey) return;

        const allowUpload = this.helper.getFrontmatterValue("image-auto-upload", this.settings.uploadByDropSwitch);
        if (!allowUpload) {
            return;
        }

        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;

        // 拦截默认行为
        evt.preventDefault();

        for (let i = 0; i < files.length; i++) {
            const file = files.item(i);
            if (!file) {
                continue;
            }

            if (!await this.helper.isAllowFile(file)) {
                continue;
            }

            const url = await this.upload(file);

            const id = this.makeID();
            this.insertTemporaryText(editor, id);
            const fileType = await fileTypeFromBuffer(await file.arrayBuffer());
            this.embedMarkdownLink(editor, id, fileType?.ext ?? '', url, file.name);
        }
    }

    // 核心上传函数，支持 TFile、File 和 ArrayBuffer 三种输入
    private async upload(file: TFile | File | ArrayBuffer, filename?: string): Promise<string> {
        let buffer: ArrayBuffer;
        if (file instanceof TFile) {
            buffer = await this.app.vault.readBinary(file);
            filename = filename || file.name;
        } else if (file instanceof File) {
            buffer = await file.arrayBuffer();
            filename = filename || file.name;
        } else {
            buffer = file;
            filename = filename || "unknown";
        }

        const fileType = await fileTypeFromBuffer(buffer);

        // 生成唯一的 S3 Key (文件路径)
        const uploadPath = await TemplateParser.uploadPath(
            this.settings.uploadPathTemplate,
            filename,
            fileType?.ext ?? '',
            buffer
        );

        // 初始化 S3 客户端
        const clientConfig: S3ClientConfig = {
            region: this.settings.region,
            credentials: {
                accessKeyId: this.settings.accessKeyId,
                secretAccessKey: this.settings.secretAccessKey,
            },
            forcePathStyle: this.settings.forcePathStyle,
        };
        if (this.settings.endpoint) {
            clientConfig.endpoint = this.settings.endpoint;
        }
        const client = new S3Client(clientConfig);

        // 构建并发送上传命令
        const command = new PutObjectCommand({
            Bucket: this.settings.bucket,
            Key: uploadPath,
            Body: new Uint8Array(buffer),
            ContentType: fileType?.mime ?? 'application/octet-stream',
            // ACL: 'public-read', // 如果你的 Bucket 策略要求显式声明公共读权限，可以取消注释
        });
        await client.send(command);

        // 构建返回的 URL
        const uploadedPath = uploadPath.split('/').map((part: string) => encodeURIComponent(part)).join('/');
        return TemplateParser.outputURL(this.settings.outputURLTemplate, {
            endpoint: this.settings.endpoint,
            bucket: this.settings.bucket,
            region: this.settings.region,
        }, uploadedPath);
    }

    // 生成一个随机 ID，用于临时占位符
    private makeID() {
        return (Math.random() + 1).toString(36).substring(2, 7);
    }

    // 在编辑器中插入临时文本占位符
    private insertTemporaryText(editor: Editor, id: string) {
        const progressText = this.progressTextFor(id);
        editor.replaceSelection(progressText + "\n");
    }

    // 将 Markdown 链接嵌入编辑器，替换之前的占位符文本
    private embedMarkdownLink(editor: Editor, id: string, ext: string, path: string, name: string = "") {
        const progressText = this.progressTextFor(id);
        const link = this.helper.makeLink(path, name, ext);
        this.replaceFirstOccurrence(editor, progressText, link);
    }

    // 处理上传失败的情况，替换占位符文本为错误提示
    handleFailedUpload(editor: Editor, id: string, reason: string) {
        new Notice(reason);
        console.error("Failed request: ", reason);
        const progressText = this.progressTextFor(id);
        this.replaceFirstOccurrence(editor, progressText, "⚠️upload failed, check dev console");
    }

    // 生成临时占位符文本
    private progressTextFor(id: string) {
        return `![Uploading file...${id}]()`;
    }

    // 替换编辑器中第一次出现的目标文本为替换文本
    private replaceFirstOccurrence(editor: Editor, target: string, replacement: string) {
        let lines = editor.getValue().split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            let ch = line.indexOf(target);
            if (ch != -1) {
                let from = { line: i, ch: ch };
                let to = { line: i, ch: ch + target.length };
                editor.replaceRange(replacement, from, to);
                break;
            }
        }
    }
}
