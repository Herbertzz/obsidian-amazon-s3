import { MarkdownView, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, AmazonS3UploaderPluginSettings, AmazonS3UploaderSettingTab } from "settings";
import Helper from 'helper';
import { Uploader } from 'uploader';


export default class AmazonS3UploaderPlugin extends Plugin {
	settings: AmazonS3UploaderPluginSettings;
	uploader: Uploader;

	async onload() {
		// 加载本地持久化的配置数据
		await this.loadSettings();
		// 将配置面板注册到 Obsidian 的设置弹窗中
		this.addSettingTab(new AmazonS3UploaderSettingTab(this.app, this));
		// 实例化上传器
		this.uploader = new Uploader(this.app, this.settings);


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

		// // This adds an editor command that can perform some operation on the current editor instance
		// this.addCommand({
		// 	id: 'replace-selected',
		// 	name: 'Replace selected content',
		// 	editorCallback: (editor: Editor, view: MarkdownView) => {
		// 		editor.replaceSelection('Sample editor command');
		// 	}
		// });
		this.setupPasteHandler();
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AmazonS3UploaderPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	setupPasteHandler() {
		this.registerEvent(
			this.app.workspace.on("editor-paste", this.uploader.onClipboardAutoUpload.bind(this.uploader))
		);
	}
}
