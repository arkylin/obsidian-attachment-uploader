import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, moment } from 'obsidian';
import { S3 } from 'aws-sdk';

interface LocaleStrings {
	[key: string]: any;
}

class I18n {
	private locale: LocaleStrings;
	constructor(locale: LocaleStrings) {
		this.locale = locale;
	}

	t(key: string, params?: { [key: string]: string | number }): string {
		const keys = key.split('.');
		let value: any = this.locale;
		
		for (const k of keys) {
			if (value && typeof value === 'object' && k in value) {
				value = value[k];
			} else {
				return key;
			}
		}
		
		if (typeof value !== 'string') {
			return key;
		}
		
		if (params) {
			return value.replace(/{{(\w+)}}/g, (match, paramKey) => {
				return params[paramKey]?.toString() || match;
			});
		}
		
		return value;
	}
}

interface S3UploaderSettings {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	bucketName: string;
	baseUrl: string;
	folderPath: string;
	allowedExtensions: string;
	organizeByDate: boolean;
	dateFormat: string;
	usePathStyle: boolean;
	retryCount: number;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKeyId: '',
	secretAccessKey: '',
	region: 'us-east-1',
	bucketName: '',
	baseUrl: '',
	folderPath: 'obsidian-attachments',
	allowedExtensions: 'png,jpg,jpeg,gif,bmp,svg,webp,pdf,doc,docx,ppt,pptx,xls,xlsx,mp4,mp3,wav,avi,mov',
	organizeByDate: false,
	dateFormat: 'YYYY/MM/DD',
	usePathStyle: false,
	retryCount: 3
}

export default class S3AttachmentUploader extends Plugin {
	settings: S3UploaderSettings;
	s3: S3;
	i18n: I18n;

	async onload() {
		await this.loadSettings();
		await this.loadI18n();
		this.initializeS3();

		this.addCommand({
			id: 'upload-all-attachments',
			name: this.i18n.t('commands.uploadAllAttachments'),
			callback: () => this.uploadAllAttachments()
		});

		this.addCommand({
			id: 'upload-current-file-attachments',
			name: this.i18n.t('commands.uploadCurrentFileAttachments'),
			callback: () => this.uploadCurrentFileAttachments()
		});

		this.addRibbonIcon('cloud-upload', this.i18n.t('ribbon.uploadAttachments'), () => {
			this.uploadCurrentFileAttachments();
		});

		this.addSettingTab(new S3UploaderSettingTab(this.app, this));
	}

	async loadI18n() {
		const locale = moment.locale();
		const supportedLocales = ['en', 'zh-cn'];
		let currentLocale = 'en';
		
		if (locale.startsWith('zh')) {
			currentLocale = 'zh-cn';
		}
		
		try {
			const localeData = await this.app.vault.adapter.read(
				`${this.manifest.dir}/locale/${currentLocale}.json`
			);
			this.i18n = new I18n(JSON.parse(localeData));
		} catch (error) {
			console.warn('Failed to load locale, falling back to English:', error);
			try {
				const localeData = await this.app.vault.adapter.read(
					`${this.manifest.dir}/locale/en.json`
				);
				this.i18n = new I18n(JSON.parse(localeData));
			} catch (fallbackError) {
				console.error('Failed to load fallback locale:', fallbackError);
				this.i18n = new I18n({});
			}
		}
	}

	initializeS3() {
		if (this.settings.accessKeyId && this.settings.secretAccessKey) {
			const s3Config: any = {
				accessKeyId: this.settings.accessKeyId,
				secretAccessKey: this.settings.secretAccessKey,
				region: this.settings.region,
				s3ForcePathStyle: this.settings.usePathStyle
			};
			
			// 如果设置了自定义 baseUrl，则使用它作为 endpoint
			if (this.settings.baseUrl) {
				s3Config.endpoint = this.settings.baseUrl;
			}
			
			this.s3 = new S3(s3Config);
		}
	}

	async uploadAllAttachments() {
		if (!this.s3) {
			new Notice(this.i18n.t('notices.pleaseConfigureS3'));
			return;
		}

		const attachments = this.app.vault.getFiles().filter(file => 
			this.isAttachment(file)
		);

		if (attachments.length === 0) {
			new Notice(this.i18n.t('notices.noAttachmentsFound'));
			return;
		}

		new Notice(this.i18n.t('notices.startingUpload', { count: attachments.length.toString() }));
		
		for (const attachment of attachments) {
			await this.uploadAndReplaceAttachment(attachment);
		}

		new Notice(this.i18n.t('notices.allAttachmentsUploaded'));
	}

	async uploadCurrentFileAttachments() {
		if (!this.s3) {
			new Notice(this.i18n.t('notices.pleaseConfigureS3'));
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(this.i18n.t('notices.noActiveFile'));
			return;
		}

		const content = await this.app.vault.read(activeFile);
		const attachmentPaths = this.extractAttachmentPaths(content);
		
		if (attachmentPaths.length === 0) {
			new Notice(this.i18n.t('notices.noAttachmentsInCurrentFile'));
			return;
		}

		new Notice(this.i18n.t('notices.uploadingAttachments', { count: attachmentPaths.length.toString() }));

		let successCount = 0;
		let failCount = 0;

		for (const path of attachmentPaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				try {
					await this.uploadAndReplaceAttachment(file, activeFile);
					successCount++;
				} catch (error) {
					failCount++;
				}
			}
		}

		if (failCount === 0) {
			new Notice(this.i18n.t('notices.uploadSuccess', { count: successCount.toString() }));
		} else {
			new Notice(this.i18n.t('notices.uploadPartialSuccess', { 
				success: successCount.toString(),
				failed: failCount.toString()
			}));
		}
	}

	async uploadAndReplaceAttachment(attachment: TFile, targetFile?: TFile) {
		const maxRetries = this.settings.retryCount;
		let lastError: Error | null = null;
		
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const arrayBuffer = await this.app.vault.readBinary(attachment);
				const buffer = Buffer.from(arrayBuffer);
				
				let key: string;
				if (this.settings.organizeByDate) {
					const datePath = this.formatDate(new Date(), this.settings.dateFormat);
					key = `${this.settings.folderPath}/${datePath}/${attachment.name}`;
				} else {
					key = `${this.settings.folderPath}/${attachment.name}`;
				}
				
				if (attempt > 1) {
					new Notice(this.i18n.t('notices.retryingUpload', { 
						filename: attachment.name,
						attempt: attempt.toString()
					}));
				}
				
				await this.s3.upload({
					Bucket: this.settings.bucketName,
					Key: key,
					Body: buffer,
					ContentType: this.getContentType(attachment.extension)
				}).promise();

				const cloudUrl = `${this.settings.baseUrl}/${key}`;
				
				await this.replaceAttachmentReferences(attachment, cloudUrl, targetFile);
				
				await this.app.vault.delete(attachment);
				return;
				
			} catch (error) {
				lastError = error as Error;
				console.error(`Upload attempt ${attempt} failed for ${attachment.name}:`, error);
				
				if (attempt < maxRetries) {
					await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
				}
			}
		}
		
		new Notice(this.i18n.t('notices.uploadFailedAllRetries', {
			filename: attachment.name,
			maxRetries: maxRetries.toString(),
			error: lastError?.message || 'Unknown error'
		}));
		throw lastError;
	}

	async replaceAttachmentReferences(attachment: TFile, cloudUrl: string, targetFile?: TFile) {
		const files = targetFile ? [targetFile] : this.app.vault.getMarkdownFiles();
		
		for (const file of files) {
			const content = await this.app.vault.read(file);
			let modified = false;
			let newContent = content;

			// Replace markdown links: ![alt](attachment)
			const markdownRegex = new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*${this.escapeRegex(attachment.name)}[^)]*)\\)`, 'g');
			if (markdownRegex.test(content)) {
				newContent = newContent.replace(markdownRegex, `![$1](${cloudUrl})`);
				modified = true;
			}

			// Replace wiki links: [[attachment]]
			const wikiRegex = new RegExp(`\\[\\[([^\\]]*${this.escapeRegex(attachment.name)}[^\\]]*)\\]\\]`, 'g');
			if (wikiRegex.test(newContent)) {
				newContent = newContent.replace(wikiRegex, `![](${cloudUrl})`);
				modified = true;
			}

			if (modified) {
				await this.app.vault.modify(file, newContent);
			}
		}
	}

	extractAttachmentPaths(content: string): string[] {
		const paths: string[] = [];
		
		// Match markdown links
		const markdownMatches = content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g);
		for (const match of markdownMatches) {
			const path = match[1];
			if (!path.startsWith('http')) {
				paths.push(path);
			}
		}

		// Match wiki links
		const wikiMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
		for (const match of wikiMatches) {
			const path = match[1];
			if (this.isAttachmentPath(path)) {
				paths.push(path);
			}
		}

		return paths;
	}

	isAttachment(file: TFile): boolean {
		const allowedExts = this.settings.allowedExtensions
			.split(',')
			.map(ext => ext.trim().toLowerCase())
			.filter(ext => ext.length > 0);
		
		return allowedExts.includes(file.extension.toLowerCase());
	}

	isAttachmentPath(path: string): boolean {
		const ext = path.split('.').pop()?.toLowerCase();
		if (!ext) return false;
		
		const allowedExts = this.settings.allowedExtensions
			.split(',')
			.map(ext => ext.trim().toLowerCase())
			.filter(ext => ext.length > 0);
		
		return allowedExts.includes(ext);
	}

	getContentType(extension: string): string {
		const types: { [key: string]: string } = {
			'png': 'image/png',
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'gif': 'image/gif',
			'bmp': 'image/bmp',
			'svg': 'image/svg+xml',
			'webp': 'image/webp',
			'pdf': 'application/pdf',
			'doc': 'application/msword',
			'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'mp4': 'video/mp4',
			'mp3': 'audio/mpeg',
			'wav': 'audio/wav'
		};
		return types[extension.toLowerCase()] || 'application/octet-stream';
	}

	escapeRegex(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	async testS3Connection(): Promise<boolean> {
		if (!this.s3) {
			new Notice(this.i18n.t('notices.pleaseConfigureS3'));
			return false;
		}

		try {
			await this.s3.headBucket({ Bucket: this.settings.bucketName }).promise();
			new Notice(this.i18n.t('notices.s3ConnectionSuccess'));
			return true;
		} catch (error) {
			console.error('S3 connection test failed:', error);
			new Notice(this.i18n.t('notices.s3ConnectionFailed', { error: error.message }));
			return false;
		}
	}

	formatDate(date: Date, format: string): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hour = String(date.getHours()).padStart(2, '0');
		const minute = String(date.getMinutes()).padStart(2, '0');
		const second = String(date.getSeconds()).padStart(2, '0');

		return format
			.replace(/YYYY/g, year.toString())
			.replace(/YY/g, year.toString().slice(-2))
			.replace(/MM/g, month)
			.replace(/DD/g, day)
			.replace(/HH/g, hour)
			.replace(/mm/g, minute)
			.replace(/ss/g, second);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeS3();
	}
}

class S3UploaderSettingTab extends PluginSettingTab {
	plugin: S3AttachmentUploader;

	constructor(app: App, plugin: S3AttachmentUploader) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: this.plugin.i18n.t('settings.title') });

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.accessKeyId.name'))
			.setDesc(this.plugin.i18n.t('settings.accessKeyId.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.accessKeyId.placeholder'))
				.setValue(this.plugin.settings.accessKeyId)
				.onChange(async (value) => {
					this.plugin.settings.accessKeyId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.secretAccessKey.name'))
			.setDesc(this.plugin.i18n.t('settings.secretAccessKey.desc'))
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder(this.plugin.i18n.t('settings.secretAccessKey.placeholder'))
					.setValue(this.plugin.settings.secretAccessKey)
					.onChange(async (value) => {
						this.plugin.settings.secretAccessKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.region.name'))
			.setDesc(this.plugin.i18n.t('settings.region.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.region.placeholder'))
				.setValue(this.plugin.settings.region)
				.onChange(async (value) => {
					this.plugin.settings.region = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.bucketName.name'))
			.setDesc(this.plugin.i18n.t('settings.bucketName.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.bucketName.placeholder'))
				.setValue(this.plugin.settings.bucketName)
				.onChange(async (value) => {
					this.plugin.settings.bucketName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.baseUrl.name'))
			.setDesc(this.plugin.i18n.t('settings.baseUrl.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.baseUrl.placeholder'))
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.folderPath.name'))
			.setDesc(this.plugin.i18n.t('settings.folderPath.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.folderPath.placeholder'))
				.setValue(this.plugin.settings.folderPath)
				.onChange(async (value) => {
					this.plugin.settings.folderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.allowedExtensions.name'))
			.setDesc(this.plugin.i18n.t('settings.allowedExtensions.desc'))
			.addTextArea(text => {
				text.setPlaceholder(this.plugin.i18n.t('settings.allowedExtensions.placeholder'))
					.setValue(this.plugin.settings.allowedExtensions)
					.onChange(async (value) => {
						this.plugin.settings.allowedExtensions = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.minHeight = '80px';
				text.inputEl.style.width = '100%';
			});

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.organizeByDate.name'))
			.setDesc(this.plugin.i18n.t('settings.organizeByDate.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.organizeByDate)
				.onChange(async (value) => {
					this.plugin.settings.organizeByDate = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.organizeByDate) {
			new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.dateFormat.name'))
				.setDesc(this.plugin.i18n.t('settings.dateFormat.desc'))
				.addText(text => text
					.setPlaceholder(this.plugin.i18n.t('settings.dateFormat.placeholder'))
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					}));

			const previewSetting = new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.preview.name'))
				.setDesc('');
			
			const currentDate = new Date();
			const preview = this.plugin.formatDate(currentDate, this.plugin.settings.dateFormat);
			previewSetting.setDesc(this.plugin.i18n.t('settings.preview.desc', {
				path: `${this.plugin.settings.folderPath}/${preview}/filename.ext`
			}));
		}

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.usePathStyle.name'))
			.setDesc(this.plugin.i18n.t('settings.usePathStyle.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.usePathStyle)
				.onChange(async (value) => {
					this.plugin.settings.usePathStyle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.retryCount.name'))
			.setDesc(this.plugin.i18n.t('settings.retryCount.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.retryCount.placeholder'))
				.setValue(this.plugin.settings.retryCount.toString())
				.onChange(async (value) => {
					const retryCount = parseInt(value) || 3;
					this.plugin.settings.retryCount = Math.max(1, Math.min(10, retryCount));
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.testConnection.name'))
			.setDesc(this.plugin.i18n.t('settings.testConnection.desc'))
			.addButton(button => button
				.setButtonText(this.plugin.i18n.t('settings.testConnection.button'))
				.setCta()
				.onClick(async () => {
					button.setButtonText(this.plugin.i18n.t('settings.testConnection.testing'));
					button.setDisabled(true);
					
					try {
						await this.plugin.testS3Connection();
					} finally {
						button.setButtonText(this.plugin.i18n.t('settings.testConnection.button'));
						button.setDisabled(false);
					}
				}));
	}
}