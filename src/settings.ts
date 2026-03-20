import { App, PluginSettingTab, Setting } from "obsidian";
import AmazonS3UploaderPlugin from "./main";
import { RefererRule } from "./types";

export interface AmazonS3UploaderPluginSettings {
	// 凭证 ID
	accessKeyId: string;
	// 凭证密钥
	secretAccessKey: string;
	// 自定义终端节点
	endpoint: string;
	// S3 桶名称
	bucket: string;
	// 区域
	region: string;
	// 上传路径模板, 支持以下占位符
	// {year}	年
	// {month}	月
	// {day}	日
	// {hour}	时
	// {minute}	分
	// {second}	秒
	// {millisecond}	毫秒
	// {timestamp}	Unix 时间戳 (秒)
	// {timestampMS}	Unix 时间戳 (毫秒)
	// {fullName}	完整文件名 (含扩展名)
	// {fileName}	文件名 (不含扩展名)
	// {extName}	扩展名 (不含 .)
	// {md5}	文件 MD5
	// {sha1}	文件 SHA1
	// {sha256}	文件 SHA256
	uploadPathTemplate: string;
	// 自定义输出 URL 模板，支持以下占位符
	// {endpoint} 节点
	// {bucket} 桶名
	// {path} 上传文件路径
	outputURLTemplate: string;
	// 强制路径样式
	forcePathStyle: boolean;

	// 是否应用网络文件
	workOnNetWork: boolean
	// 网络文件域名黑名单，逗号分隔
	newWorkBlackDomains: string[];
	// 是否删除原文件
	deleteSource: boolean;
	// 是否启用剪贴板自动上传
	uploadByClipboardSwitch: boolean;
	// 当剪切板中同时拥有文本和文件时, 是否上传文件
	applyFile: boolean;
	// 是否启用拖拽自动上传
	uploadByDropSwitch: boolean;
	// 文件下载代理
	downloadProxy: string;
	// referer 规则
	refererRules: RefererRule[];
	// 允许上传下载的图片类型列表，逗号分隔
	allowedImageTypes: string[];
	// 允许上传下载的文件类型列表，逗号分隔
	allowedFileTypes: string[];
}

export const DEFAULT_SETTINGS: AmazonS3UploaderPluginSettings = {
	accessKeyId: '',
	secretAccessKey: '',
	endpoint: '',
	bucket: 'obsidian',
	region: 'us-east-1',
	uploadPathTemplate: '{year}/{month}/{fullName}',
	outputURLTemplate: '{endpoint}/{bucket}/{path}',
	forcePathStyle: false,
	workOnNetWork: false,
	newWorkBlackDomains: [],
	deleteSource: false,
	uploadByClipboardSwitch: false,
	applyFile: true,
	uploadByDropSwitch: false,
	downloadProxy: '',
	refererRules: [],
	allowedImageTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tiff', 'bmp', 'ico', 'avif', 'heic', 'heif'],
	allowedFileTypes: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz', 'tar'],
}

export class AmazonS3UploaderSettingTab extends PluginSettingTab {
	plugin: AmazonS3UploaderPlugin;

	constructor(app: App, plugin: AmazonS3UploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('S3 设置')
			.setHeading();

		new Setting(containerEl)
			.setName('自定义节点')
			.addText(text => text
				.setPlaceholder('使用 amazon S3 时可不填，使用第三方兼容 S3 的服务时必填')
				.setValue(this.plugin.settings.endpoint)
				.onChange(async (value) => {
					this.plugin.settings.endpoint = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('访问密钥 ID')
			.addText(text => text
				.setPlaceholder('Access key ID')
				.setValue(this.plugin.settings.accessKeyId)
				.onChange(async (value) => {
					this.plugin.settings.accessKeyId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('访问密钥')
			.addText(text => {
				text.setPlaceholder('Secret access key')
					.setValue(this.plugin.settings.secretAccessKey)
					.onChange(async (value) => {
						this.plugin.settings.secretAccessKey = value.trim();
						await this.plugin.saveSettings();
					});

				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('地区')
			.addText(text => text
				.setPlaceholder('没有指定自定义节点时必填，默认为 us-east-1')
				.setValue(this.plugin.settings.region)
				.onChange(async (value) => {
					this.plugin.settings.region = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('桶名')
			.addText(text => text
				.setPlaceholder('Bucket name')
				.setValue(this.plugin.settings.bucket)
				.onChange(async (value) => {
					this.plugin.settings.bucket = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('上传路径模板')
			.setDesc('上传路径模板, 支持这些占位符: {year}, {month}, {day}, {hour}, {minute}, {second}, {millisecond}, {timestamp}, {timestampMS}, {fullName}, {fileName}, {extName}, {md5}, {sha1}, {sha256}')
			.addText(text => text
				.setPlaceholder('默认为 {year}/{month}/{fullName}')
				.setValue(this.plugin.settings.uploadPathTemplate)
				.onChange(async (value) => {
					this.plugin.settings.uploadPathTemplate = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('输出 URL 模板')
			.setDesc('输出 URL 模板, 支持这些占位符: {endpoint}, {bucket}, {path}')
			.addText(text => text
				.setPlaceholder('默认为 {endpoint}/{bucket}/{path}')
				.setValue(this.plugin.settings.outputURLTemplate)
				.onChange(async (value) => {
					this.plugin.settings.outputURLTemplate = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('强制路径样式')
			.setDesc('很多第三方兼容 S3 的服务需要强制路径样式')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.forcePathStyle)
					.onChange(async (value) => {
						this.plugin.settings.forcePathStyle = value;
						this.display();
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName('高级设置')
			.setHeading();

		new Setting(containerEl)
			.setName("允许上传下载的图片扩展名")
			.setDesc("允许上传下载的图片扩展名，用英文逗号分割。不在此列表中的图片将不会被上传或下载")
			.addTextArea(textArea =>
				textArea
					.setValue(this.plugin.settings.allowedImageTypes.join(','))
					.onChange(async value => {
						this.plugin.settings.allowedImageTypes = value
							.split(',')
							.map(v => v.trim())
							.filter(v => v !== '');
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("允许上传下载的文件扩展名")
			.setDesc("允许上传下载的文件扩展名，用英文逗号分割。不在此列表中的文件将不会被上传或下载")
			.addTextArea(textArea =>
				textArea
					.setValue(this.plugin.settings.allowedFileTypes.join(','))
					.onChange(async value => {
						this.plugin.settings.allowedFileTypes = value
							.split(',')
							.map(v => v.trim())
							.filter(v => v !== '');
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("应用网络文件")
			.setDesc("当你上传所有文件时，也会上传网络文件。以及当你进行粘贴时，剪切板中的标准 md 网络文件会被上传")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.workOnNetWork)
					.onChange(async value => {
						this.plugin.settings.workOnNetWork = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("网络文件域名黑名单")
			.setDesc("黑名单域名中的文件将不会被上传，用英文逗号分割")
			.addTextArea(textArea =>
				textArea
					.setValue(this.plugin.settings.newWorkBlackDomains.join(','))
					.onChange(async value => {
						this.plugin.settings.newWorkBlackDomains = value
							.split(',')
							.map(v => v.trim())
							.filter(v => v !== '');
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("上传文件后移除源文件")
			.setDesc("上传文件后移除在 Obsidian 附件文件夹中的文件")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.deleteSource)
					.onChange(async value => {
						this.plugin.settings.deleteSource = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("剪切板自动上传")
			.setDesc("启用该选项后，粘贴图片时会自动上传")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.uploadByClipboardSwitch)
					.onChange(async value => {
						this.plugin.settings.uploadByClipboardSwitch = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("当剪切板中同时拥有文本和文件时, 是否上传文件")
			.setDesc("当你复制时，某些应用会在剪切板中同时写入文本和文件数据，确认是否上传。")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.applyFile)
					.onChange(async value => {
						this.plugin.settings.applyFile = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("拖拽自动上传")
			.setDesc("启用该选项后，拖拽文件时会自动上传。如果按住 ctrl/cmd，将放行并执行 Obsidian 默认行为（保存到本地）。")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.uploadByDropSwitch)
					.onChange(async value => {
						this.plugin.settings.uploadByDropSwitch = value;
						this.display();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("文件下载代理")
			.setDesc("设置文件下载的代理地址，为空表示不使用代理。使用 {url} 占位符代表下载链接，例如：http://localhost:7890/proxy?url={url}")
			.addText(text => text
				.setPlaceholder("请输入代理地址")
				.setValue(this.plugin.settings.downloadProxy)
				.onChange(async (value) => {
					this.plugin.settings.downloadProxy = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Referer 规则")
			.setDesc("设置 Referer 规则，用于防盗链下载。一行一个规则, 格式为 {domain},{referer}，例如：example.com,https://example.com\nexample.org,https://example.org")
			.addTextArea(textArea =>
				textArea
					.setValue(
						this.plugin.settings.refererRules
							.map(rule => `${rule.domain},${rule.referer}`)
							.join("\n")
					)
					.onChange(async value => {
						this.plugin.settings.refererRules = value
							.split(/\r?\n/)
							.map(line => line.trim())
							.filter(line => line.length > 0 && !line.startsWith("#"))
							.map(line => line.replace("，", ",").split(",").map(part => part.trim()))
							.filter((parts): parts is [string, string] => parts.length === 2 && !!parts[0] && !!parts[1])
							.map(parts => ({ domain: parts[0], referer: parts[1] }));
						await this.plugin.saveSettings();
					})
			);
	}
}
