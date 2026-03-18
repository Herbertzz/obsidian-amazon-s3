import { fileTypeFromBuffer } from "file-type";
import Helper from "./helper";
import { App, Modal, normalizePath, Notice, Platform, requestUrl } from "obsidian";
import { join, relative } from "path-browserify";
import { AmazonS3UploaderPluginSettings } from "./settings";
import { FileData } from "./types";
import * as mime from "mime-types";

interface DownloadResponse {
    success: boolean;
    error?: string;
    data?: ArrayBuffer;
}

interface DownloadPreCheckResult {
    canDownload: boolean;
    reason?: string;
}

interface HeadPreCheckResult {
    success: boolean;
    reason?: string;
    headers?: Record<string, string>;
}

interface DownloadResult {
    success: boolean;
    error?: string;
    filePath?: string;
    realExtension?: string; // 实际文件扩展名, 从文件内容解析得到
    mimeType?: string; // 文件 MIME 类型, 从文件内容解析得到
}

interface NodeResponse {
    statusCode?: number;
    headers: Record<string, string>;
    resume(): void;
    on(event: "data", listener: (chunk: Uint8Array) => void): NodeResponse;
    on(event: "end", listener: () => void): NodeResponse;
    on(event: string, listener: (...args: unknown[]) => void): NodeResponse;
}

interface NodeRequest {
    on(event: string, listener: (error: Error) => void): NodeRequest;
    end(): void;
}

interface NodeTransport {
    request(url: string, options: Record<string, unknown>, callback: (res: NodeResponse) => void): NodeRequest;
    get(url: string, options: Record<string, unknown>, callback: (res: NodeResponse) => void): NodeRequest;
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

function nodeRequestClient(url: string) {
    const globalRequire = (window as unknown as { require?: (id: string) => unknown }).require;
    if (!globalRequire) {
        throw new Error("无法获取 require 函数，无法进行 Node 请求");
    }

    return url.startsWith("https")
        ? (globalRequire("https") as NodeTransport)
        : (globalRequire("http") as NodeTransport);
}

export class Downloader {
    private app: App;
    private helper: Helper;
    private settings: AmazonS3UploaderPluginSettings;
    private saveDir: string;

    constructor(app: App, settings: AmazonS3UploaderPluginSettings) {
        this.app = app;
        this.settings = settings;
        this.helper = new Helper(app, settings);

        // 由于 getConfig 是未文档化的内部 API，官方的 .d.ts 类型定义里没有它.
        const internalVault = this.app.vault as unknown as { getConfig: (key: string) => string | undefined };
        this.saveDir = internalVault.getConfig("attachmentFolderPath") ?? "/";
    }

    // 下载所有网络文件
    async downloadAll() {
        const activeFile = this.app.workspace.getActiveFile();

        // 筛选出网络文件
        const networkFiles: FileData[] = []
        const links = this.helper.getCurrentLinks();
        for (const file of links) {
            if (file.type !== "network") {
                continue;
            }

            const result = await this.precheckDownload(file.path);
            if (!result.canDownload) {
                console.warn(`跳过下载: ${file.path} ${result.reason}`);
                continue;
            }

            networkFiles.push({
                path: file.path,
                name: file.alt,
                source: file.source,
            });
        }

        if (networkFiles.length === 0) {
            new Notice("没有需要下载的网络文件");
            return;
        }

        // 下载文件并保存
        new Notice(`共找到 ${networkFiles.length} 个网络文件，正在下载...`);
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

        // 更新文件链接
        const activeFolder = this.app.workspace.getActiveFile()?.parent?.path;
        let value = this.helper.getValue() ?? "";
        for (const file of downloadedFiles) {
            if (file.type === 'local' && activeFolder) {
                const relativePath = relative(normalizePath(activeFolder), normalizePath(file.path));
                const link = this.helper.makeLink(relativePath, file.name, file.realExtension);
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
        const precheckResult = await this.precheckDownload(url);
        if (!precheckResult.canDownload) {
            return { success: false, error: precheckResult.reason };
        }

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
            .replace(/[\\\\/:*?"<>|]/g, "-");

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

    // 预下载检查，验证 URL 的合法性、是否在黑名单中，以及 HEAD 预检
    async precheckDownload(url: string): Promise<DownloadPreCheckResult> {
        // 检查是否为合法 URL
        try {
            new URL(url);
        } catch {
            return { canDownload: false, reason: "无效的 URL" };
        }

        // 检查是否在黑名单域名中
        if (this.helper.hasBlackDomain(url, this.settings.newWorkBlackDomains)) {
            return { canDownload: false, reason: "该域名在黑名单中，无法下载" };
        }

        // HEAD 预检
        const headResult = await this.smartHeadPrecheck(url);
        if (headResult.success && headResult.headers) {
            return this.checkResponseHeader(headResult.headers);
        } else {
            console.warn(`HEAD 预检失败: ${url} ${headResult.reason}, 将继续尝试下载`);
        }

        return { canDownload: true };
    }

    private async smartHeadPrecheck(url: string): Promise<HeadPreCheckResult> {
        // 桌面端尝试通过 Referer 下载
        if (Platform.isDesktopApp) {
            const referer = await this.getReferer(url);
            if (referer) {
                return await this.headPrecheckByReferer(url, referer);
            }
        }

        // 使用下载代理（如果设置了的话）
        if (this.settings.downloadProxy) {
            return await this.headPrecheckByProxy(url, this.settings.downloadProxy.trim());
        }

        // 其他情况直接下载
        return await this.headPrecheckByDirectly(url);
    }

    // 通过用户设置的下载代理进行 HEAD 预检
    private async headPrecheckByProxy(url: string, proxy: string): Promise<HeadPreCheckResult> {
        url = proxy.replace(/{url}/g, url);
        return await this.headPrecheckByDirectly(url);
    }

    // 通过直接请求进行 HEAD 预检
    private async headPrecheckByDirectly(url: string): Promise<HeadPreCheckResult> {
        try {
            const response = await requestUrl({ url: url, method: "HEAD" });
            if (response.status !== 200) {
                return { success: false, reason: `请求失败，状态码: ${response.status}` };
            }

            return { success: true, headers: response.headers };
        } catch (error) {
            return { success: false, reason: error instanceof Error ? error.message : String(error) };
        }
    }

    // 通过 Referer 进行 HEAD 预检
    private async headPrecheckByReferer(url: string, referer: string): Promise<HeadPreCheckResult> {
        if (!Platform.isDesktopApp) {
            return { success: false, reason: "移动端不支持通过 Referer HEAD 请求" };
        }

        const options = {
            method: "HEAD",
            headers: {
                Accept: "*/*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                Referer: referer,
            },
            // rejectUnauthorized: false, // 调试自签名证书时解除注释
        };

        return new Promise((resolve) => {
            try {
                nodeRequestClient(url)
                    .request(url, options, (res: NodeResponse) => {
                        if (res.statusCode !== 200) {
                            resolve({ success: false, reason: `请求失败，状态码: ${res.statusCode}` });
                            return;
                        }

                        resolve({
                            success: true,
                            headers: res.headers
                        });
                    })
                    .on("error", (error: Error) => {
                        resolve({ success: false, reason: error.message });
                    })
                    .end();
            } catch (error) {
                resolve({
                    success: false,
                    reason: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    // 检查响应头, 判断是否可以下载
    private checkResponseHeader(headers: Record<string, string>): DownloadPreCheckResult {
        const contentType = headers?.["content-type"] || "";

        if (contentType.includes("text/html")) {
            return { canDownload: false, reason: "URL 指向的是 HTML 页面" };
        }

        const ext = mime.extension(contentType) || "";
        if (!ext) {
            return { canDownload: false, reason: "无法识别文件类型" };
        }

        if (!this.helper.isAllowFileByExt(ext)) {
            return { canDownload: false, reason: `文件类型 ${ext} 不允许下载` };
        }
        return { canDownload: true };
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
            const response = await requestUrl({ url: url, method: "GET" });
            if (response.status !== 200) {
                throw new Error(`下载失败，HTTP 状态码: ${response.status}`);
            }

            const result = this.checkResponseHeader(response.headers);
            if (!result.canDownload) {
                throw new Error(`响应头不符合要求: ${result.reason}`);
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
                nodeRequestClient(url)
                    .get(url, options, (res: NodeResponse) => {
                        if (res.statusCode !== 200) {
                            res.resume(); // 消费响应数据以释放内存
                            resolve({ success: false, error: `请求失败，状态码: ${res.statusCode}` });
                            return;
                        }

                        const result = this.checkResponseHeader(res.headers);
                        if (!result.canDownload) {
                            res.resume();
                            resolve({ success: false, error: `响应头不符合要求: ${result.reason}` });
                            return;
                        }

                        const chunks: Uint8Array[] = [];

                        // 拼接二进制数据块
                        res.on("data", (chunk: Uint8Array) => {
                            chunks.push(chunk);
                        });

                        // 数据接收完毕
                        res.on("end", () => {
                            // 计算所有数据块的总长度
                            let totalLength = 0;
                            for (const chunk of chunks) {
                                totalLength += chunk.length;
                            }

                            // 创建一个足够大的全新 Uint8Array
                            const finalArray = new Uint8Array(totalLength);

                            // 将所有分块按顺序填充进去
                            let offset = 0;
                            for (const chunk of chunks) {
                                finalArray.set(chunk, offset);
                                offset += chunk.length;
                            }

                            // 安全提取纯净的 ArrayBuffer
                            const arrayBuffer = finalArray.buffer.slice(
                                finalArray.byteOffset,
                                finalArray.byteOffset + finalArray.byteLength
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
        if (this.settings.refererRules.length > 0) {
            for (const rule of this.settings.refererRules) {
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
            return String(frontmatter[targetKey]);
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
            text: "输入 referer:",
        });

        contentEl.createEl("br");

        const input = contentEl.createEl("input", {
            type: "text",
            placeholder: "https://example.com/xxx/",
        });
        input.setCssProps({
            margin: "0.6em",
            marginLeft: "0",
            width: "85%",
        });

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