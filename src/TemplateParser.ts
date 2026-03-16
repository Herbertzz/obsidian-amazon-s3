import { TFile } from "obsidian";
import SparkMD5 from 'spark-md5';

export class TemplateParser {
	/**
	 * 解析上传路径模板
	 * @param template 用户在设置中填写的模板字符串
	 * @param file Obsidian 的 TFile 对象
	 * @param fileData 文件的二进制数据 (用于计算 Hash)
	 */
	static async uploadPath(template: string, file: TFile, extension: string, fileData: ArrayBuffer): Promise<string> {
		const now = new Date();

		// 1. 准备时间数据 (自动补零)
		const year = now.getFullYear().toString();
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		const day = now.getDate().toString().padStart(2, '0');
		const hour = now.getHours().toString().padStart(2, '0');
		const minute = now.getMinutes().toString().padStart(2, '0');
		const second = now.getSeconds().toString().padStart(2, '0');
		const millisecond = now.getMilliseconds().toString().padStart(3, '0');
		const timestamp = Math.floor(now.getTime() / 1000).toString();
		const timestampMS = now.getTime().toString();

		// 2. 准备文件数据
		const fullName = file.name;         // 例如: "image.png"
		const fileName = file.basename;     // 例如: "image"
		const extName = extension;           // 例如: "png"

		let result = template;

		// 3. 基础文本替换 (极速操作)
		result = result.replace(/{year}/g, year);
		result = result.replace(/{month}/g, month);
		result = result.replace(/{day}/g, day);
		result = result.replace(/{hour}/g, hour);
		result = result.replace(/{minute}/g, minute);
		result = result.replace(/{second}/g, second);
		result = result.replace(/{millisecond}/g, millisecond);
		result = result.replace(/{timestamp}/g, timestamp);
		result = result.replace(/{timestampMS}/g, timestampMS);
		result = result.replace(/{fullName}/g, fullName);
		result = result.replace(/{fileName}/g, fileName);
		result = result.replace(/{extName}/g, extName);

		// 4. 按需计算 Hash (性能优化)
		if (result.includes('{sha1}')) {
			const hash = await this.calculateHash('SHA-1', fileData);
			result = result.replace(/{sha1}/g, hash);
		}
		if (result.includes('{sha256}')) {
			const hash = await this.calculateHash('SHA-256', fileData);
			result = result.replace(/{sha256}/g, hash);
		}
		if (result.includes('{md5}')) {
			const md5Hash = await this.calculateMD5(fileData);
			result = result.replace(/{md5}/g, md5Hash);
		}

		// 5. 路径清理与安全格式化
		result = result.replace(/\/{2,}/g, '/');
		result = result.replace(/^\/+/, '');

		return result;
	}

	/**
	 * 计算 SHA-1 或 SHA-256 (Web Crypto API)
	 */
	private static async calculateHash(algorithm: 'SHA-1' | 'SHA-256', data: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest(algorithm, data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * 计算 MD5 (完美兼容全平台：Windows, Mac, iOS, Android)
	 */
	private static async calculateMD5(data: ArrayBuffer): Promise<string> {
		return SparkMD5.ArrayBuffer.hash(data);
	}
}
