import { App, Editor, MarkdownView, normalizePath, Notice, TFile } from "obsidian";
import { fileTypeFromBuffer } from 'file-type';
import { Image } from "types";
import { TemplateParser } from "TemplateParser";
import { PutObjectCommand, S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import Helper from "helper";
import { AmazonS3UploaderPluginSettings } from "settings";
import { arrayToObject, isAssetTypeAnImage } from "utils";
import { basename, dirname, resolve } from "path-browserify";


export class Uploader {
    private app: App;
    private settings: AmazonS3UploaderPluginSettings;
    private helper: Helper;

    constructor(app: App, settings: AmazonS3UploaderPluginSettings) {
        this.app = app;
        this.settings = settings;
        this.helper = new Helper(this.app);
    }

    // 上传所有图片
    async uploadAll() {
        const activeFile = this.app.workspace.getActiveFile();
        const fileMap = arrayToObject(this.app.vault.getFiles(), "name");
        const filePathMap = arrayToObject(this.app.vault.getFiles(), "path");
        let imageList: (Image & { file: TFile | null })[] = [];
        const fileArray = this.filterFile(this.helper.getAllFiles());

        for (const match of fileArray) {
            const imageName = match.name;
            const uri = decodeURI(match.path);

            if (uri.startsWith("http")) {
                imageList.push({
                    path: match.path,
                    name: imageName,
                    source: match.source,
                    type: 'network',
                    file: null,
                });
                continue;
            }

            const fileName = basename(uri);
            let file: TFile | undefined | null;
            // 优先匹配绝对路径
            if (filePathMap[uri]) {
                file = filePathMap[uri];
            }

            // 相对路径
            if ((!file && uri.startsWith("./")) || uri.startsWith("../")) {
                const filePath = normalizePath(
                    resolve(dirname(activeFile?.path || ""), uri)
                );

                file = filePathMap[filePath];
            }

            // 尽可能短路径
            if (!file) {
                file = fileMap[fileName];
            }

            if (file) {
                if (isAssetTypeAnImage(file.path)) {
                    imageList.push({
                        path: normalizePath(file.path),
                        name: imageName,
                        source: match.source,
                        type: 'local',
                        file: file,
                    });
                }
            }
        }

        if (imageList.length === 0) {
            new Notice("没有找到任何图片！");
            return;
        } else {
            new Notice(`已找到 ${imageList.length} 张图片！`);
        }

        // todo 下载网络图片到本地后再上传，避免跨域问题

        const uploadUrlList: string[] = [];
        for (const image of imageList) {
            if (!image.file) {
                continue;
            }

            try {
                const url = await this.upload(image.file);
                uploadUrlList.push(url);
            } catch (error) {
                console.error(`Failed to upload ${image.path}:`, error);
                new Notice(`上传 ${image.name} 失败！`);
            }
        }

        if (imageList.length !== uploadUrlList.length) {
            new Notice("警告：图片列表与上传成功的文件数量不一致");
            return;
        }

        const currentFile = this.app.workspace.getActiveFile();
        if (activeFile?.path !== currentFile?.path) {
            new Notice("当前文件已变更，上传失败");
            return;
        }

        this.replaceImage(imageList, uploadUrlList);
    }


    private filterFile(fileArray: Image[]) {
        const imageList: Image[] = [];

        for (const match of fileArray) {
            if (match.path.startsWith("http")) {
                if (this.settings.workOnNetWork) {
                    if (!this.helper.hasBlackDomain(match.path, this.settings.newWorkBlackDomains)) {
                        imageList.push({
                            path: match.path,
                            name: match.name,
                            source: match.source,
                        });
                    }
                }
            } else {
                imageList.push({
                    path: match.path,
                    name: match.name,
                    source: match.source,
                });
            }
        }

        return imageList;
    }

    private async uploadByClipboard(files: FileList): Promise<string | null> {
        const file = files.item(0);
        if (!file) {
            return null;
        }

        const fileData = await file.arrayBuffer();
        return this.updateByBuffer(file.name, fileData)
    }

    private async upload(file: TFile): Promise<string> {
        const fileData = await this.app.vault.readBinary(file);
        return this.updateByBuffer(file.name, fileData);
    }

    private async updateByBuffer(filename: string, buffer: ArrayBuffer): Promise<string> {
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
        const uploadedPath = uploadPath.split('/').map(part => encodeURIComponent(part)).join('/');
        return TemplateParser.outputURL(this.settings.outputURLTemplate, {
            endpoint: this.settings.endpoint,
            bucket: this.settings.bucket,
            region: this.settings.region,
        }, uploadedPath);
    }

    /**
     * 替换上传的图片
     */
    private replaceImage(imageList: Image[], uploadUrlList: string[]) {
        const editorContent = this.helper.getValue();
        if (!editorContent) {
            new Notice("无法获取编辑器内容！");
            return;
        }

        let content: string = editorContent;
        imageList.map(item => {
            const uploadImage = uploadUrlList.shift();
            content = content.split(item.source).join(`![${item.name}](${uploadImage})`);
        });

        this.helper.setValue(content);

        // todo 删除下载的网络图片文件

        // 删除本地原文件
        if (this.settings.deleteSource) {
            imageList.map(image => {
                if (image.file && image.type === 'local') {
                    this.app.fileManager.trashFile(image.file);
                }
            });
        }
    }

    // 监听剪贴板事件，自动上传图片
    onClipboardAutoUpload(evt: ClipboardEvent, editor: Editor, markdownView: MarkdownView) {
        new Notice("触发粘贴事件1");
        const allowUpload = this.helper.getFrontmatterValue("image-auto-upload", this.settings.uploadByClipboardSwitch);
        if (!allowUpload) {
            return;
        }
        new Notice("触发粘贴事件2");

        if (!evt.clipboardData) {
            return;
        }
        new Notice("触发粘贴事件3");

        // 剪贴板内容有md格式的图片时
        if (this.settings.workOnNetWork) {
            const clipboardValue = evt.clipboardData.getData("text/plain");
            const imageList = this.helper
                .getImageLink(clipboardValue)
                .filter(image => image.path.startsWith("http"))
                .filter(image => !this.helper.hasBlackDomain(image.path, this.settings.newWorkBlackDomains));

            // 下载网络图片到本地后再上传，避免跨域问题
            if (imageList.length !== 0) {
                //   this.upload(imageList).then(res => {
                //     let uploadUrlList = res.result;
                //     this.replaceImage(imageList, uploadUrlList);
                //   });
            }
        }

        // 剪贴板中是图片时进行上传
        if (this.canUpload(evt.clipboardData)) {
            this.uploadFileAndEmbedImgurImage(
                editor,
                async (editor: Editor, pasteId: string) => {
                    if (!evt.clipboardData) {
                        return null;
                    }

                    const url = await this.uploadByClipboard(evt.clipboardData.files);
                    if (!url) {
                        this.handleFailedUpload(editor, pasteId, "文件不存在")
                    }
                    return url
                },
                evt.clipboardData
            ).catch();
            evt.preventDefault();
        }
    }


    private canUpload(clipboardData: DataTransfer) {
        const files = clipboardData.files;
        const text = clipboardData.getData("text");

        const firstFile = files.item(0);
        const hasImageFile = !!firstFile && firstFile.type.startsWith("image");
        if (hasImageFile) {
            if (!!text) {
                return this.settings.applyImage;
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    private async uploadFileAndEmbedImgurImage(editor: Editor, callback: Function, clipboardData: DataTransfer) {
        let pasteId = (Math.random() + 1).toString(36).substr(2, 5);
        this.insertTemporaryText(editor, pasteId);
        const name = clipboardData.files.item(0)?.name ?? "";

        try {
            const url = await callback(editor, pasteId);
            this.embedMarkDownImage(editor, pasteId, url, name);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.handleFailedUpload(editor, pasteId, reason);
        }
    }

    private insertTemporaryText(editor: Editor, pasteId: string) {
        const progressText = this.progressTextFor(pasteId);
        editor.replaceSelection(progressText + "\n");
    }

    private embedMarkDownImage(editor: Editor, pasteId: string, imageUrl: string, name: string = "") {
        let progressText = this.progressTextFor(pasteId);
        let markDownImage = `![${name}](${imageUrl})`;
        this.replaceFirstOccurrence(editor, progressText, markDownImage);
    }

    handleFailedUpload(editor: Editor, pasteId: string, reason: string) {
        new Notice(reason);
        console.error("Failed request: ", reason);
        let progressText = this.progressTextFor(pasteId);
        this.replaceFirstOccurrence(
            editor,
            progressText,
            "⚠️upload failed, check dev console"
        );
    }

    private progressTextFor(id: string) {
        return `![Uploading file...${id}]()`;
    }

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
