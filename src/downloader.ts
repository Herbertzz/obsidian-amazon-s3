import { fileTypeFromBuffer } from "file-type";
import Helper from "helper";
import { App, Modal, normalizePath, Notice, Platform } from "obsidian";
import { join, relative } from "path-browserify";
import { FileData } from "types";

interface DownloadResponse {
    success: boolean;
    error?: string;
    data?: ArrayBuffer;
}

export class Downloader {
    private app: App;
    private helper: Helper;

    constructor(app: App) {
        this.app = app;
        this.helper = new Helper(app);
    }

    // 下载所有网络图片
    async downloadAll() {
        const activeFile = this.app.workspace.getActiveFile();

        // 确保下载目录存在
        // @ts-ignore 由于 getConfig 是未文档化的内部 API，官方的 .d.ts 类型定义里没有它，所以这里使用 @ts-ignore 来绕过类型检查
        const saveDir = this.app.vault.getConfig("attachmentFolderPath");
        if (!(await this.app.vault.adapter.exists(saveDir))) {
            await this.app.vault.adapter.mkdir(saveDir);
        }

        // 筛选出网络文件
        const networkFiles: FileData[] = []
        const files = this.helper.getAllFiles();
        // console.log("所有文件：", files);
        for (const file of files) {
            if (!file.path.startsWith("http")) {
                continue;
            }

            networkFiles.push({
                path: file.path,
                name: file.name,
                source: file.source,
            });
        }
        // console.log("网络文件：", networkFiles);

        if (networkFiles.length === 0) {
            new Notice("没有需要下载的网络文件");
            return;
        }

        // 获取 Referer
        const referer = await this.getReferer();

        // 下载文件并保存
        new Notice(`共找到 ${networkFiles.length} 个网络图片，正在下载...`);
        const downloadedFiles: FileData[] = [];
        let successCount = 0;
        for (const file of networkFiles) {
            const response = await this.downloadByReferer(file.path, referer);
            if (!response.success) {
                console.error(`下载 ${file.path} 失败: ${response.error}`);
                new Notice(`下载失败: [${successCount + 1}/${networkFiles.length}] ${response.error}`);
                continue;
            }
            if (!response.data) {
                new Notice(`下载失败: [${successCount + 1}/${networkFiles.length}] 没有数据`);
                continue;
            }

            // 从 URL 中提取文件名，处理 URL 编码，并替换掉不合法的文件名字符
            const urlObj = new URL(file.path);
            const pathname = decodeURI(urlObj.pathname);
            const name = pathname.substring(pathname.lastIndexOf("/") + 1)
                .replace(/[\\\\/:*?\"<>|]/g, "-");

            const fileType = await fileTypeFromBuffer(response.data);
            const savePath = normalizePath(join(saveDir, name));
            await this.app.vault.adapter.writeBinary(savePath, response.data);

            downloadedFiles.push({
                path: savePath,
                name: file.name,
                source: file.source,
                type: 'local',
                realExtension: fileType?.ext,
                mimeType: fileType?.mime,
            });

            new Notice(`下载成功: [${successCount + 1}/${networkFiles.length}]`);
            successCount++;
        }
        // console.log("下载完成的文件：", downloadedFiles);


        // 更新文件链接
        const activeFolder = this.app.workspace.getActiveFile()?.parent?.path;
        let value = this.helper.getValue() ?? "";
        for (const file of downloadedFiles) {
            if (file.type === 'local' && activeFolder) {
                const relativePath = relative(normalizePath(activeFolder), normalizePath(file.path));
                const link = await this.helper.makeLink(relativePath, file.name, file.realExtension);
                value = value.replace(file.source, link);
            }
        }
        const currentFile = this.app.workspace.getActiveFile();
        if (activeFile?.path !== currentFile?.path) {
            new Notice("当前文件已变更，下载失败");
            return;
        }
        this.helper.setValue(value);

        new Notice("下载完成");
    }

    private async downloadByReferer(url: string, referer: string): Promise<DownloadResponse> {
        if (!Platform.isDesktopApp) {
            return { success: false, error: "移动端不支持通过 Referer 下载" };
        }

        const options = {
            headers: {
                Accept: "*/*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                Referer: referer,
            },
            // rejectUnauthorized: false, // 调试自签名证书时解除注释
        };

        return new Promise((resolve) => {
            try {
                const client = url.startsWith("https") ? require("https") : require("http");
                client
                    .get(url, options, (res: any) => {
                        if (res.statusCode !== 200) {
                            res.resume(); // 消费响应数据以释放内存
                            resolve({ success: false, error: `请求失败，状态码: ${res.statusCode}` });
                            return;
                        }

                        // 2. 拼接二进制数据块
                        const chunks: Buffer[] = [];
                        res.on("data", (chunk: Buffer) => {
                            chunks.push(chunk);
                        });

                        // 3. 数据接收完毕
                        res.on("end", () => {
                            const finalBuffer = Buffer.concat(chunks);
                            const arrayBuffer = finalBuffer.buffer.slice(
                                finalBuffer.byteOffset,
                                finalBuffer.byteOffset + finalBuffer.byteLength
                            );
                            resolve({ success: true, data: arrayBuffer });
                        });
                    })
                    .on("error", (error: Error) => {
                        resolve({ success: false, error: error.message });
                    });
            } catch (error) {
                resolve({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    private async getReferer(): Promise<string> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return "";
        }

        // 优先从当前文件的 frontmatter 中获取 referer
        const frontmatter = this.helper.getFrontmatter();
        const targetKey = ["referer", "referrer", "source", "origin"].find(key => typeof frontmatter[key] === "string" && /^https?:\/\//i.test(frontmatter[key]))
        if (targetKey) {
            const referfer = frontmatter[targetKey];
            new Notice(`找到目标 Referer: ${referfer}`);
            return referfer;
        }

        // 如果 frontmatter 中没有，则弹窗让用户输入 referer
        return new Promise((resolve) => {
            const modal = new RefererModal(this.app, (referfer) => {
                resolve(referfer.trim());
            });
            modal.open();
        });
    }

}

// 输入 Referer 的 Modal
class RefererModal extends Modal {
    private callback: (referer: string) => void;

    constructor(app: App, callback: (referer: string) => void) {
        super(app);
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty(); // 清空内容
        contentEl.createEl("label", {
            text: "输入 Referer(URL):",
        });

        contentEl.createEl("br");

        const input = contentEl.createEl("input", {
            type: "text",
            placeholder: "https://example.com/xxx/",
        });
        input.style.margin = "0.6em";
        input.style.marginLeft = "0";
        input.style.width = "85%";

        const confirmButton = contentEl.createEl("button", { text: "确定" });
        confirmButton.addEventListener("click", () => {
            const referer = input.value;
            if (!referer) {
                new Notice("Referer 为空！");
            }
            this.callback(referer);
            this.close();
        });

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                confirmButton.click();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}