import { MarkdownView, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, AmazonS3UploaderPluginSettings, AmazonS3UploaderSettingTab } from "settings";
import { Uploader } from 'uploader';
import { Downloader } from 'downloader';


export default class AmazonS3UploaderPlugin extends Plugin {
	settings: AmazonS3UploaderPluginSettings;
	uploader: Uploader;
	downloader: Downloader;

	async onload() {
		// 加载本地持久化的配置数据
		await this.loadSettings();
		// 将配置面板注册到 Obsidian 的设置弹窗中
		this.addSettingTab(new AmazonS3UploaderSettingTab(this.app, this));
		// 实例化上传器
		this.uploader = new Uploader(this.app, this.settings);
		// 实例化下载器
		this.downloader = new Downloader(this.app, this.settings);

		this.addCommand({
			id: 'upload-all-images',
			name: '上传所有图片',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					if (!checking) {
						this.uploader.uploadAll();
					}
					return true;
				}

				return false;
			}
		});

		this.addCommand({
			id: 'download-all-images',
			name: '下载所有图片',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					if (!checking) {
						this.downloader.downloadAll();
					}
					return true;
				}

				return false;
			}
		});

		this.setupEventHandler();
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AmazonS3UploaderPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	setupEventHandler() {
		this.registerEvent(
			this.app.workspace.on("editor-paste", this.uploader.onClipboardAutoUpload.bind(this.uploader))
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.uploader.onDropAutoUpload.bind(this.uploader))
		);
	}
}
