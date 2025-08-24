import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, moment, Modal } from 'obsidian';
import { S3Client, S3ClientConfig, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';

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
	trashPath: string;
	moveToTrash: boolean;
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
	retryCount: 3,
	trashPath: '.trash',
	moveToTrash: true
}

export default class S3AttachmentUploader extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
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

		this.addCommand({
			id: 'cleanup-unused-s3-files',
			name: this.i18n.t('commands.cleanupUnusedS3Files'),
			callback: () => this.cleanupUnusedS3Files()
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
			const s3Config: S3ClientConfig = {
				credentials: {
					accessKeyId: this.settings.accessKeyId,
					secretAccessKey: this.settings.secretAccessKey
				},
				region: this.settings.region,
				forcePathStyle: this.settings.usePathStyle
			};
			
			// 如果设置了自定义 baseUrl，则使用它作为 endpoint
			if (this.settings.baseUrl) {
				s3Config.endpoint = this.settings.baseUrl;
			}
			
			this.s3 = new S3Client(s3Config);
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
				
				const sanitizedFileName = attachment.name.replace(/\s+/g, '-');
				let key: string;
				if (this.settings.organizeByDate) {
					const datePath = this.formatDate(new Date(), this.settings.dateFormat);
					if (this.settings.folderPath) {
						key = `${this.settings.folderPath}/${datePath}/${sanitizedFileName}`;
					} else {
						key = `${datePath}/${sanitizedFileName}`;
					}
				} else {
					if (this.settings.folderPath) {
						key = `${this.settings.folderPath}/${sanitizedFileName}`;
					} else {
						key = sanitizedFileName;
					}
				}
				
				if (attempt > 1) {
					new Notice(this.i18n.t('notices.retryingUpload', { 
						filename: attachment.name,
						attempt: attempt.toString()
					}));
				}
				
				const command = new PutObjectCommand({
					Bucket: this.settings.bucketName,
					Key: key,
					Body: buffer,
					ContentType: this.getContentType(attachment.extension)
				});
				await this.s3.send(command);

				let cloudUrl: string;
				if (this.settings.usePathStyle) {
					cloudUrl = `${this.settings.baseUrl}/${this.settings.bucketName}/${key}`;
				} else {
					cloudUrl = `${this.settings.baseUrl}/${key}`;
				}
				
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
			if (markdownRegex.test(newContent)) {
				markdownRegex.lastIndex = 0; // Reset regex state
				newContent = newContent.replace(markdownRegex, `![$1](${cloudUrl})`);
				modified = true;
			}

			// Replace wiki links: [[attachment]] or ![[attachment]]
			const wikiRegex = new RegExp(`!?\\[\\[([^\\]]*${this.escapeRegex(attachment.name)}[^\\]]*)\\]\\]`, 'g');
			if (wikiRegex.test(newContent)) {
				wikiRegex.lastIndex = 0; // Reset regex state
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
			const command = new HeadBucketCommand({ Bucket: this.settings.bucketName });
			await this.s3.send(command);
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

	async cleanupUnusedS3Files() {
		if (!this.s3) {
			new Notice(this.i18n.t('notices.pleaseConfigureS3'));
			return;
		}

		const cleanupModal = new CleanupModal(this.app, this);
		cleanupModal.open();
	}

	async getAllS3Files(): Promise<string[]> {
		if (!this.s3) {
			throw new Error(this.i18n.t('notices.pleaseConfigureS3'));
		}

		const files: string[] = [];
		let continuationToken: string | undefined;

		do {
			const params: any = {
				Bucket: this.settings.bucketName,
				Prefix: this.settings.folderPath
			};

			if (continuationToken) {
				params.ContinuationToken = continuationToken;
			}

			try {
				const command = new ListObjectsV2Command(params);
				const result = await this.s3.send(command);
				
				if (result.Contents) {
					for (const object of result.Contents) {
						if (object.Key) {
							// 排除回收站中的文件
							if (!object.Key.startsWith(this.settings.trashPath + '/') && 
								!object.Key.includes('/' + this.settings.trashPath + '/')) {
								files.push(object.Key);
							}
						}
					}
				}

				continuationToken = result.NextContinuationToken;
			} catch (error) {
				console.error('Error listing S3 objects:', error);
				throw error;
			}
		} while (continuationToken);

		return files;
	}

	async findAllObsidianReferences(): Promise<Set<string>> {
		const references = new Set<string>();
		const markdownFiles = this.app.vault.getMarkdownFiles();

		for (const file of markdownFiles) {
			const content = await this.app.vault.read(file);
			
			// 多种模式匹配S3链接
			const patterns = [
				// 标准markdown图片链接: ![alt](url)
				/!\[[^\]]*\]\(([^)]+)\)/g,
				// markdown链接: [text](url)
				/\[[^\]]*\]\(([^)]+)\)/g,
				// wiki链接中的URL: [[url]]
				/\[\[([^\]]+)\]\]/g,
				// 直接的URL引用
				new RegExp('(' + this.escapeRegex(this.settings.baseUrl) + '[^\\s\\)\\]\\>\\<\\"\']+)', 'g')
			];

			for (const pattern of patterns) {
				let match;
				while ((match = pattern.exec(content)) !== null) {
					let url = match[1];
					
					// 如果是完整URL，提取S3 key
					if (url.includes(this.settings.baseUrl)) {
						const baseUrlIndex = url.indexOf(this.settings.baseUrl);
						if (baseUrlIndex !== -1) {
							let s3Key = url.substring(baseUrlIndex + this.settings.baseUrl.length);
							if (s3Key.startsWith('/')) {
								s3Key = s3Key.substring(1);
							}
							// 清理URL中的查询参数和片段
							s3Key = s3Key.split('?')[0].split('#')[0];
							if (s3Key) {
								references.add(s3Key);
							}
						}
					}
				}
			}
		}

		// 添加调试日志
		console.log(`Found ${references.size} unique S3 references:`, Array.from(references));
		return references;
	}

	async deleteS3File(key: string): Promise<boolean> {
		if (!this.s3) {
			return false;
		}

		try {
			const command = new DeleteObjectCommand({
				Bucket: this.settings.bucketName,
				Key: key
			});
			await this.s3.send(command);
			return true;
		} catch (error) {
			console.error(`Error deleting S3 file ${key}:`, error);
			return false;
		}
	}

	async moveS3FileToTrash(key: string): Promise<boolean> {
		if (!this.s3) {
			return false;
		}

		try {
			const fileName = key.split('/').pop() || key;
			const trashKey = `${this.settings.trashPath}/${fileName}_${Date.now()}`;
			
			const copyCommand = new CopyObjectCommand({
				Bucket: this.settings.bucketName,
				CopySource: `${this.settings.bucketName}/${key}`,
				Key: trashKey
			});
			await this.s3.send(copyCommand);

			const deleteCommand = new DeleteObjectCommand({
				Bucket: this.settings.bucketName,
				Key: key
			});
			await this.s3.send(deleteCommand);

			return true;
		} catch (error) {
			console.error(`Error moving S3 file ${key} to trash:`, error);
			return false;
		}
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

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.trashPath.name'))
			.setDesc(this.plugin.i18n.t('settings.trashPath.desc'))
			.addText(text => text
				.setPlaceholder(this.plugin.i18n.t('settings.trashPath.placeholder'))
				.setValue(this.plugin.settings.trashPath)
				.onChange(async (value) => {
					this.plugin.settings.trashPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.moveToTrash.name'))
			.setDesc(this.plugin.i18n.t('settings.moveToTrash.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.moveToTrash)
				.onChange(async (value) => {
					this.plugin.settings.moveToTrash = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.cleanupFiles.name'))
			.setDesc(this.plugin.i18n.t('settings.cleanupFiles.desc'))
			.addButton(button => button
				.setButtonText(this.plugin.i18n.t('settings.cleanupFiles.button'))
				.setWarning()
				.onClick(async () => {
					await this.plugin.cleanupUnusedS3Files();
				}));
	}
}

class CleanupModal extends Modal {
	plugin: S3AttachmentUploader;
	progressEl: HTMLElement;
	statusEl: HTMLElement;
	resultEl: HTMLElement;
	cleanupButton: HTMLButtonElement;
	cancelButton: HTMLButtonElement;
	isRunning: boolean = false;
	shouldCancel: boolean = false;

	constructor(app: App, plugin: S3AttachmentUploader) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.plugin.i18n.t('cleanup.title') });

		const warningEl = contentEl.createEl('div', { 
			cls: 'mod-warning',
			text: this.plugin.i18n.t('cleanup.warning')
		});
		warningEl.style.color = 'red';
		warningEl.style.fontWeight = 'bold';
		warningEl.style.marginBottom = '20px';

		this.statusEl = contentEl.createEl('div', { 
			text: this.plugin.i18n.t('cleanup.ready')
		});

		this.progressEl = contentEl.createEl('div', { cls: 'cleanup-progress' });
		this.progressEl.style.cssText = `
			width: 100%;
			height: 20px;
			background-color: #f0f0f0;
			border-radius: 10px;
			margin: 20px 0;
			overflow: hidden;
			display: none;
		`;

		const progressBar = this.progressEl.createEl('div');
		progressBar.style.cssText = `
			height: 100%;
			background-color: #4CAF50;
			width: 0%;
			transition: width 0.3s ease;
		`;

		this.resultEl = contentEl.createEl('div');
		this.resultEl.style.marginTop = '20px';

		const buttonContainer = contentEl.createEl('div');
		buttonContainer.style.cssText = `
			display: flex;
			justify-content: space-between;
			margin-top: 20px;
		`;

		this.cleanupButton = buttonContainer.createEl('button', { 
			text: this.plugin.i18n.t('cleanup.startButton'),
			cls: 'mod-warning'
		});
		this.cleanupButton.onclick = () => this.startCleanup();

		this.cancelButton = buttonContainer.createEl('button', { 
			text: this.plugin.i18n.t('cleanup.cancelButton')
		});
		this.cancelButton.onclick = () => this.close();
	}

	async startCleanup() {
		this.isRunning = true;
		this.shouldCancel = false;
		this.cleanupButton.disabled = true;
		this.cancelButton.textContent = this.plugin.i18n.t('cleanup.stopButton');
		this.cancelButton.onclick = () => {
			this.shouldCancel = true;
			this.cancelButton.disabled = true;
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.stopping');
		};
		
		this.progressEl.style.display = 'block';
		this.resultEl.empty();

		try {
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.gettingS3Files');
			const s3Files = await this.plugin.getAllS3Files();
			console.log(`Found ${s3Files.length} S3 files:`, s3Files);
			
			if (this.shouldCancel) return;
			
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.scanningObsidian');
			const obsidianReferences = await this.plugin.findAllObsidianReferences();
			
			if (this.shouldCancel) return;

			// 创建规范化的比较集合
			const normalizedReferences = new Set<string>();
			console.log(`Current settings - folderPath: '${this.plugin.settings.folderPath}', bucketName: '${this.plugin.settings.bucketName}', usePathStyle: ${this.plugin.settings.usePathStyle}`);
			
			for (const ref of obsidianReferences) {
				normalizedReferences.add(ref);
				
				// 根据是否使用 Path-Style 来处理路径
				if (this.plugin.settings.usePathStyle) {
					// Path-Style 模式: baseUrl/bucketName/key
					// 但实际引用可能没有 bucketName 部分，所以需要智能匹配
					
					// 尝试移除可能的 bucketName 前缀
					if (this.plugin.settings.bucketName && ref.startsWith(this.plugin.settings.bucketName + '/')) {
						const withoutBucket = ref.substring(this.plugin.settings.bucketName.length + 1);
						normalizedReferences.add(withoutBucket);
						console.log(`Path-Style: Removed bucket prefix, '${ref}' -> '${withoutBucket}'`);
					}
					
					// 如果引用直接以 folderPath 开头（没有 bucketName）
					if (this.plugin.settings.folderPath && ref.startsWith(this.plugin.settings.folderPath + '/')) {
						const withoutFolder = ref.substring(this.plugin.settings.folderPath.length + 1);
						normalizedReferences.add(withoutFolder);
						console.log(`Path-Style: Removed folder prefix, '${ref}' -> '${withoutFolder}'`);
					}
				} else {
					// 非 Path-Style 模式: baseUrl/key
					if (this.plugin.settings.folderPath && ref.startsWith(this.plugin.settings.folderPath + '/')) {
						const normalizedRef = ref.substring(this.plugin.settings.folderPath.length + 1);
						normalizedReferences.add(normalizedRef);
						console.log(`Non Path-Style: Removed folder prefix, '${ref}' -> '${normalizedRef}'`);
					}
				}
				
				// 通用的直接匹配检测
				for (const s3File of s3Files) {
					if (ref.endsWith('/' + s3File) || ref === s3File) {
						normalizedReferences.add(s3File);
						console.log(`Direct match: '${s3File}' found in reference '${ref}'`);
					}
				}
			}

			const unusedFiles = s3Files.filter(file => {
				// 检查直接匹配
				if (normalizedReferences.has(file)) {
					return false;
				}
				
				// 检查带folderPath的匹配
				const fullPath = this.plugin.settings.folderPath + '/' + file;
				if (normalizedReferences.has(fullPath)) {
					return false;
				}
				
				return true;
			});

			console.log(`S3 files:`, s3Files);
			console.log(`Original references:`, Array.from(obsidianReferences));
			console.log(`Normalized references:`, Array.from(normalizedReferences));
			console.log(`Unused files:`, unusedFiles);
			
			if (unusedFiles.length === 0) {
				this.statusEl.textContent = this.plugin.i18n.t('cleanup.noUnusedFiles');
				
				// 显示调试信息
				const debugEl = this.resultEl.createEl('div');
				debugEl.innerHTML = `
					<details style="margin-top: 10px;">
						<summary>调试信息</summary>
						<p>S3文件总数: ${s3Files.length}</p>
						<p>Obsidian引用数: ${obsidianReferences.size}</p>
						<p>所有文件都有引用，无需清理</p>
					</details>
				`;
				
				this.progressEl.style.display = 'none';
				this.resetButtons();
				return;
			}

			this.statusEl.textContent = this.plugin.i18n.t('cleanup.foundUnusedFiles', { 
				count: unusedFiles.length.toString() 
			});

			// 显示将要删除的文件列表
			const previewEl = this.resultEl.createEl('div');
			previewEl.innerHTML = `
				<details style="margin: 10px 0; border: 1px solid #ccc; padding: 10px; border-radius: 5px;">
					<summary style="cursor: pointer; font-weight: bold; color: #d73a49;">⚠️ 将要${this.plugin.settings.moveToTrash ? '移动到回收站' : '永久删除'}的文件 (${unusedFiles.length}个)</summary>
					<div style="max-height: 200px; overflow-y: auto; margin-top: 10px;">
						${unusedFiles.map(file => `<div style="padding: 2px 0; font-family: monospace; font-size: 12px;">${file}</div>`).join('')}
					</div>
				</details>
			`;

			// 添加确认按钮
			const confirmContainer = this.resultEl.createEl('div');
			confirmContainer.style.cssText = `
				display: flex;
				gap: 10px;
				margin: 10px 0;
			`;

			const confirmButton = confirmContainer.createEl('button', { 
				text: `确认${this.plugin.settings.moveToTrash ? '移动到回收站' : '永久删除'}`,
				cls: 'mod-warning'
			});
			
			const cancelButton = confirmContainer.createEl('button', { 
				text: '取消'
			});

			// 等待用户确认
			await new Promise<void>((resolve, reject) => {
				confirmButton.onclick = () => {
					confirmContainer.remove();
					resolve();
				};
				
				cancelButton.onclick = () => {
					this.resetButtons();
					reject(new Error('用户取消操作'));
				};
			});

			let processed = 0;
			let deleted = 0;
			let failed = 0;

			const progressBar = this.progressEl.querySelector('div') as HTMLElement;

			for (const file of unusedFiles) {
				if (this.shouldCancel) break;

				this.statusEl.textContent = this.plugin.i18n.t('cleanup.processing', {
					current: (processed + 1).toString(),
					total: unusedFiles.length.toString(),
					filename: file
				});

				let success = false;
				if (this.plugin.settings.moveToTrash) {
					success = await this.plugin.moveS3FileToTrash(file);
				} else {
					success = await this.plugin.deleteS3File(file);
				}

				if (success) {
					deleted++;
				} else {
					failed++;
				}

				processed++;
				const progress = (processed / unusedFiles.length) * 100;
				progressBar.style.width = `${progress}%`;
			}

			this.showResults(processed, deleted, failed, this.shouldCancel);
			
		} catch (error) {
			console.error('Cleanup failed:', error);
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.error', { 
				error: error.message 
			});
			this.statusEl.style.color = 'red';
		}

		this.resetButtons();
	}

	showResults(processed: number, deleted: number, failed: number, cancelled: boolean) {
		this.resultEl.empty();
		
		if (cancelled) {
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.cancelled');
		} else {
			this.statusEl.textContent = this.plugin.i18n.t('cleanup.completed');
		}

		if (deleted > 0) {
			const successEl = this.resultEl.createEl('div', { 
				text: this.plugin.i18n.t('cleanup.deletedFiles', { 
					count: deleted.toString() 
				})
			});
			successEl.style.color = 'green';
		}

		if (failed > 0) {
			const failedEl = this.resultEl.createEl('div', { 
				text: this.plugin.i18n.t('cleanup.failedFiles', { 
					count: failed.toString() 
				})
			});
			failedEl.style.color = 'red';
		}
	}

	resetButtons() {
		this.isRunning = false;
		this.cleanupButton.disabled = false;
		this.cleanupButton.textContent = this.plugin.i18n.t('cleanup.startButton');
		this.cancelButton.disabled = false;
		this.cancelButton.textContent = this.plugin.i18n.t('cleanup.cancelButton');
		this.cancelButton.onclick = () => this.close();
		this.progressEl.style.display = 'none';
	}

	onClose() {
		this.shouldCancel = true;
	}
}