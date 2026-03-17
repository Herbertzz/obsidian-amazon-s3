import { fileTypeFromBuffer } from "file-type";
import Helper from "helper";
import { App, Modal, normalizePath, Notice, Platform, requestUrl } from "obsidian";
import { join, relative } from "path-browserify";
import { AmazonS3UploaderPluginSettings } from "settings";
import { FileData } from "types";

interface DownloadResponse {
    success: boolean;
    error?: string;
    data?: ArrayBuffer;
}

interface DownloadResult {
    success: boolean;
    error?: string;
    filePath?: string;
    realExtension?: string; // 实际文件扩展名, 从文件内容解析得到
    mimeType?: string; // 文件 MIME 类型, 从文件内容解析得到
}

// 定义防盗链匹配规则字典
const REFERER_RULES = [
    { domain: "sspai.com", referer: "https://sspai.com" },
    { domain: "zhimg.com", referer: "https://www.zhihu.com" },
    { domain: "zhihu.com", referer: "https://www.zhihu.com" },
    { domain: "hdslb.com", referer: "https://www.bilibili.com" },
    { domain: "sinaimg.cn", referer: "https://weibo.com" },
    { domain: "doubanio.com", referer: "https://www.douban.com" },
    { domain: "csdnimg.cn", referer: "https://blog.csdn.net" },
    { domain: "juejin.cn", referer: "https://juejin.cn" },
    { domain: "byteimg.com", referer: "https://juejin.cn" },
    { domain: "mmbiz.qpic.cn", referer: "https://mp.weixin.qq.com/" },
    { domain: "qpic.cn", referer: "https://mp.weixin.qq.com/" }
];

export class Downloader {
    private app: App;
    private helper: Helper;
    private settings: AmazonS3UploaderPluginSettings;
    private saveDir: string;

    constructor(app: App, settings: AmazonS3UploaderPluginSettings) {
        this.app = app;
        this.settings = settings;
        this.helper = new Helper(app, settings);

        // 获取下载存储目录路径
        // @ts-ignore 由于 getConfig 是未文档化的内部 API，官方的 .d.ts 类型定义里没有它，所以这里使用 @ts-ignore 来绕过类型检查
        this.saveDir = this.app.vault.getConfig("attachmentFolderPath") ?? "/";
    }

    // 下载所有网络图片
    async downloadAll() {
        const activeFile = this.app.workspace.getActiveFile();

        // 筛选出网络文件
        const networkFiles: FileData[] = []
        const files = this.helper.getAllFiles();
        // console.log("所有文件：", files);
        for (const file of files) {
            if (file.type !== "network") {
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

        // 下载文件并保存
        new Notice(`共找到 ${networkFiles.length} 个网络图片，正在下载...`);
        const downloadedFiles: FileData[] = [];
        for (const file of networkFiles) {
            const result = await this.download(file.path);
            if (!result.success) {
                new Notice(`下载失败: ${file.path} ${result.error}`);
                continue;
            }
            if (!result.filePath) {
                new Notice(`下载失败: ${file.path} 没有文件路径`);
                continue;
            }

            downloadedFiles.push({
                path: result.filePath,
                name: file.name,
                source: file.source,
                type: 'local',
                realExtension: result.realExtension,
                mimeType: result.mimeType,
            });
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

    async download(url: string): Promise<DownloadResult> {
        const response = await this.smartDownload(url);
        if (!response.success) {
            console.error(`下载失败: ${url} ${response.error}`);
            return { success: false, error: response.error };
        }
        if (!response.data) {
            console.error(`下载失败: ${url} 没有数据`);
            return { success: false, error: "没有数据" };
        }

        // 从 URL 中提取文件名，处理 URL 编码，并替换掉不合法的文件名字符
        const urlObj = new URL(url);
        const pathname = decodeURI(urlObj.pathname);
        const name = pathname.substring(pathname.lastIndexOf("/") + 1)
            .replace(/[\\\\/:*?\"<>|]/g, "-");

        const savePath = normalizePath(join(this.saveDir, name));
        await this.app.vault.adapter.writeBinary(savePath, response.data);

        const fileType = await fileTypeFromBuffer(response.data);
        return {
            success: true,
            filePath: savePath,
            realExtension: fileType?.ext,
            mimeType: fileType?.mime,
        };
    }

    private async smartDownload(url: string): Promise<DownloadResponse> {
        // 桌面端尝试通过 Referer 下载
        if (Platform.isDesktopApp) {
            const referer = await this.getReferer(url);
            if (referer) {
                return await this.downloadByReferer(url, referer);
            }
        }

        // 使用下载代理（如果设置了的话）
        if (this.settings.downloadProxy) {
            return await this.downloadByProxy(url, this.settings.downloadProxy.trim());
        }

        // 其他情况直接下载
        return await this.downloadDirectly(url);
    }

    // 通过用户设置的下载代理下载
    private async downloadByProxy(url: string, proxy: string): Promise<DownloadResponse> {
        url = proxy.replace(/{url}/g, url);
        return await this.downloadDirectly(url);
    }

    // 直接下载
    private async downloadDirectly(url: string): Promise<DownloadResponse> {
        try {
            const response = await requestUrl({url: url, method: "GET"});
            if (response.status !== 200) {
                throw new Error(`下载失败，HTTP 状态码: ${response.status}`);
            }

            return { success: true, data: response.arrayBuffer };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
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

    private async getReferer(url: string): Promise<string> {
        const hostname = new URL(url).hostname.toLowerCase();

        // 匹配用户自定义的 Referer 规则
        if (this.settings.refererRules) {
            const customRules = this.settings.refererRules
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith("#"))
                .map(line => line.replace("，", ",").split(",").map(part => part.trim()))
                .filter((parts): parts is [string, string] => parts.length === 2 && !!parts[0] && !!parts[1])
                .map(parts => ({ domain: parts[0], referer: parts[1] }));

            for (const rule of customRules) {
                if (hostname.endsWith(rule.domain) || hostname.includes(rule.domain)) {
                    return rule.referer;
                }
            }
        }

        // 根据 URL 匹配预设的防盗链规则
        for (const rule of REFERER_RULES) {
            if (hostname.endsWith(rule.domain) || hostname.includes(rule.domain)) {
                return rule.referer;
            }
        }

        // 尝试从当前文件的 frontmatter 中获取 referer
        const frontmatter = this.helper.getFrontmatter();
        const targetKey = ["referer", "referrer", "source", "origin"].find(key => typeof frontmatter[key] === "string" && /^https?:\/\//i.test(frontmatter[key]))
        if (targetKey) {
            const referfer = frontmatter[targetKey];
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