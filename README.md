# Amazon S3 Uploader for Obsidian

将 Obsidian 中的本地图片/附件或网络资源上传到 S3（或兼容 S3 的对象存储），并自动替换为远程链接。

## 功能特性

- 批量上传当前笔记中的本地附件与图片。
- 批量下载当前笔记中的网络图片/文件并替换为本地链接。
- 支持剪贴板自动上传（粘贴时自动上传）。
- 支持拖拽自动上传（按住 `Ctrl/Cmd` 可走 Obsidian 默认行为）。
- 文件右键菜单支持“上传到 S3”，并自动回填所有反向引用。
- 支持下载代理与 Referer 规则（处理防盗链场景）。
- 支持上传路径模板、输出 URL 模板。
- 支持图片/文件扩展名白名单控制。

## 安装

### 手动安装

1. 在你的 Vault 中创建目录：`.obsidian/plugins/amazon-s3-uploader/`
2. 将 `main.js`、`manifest.json`、`styles.css` 复制到该目录
3. 重启 Obsidian（或刷新社区插件）
4. 在 **Settings → Community plugins** 中启用插件

## 快速开始

1. 打开插件设置，填写 S3 参数：
   - `Access key ID`
   - `Secret access key`
   - `Region`
   - `Bucket`
   - `Endpoint`（使用兼容 S3 服务时通常必填）
2. 设置上传路径模板（默认：`{year}/{month}/{fullName}`）
3. 设置输出 URL 模板（默认：`{endpoint}/{bucket}/{path}`）
4. 在命令面板执行：
   - `上传所有图片`
   - `下载所有图片`

## 命令

- `上传所有图片`：扫描当前笔记链接并上传可处理文件。
- `下载所有图片`：下载当前笔记中的网络资源并替换为本地链接。

## 右键菜单

在文件资源管理器中，对允许类型的文件右键可见：

- `上传到 S3`

执行后会自动替换所有引用该文件的 Markdown 链接（含普通链接和嵌入链接）。

## 支持匹配的链接格式

### Markdown 格式

- `![alt](<./path/image.png>)`
- `![alt](./path/image.png)`
- `![alt](image.png "title")`
- `![alt](https://example.com/file)`
- `[text](./path/file.pdf)`

### Wiki 格式

- `![[image.png]]`
- `![[image.png|alias]]`

## 设置项说明

### 基础设置

- `自定义节点(endpoint)`：兼容 S3 服务通常需要填写。
- `访问密钥 ID / 访问密钥`：S3 鉴权凭证。
- `地区(region)`：例如 `us-east-1`。
- `桶名(bucket)`：目标 Bucket。
- `强制路径样式(forcePathStyle)`：部分兼容 S3 服务需要开启。

### 路径与 URL 模板

- `上传路径模板(uploadPathTemplate)`：决定对象 Key。
- `输出 URL 模板(outputURLTemplate)`：决定回填到文档中的 URL。

支持占位符：

- 时间：`{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}` `{millisecond}`
- 时间戳：`{timestamp}` `{timestampMS}`
- 文件名：`{fullName}` `{fileName}` `{extName}`
- 哈希：`{md5}` `{sha1}` `{sha256}`
- URL：`{endpoint}` `{bucket}` `{path}`

### 自动上传与网络资源

- `应用网络图片(workOnNetWork)`：上传/粘贴时处理网络资源。
- `网络图片域名黑名单(newWorkBlackDomains)`：逗号分隔。
- `上传文件后移除源文件(deleteSource)`：上传后删除本地源文件。
- `剪切板自动上传(uploadByClipboardSwitch)`
- `当剪切板中同时拥有文本和图片时，是否上传图片(applyImage)`
- `拖拽自动上传(uploadByDropSwitch)`

### 下载相关

- `文件下载代理(downloadProxy)`：使用 `{url}` 占位符拼接目标地址。
- `Referer 规则(refererRules)`：每行一条，格式：`domain,referer`。

### 类型白名单

- `允许上传下载的图片扩展名(allowedImageTypes)`
- `允许上传下载的文件扩展名(allowedFileTypes)`

只有白名单中的类型会被上传/下载处理。

## Frontmatter 控制

可在笔记 frontmatter 中通过 `image-auto-upload` 覆盖自动上传开关：

```yaml
image-auto-upload: true
```

下载防盗链场景下，还会优先从当前笔记 frontmatter 读取 Referer（可用键名）：

- `referer`
- `referrer`
- `source`
- `origin`

## 开发

```bash
npm install
npm run dev
```

构建生产包：

```bash
npm run build
```

代码检查：

```bash
npm run lint
```

## 版本发布

1. 更新 `manifest.json` 中 `version`
2. 更新 `versions.json`（版本到最小 Obsidian 版本映射）
3. 发布同名 GitHub Release（tag 不加 `v`）
4. 上传 `main.js`、`manifest.json`、`styles.css`

## 注意事项

- 请确保 Bucket 具备正确的写入权限。
- 若希望链接可直接访问，请配置对象读取权限或 CDN 策略。
- 建议先在测试 Vault 验证模板与权限配置。

## 参考项目

本项目在以下方向上参考了社区实现思路，并结合当前插件需求进行了整合与扩展：

- 防盗链下载（Referer 能力）参考：
   - https://github.com/lovelyjuice/hotlink-protection-image-downloader
- Obsidian 图片自动上传交互与工作流参考：
   - https://github.com/renmu123/obsidian-image-auto-upload-plugin
