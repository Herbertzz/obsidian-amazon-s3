import { App, PluginSettingTab, Setting } from "obsidian";
import AmazonS3UploaderPlugin from "./main";

export interface AmazonS3UploaderPluginSettings {
	// 凭证 ID
	accessKeyId: string;
	// 凭证密钥
	secretAccessKey: string;
	// 自定义终端节点
	endpoint: string;
	// S3 桶名称
	bucketName: string;
	// 区域
	region: string;
	// 上传路径模板支持以下占位符
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
	// {md5}	图片 MD5
	// {sha1}	图片 SHA1
	// {sha256}	图片 SHA256
	uploadPathTemplate: string;
	// 强制路径样式
	forcePathStyle: boolean;

	// 是否应用网络图片
	workOnNetWork: boolean
	// 网络图片域名黑名单，逗号分隔
	newWorkBlackDomains: string;
	// 是否删除原文件	
	deleteSource: boolean;
}

export const DEFAULT_SETTINGS: AmazonS3UploaderPluginSettings = {
	accessKeyId: '',
	secretAccessKey: '',
	endpoint: '',
	bucketName: 'obsidian',
	region: 'us-east-1',
	uploadPathTemplate: '{year}/{month}/{fullName}',
	forcePathStyle: false,
	workOnNetWork: false,
	newWorkBlackDomains: '',
	deleteSource: false,
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
			.setName('S3 自动上传与清理 - 设置')
			.setHeading();

		new Setting(containerEl)
			.setName('自定义节点')
			.addText(text => text
				.setPlaceholder('Endpoint')
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
				.setPlaceholder('Region')
				.setValue(this.plugin.settings.region)
				.onChange(async (value) => {
					this.plugin.settings.region = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('桶名')
			.addText(text => text
				.setPlaceholder('Bucket name')
				.setValue(this.plugin.settings.bucketName)
				.onChange(async (value) => {
					this.plugin.settings.bucketName = value.trim();
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
			.setName('高级设置')
			.setHeading();

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
			.setName("应用网络图片")
			.setDesc("当你上传所有图片时，也会上传网络图片。以及当你进行黏贴时，剪切板中的标准 md 图片会被上传")
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
			.setName("网络图片域名黑名单")
			.setDesc("黑名单域名中的图片将不会被上传，用英文逗号分割")
			.addTextArea(textArea =>
				textArea
					.setValue(this.plugin.settings.newWorkBlackDomains)
					.onChange(async value => {
						this.plugin.settings.newWorkBlackDomains = value;
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
	}
}
