import { App, normalizePath, Notice, TFile } from "obsidian";
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

    private async upload(file: TFile): Promise<string> {
        const fileData = await this.app.vault.readBinary(file);
        const fileType = await fileTypeFromBuffer(fileData);

        // 生成唯一的 S3 Key (文件路径)
        const s3Key = await TemplateParser.uploadPath(
            this.settings.uploadPathTemplate,
            file,
            fileType?.ext ?? '',
            fileData
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
            Bucket: this.settings.bucketName,
            Key: s3Key,
            Body: new Uint8Array(fileData),
            ContentType: fileType?.mime ?? 'application/octet-stream',
            // ACL: 'public-read', // 如果你的 Bucket 策略要求显式声明公共读权限，可以取消注释
        });
        await client.send(command);

        // 构建返回的 URL
        const encodedKey = s3Key.split('/').map(part => encodeURIComponent(part)).join('/');
        if (this.settings.endpoint) {
            // 简单处理：拼接 endpoint + bucketName + key
            const baseUrl = this.settings.endpoint.endsWith('/') ? this.settings.endpoint : `${this.settings.endpoint}/`;
            return `${baseUrl}${this.settings.bucketName}/${encodedKey}`;
        } else {
            return `https://${this.settings.bucketName}.s3.${this.settings.region}.amazonaws.com/${encodedKey}`;
        }
    }

    /**
     * 替换上传的图片
     */
    replaceImage(imageList: Image[], uploadUrlList: string[]) {
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
}