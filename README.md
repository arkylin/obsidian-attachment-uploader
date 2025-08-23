# S3 附件上传器

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-purple?logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

一个 Obsidian 插件，自动将本地图片和附件上传到 Amazon S3，并将本地链接替换为云端链接。完美地保持你的笔记库轻量化，同时确保附件始终可访问。

## 功能特性

- 🚀 **自动上传**: 一键将本地附件上传到 S3
- 🔄 **链接替换**: 自动将本地附件链接替换为 S3 URL
- 📁 **智能整理**: 按日期组织上传文件，支持自定义文件夹结构
- 🧹 **清理工具**: 删除未使用的 S3 文件以管理存储成本
- 🌍 **多语言支持**: 支持中文和英文
- ⚡ **批量处理**: 上传所有附件或仅当前文档的附件
- 🎯 **文件类型筛选**: 可配置允许的文件扩展名

## 安装

### 手动安装

1. 从 [Releases](https://github.com/arkylin/obsidian-attachment-uploader/releases) 页面下载最新版本
2. 将插件文件解压到你的笔记库插件目录：
   ```
   笔记库文件夹/.obsidian/plugins/obsidian-attachment-uploader/
   ```
3. 在 Obsidian 设置 > 社区插件中启用插件

### 从 Obsidian 社区插件商店安装

*即将推出 - 此插件正在等待社区插件商店审核*

## 配置

### S3 设置

1. 创建一个 AWS S3 存储桶
2. 创建一个具有以下权限的 IAM 用户：
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::your-bucket-name",
           "arn:aws:s3:::your-bucket-name/*"
         ]
       }
     ]
   }
   ```
3. 记录访问密钥 ID 和秘密访问密钥

### 插件设置

打开 Obsidian 设置 > S3 附件上传器并配置：

| 设置 | 描述 | 示例 |
|---------|-------------|---------|
| 访问密钥 ID | 您的 AWS 访问密钥 ID | `AKIAIOSFODNN7EXAMPLE` |
| 秘密访问密钥 | 您的 AWS 秘密访问密钥 | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| 区域 | 您的存储桶所在的 AWS 区域 | `us-east-1` |
| 存储桶名称 | 您的 S3 存储桶名称 | `my-obsidian-attachments` |
| 基础 URL | 自定义域名或 CloudFront URL（可选） | `https://cdn.example.com` |
| 文件夹路径 | 上传文件的前缀路径 | `obsidian-attachments/` |
| 允许的扩展名 | 逗号分隔的允许文件类型列表 | `png,jpg,jpeg,gif,pdf,mp4` |
| 按日期组织 | 创建基于日期的文件夹结构 | ✅ 启用 |
| 日期格式 | 日期文件夹的格式 | `YYYY/MM/DD` |
| 使用路径样式 | 为 S3 兼容服务使用路径样式 URL | ❌ 禁用 |

## 使用方法

### 命令

插件提供三个主要命令，可通过命令面板（`Ctrl/Cmd + P`）访问：

1. **上传所有附件到 S3**: 扫描整个笔记库并上传所有本地附件
2. **上传当前文档附件到 S3**: 仅上传当前激活文档中引用的附件
3. **清理未使用的 S3 文件**: 删除笔记库中不再引用的 S3 文件

### 功能区图标

点击功能区中的云上传图标可快速上传当前文档的附件。

### 自动处理

当您上传附件时，插件将：

1. **扫描** Markdown 文件中的本地附件链接
2. **上传** 文件到您的 S3 存储桶
3. **替换** 本地链接为 S3 URL
4. **整理** 文件到文件夹（如果启用了日期组织）

### 示例

上传前：
```markdown
![我的图片](attachments/image.png)
```

上传后：
```markdown
![我的图片](https://your-bucket.s3.amazonaws.com/obsidian-attachments/2024/01/15/image.png)
```

## 文件组织

启用日期组织后，您的 S3 存储桶将按以下结构组织：

```
your-bucket/
├── obsidian-attachments/
│   ├── 2024/
│   │   ├── 01/
│   │   │   ├── 15/
│   │   │   │   ├── image1.png
│   │   │   │   └── document.pdf
│   │   │   └── 16/
│   │   │       └── screenshot.jpg
│   │   └── 02/
│   │       └── ...
│   └── 2025/
│       └── ...
```

## 开发

### 前置要求

- Node.js 16.x 或更高版本
- npm 或 yarn

### 设置

1. 克隆仓库
   ```bash
   git clone https://github.com/arkylin/obsidian-attachment-uploader.git
   cd obsidian-attachment-uploader
   ```

2. 安装依赖
   ```bash
   npm install
   ```

3. 构建插件
   ```bash
   npm run build
   ```

### 开发工作流

- `npm run dev`: 启动开发模式（热重载）
- `npm run build`: 生产构建
- `npm run version`: 版本升级并更新清单

## 故障排除

### 常见问题

**"请先配置 S3 设置"**
- 确保所有必需的 S3 设置都已在插件设置中填写

**上传失败并出现权限错误**
- 验证您的 IAM 用户具有所需的 S3 权限
- 检查存储桶名称和区域是否正确

**上传后找不到文件**
- 确保您的存储桶策略允许公共读取访问（如果需要）
- 检查基础 URL 配置

**插件无法加载**
- 验证插件文件在正确的目录中
- 检查 Obsidian 控制台的错误消息

### 技术支持

如果遇到问题：

1. 查看 [Issues](https://github.com/arkylin/obsidian-attachment-uploader/issues) 页面
2. 在插件设置中启用调试模式以获取详细日志
3. 创建一个新的 issue 并提供您的配置信息（请删除敏感信息）

## 贡献

欢迎贡献！请随时提交 Pull Request。对于重大更改，请先开启一个 issue 来讨论您想要更改的内容。

### 翻译

要添加对其他语言的支持：

1. 在 `locale/` 目录中创建新的语言文件（例如 `locale/fr.json`）
2. 复制 `locale/en.json` 的结构
3. 翻译所有字符串
4. 提交拉取请求

## 许可证

此项目使用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 致谢

- 为 [Obsidian](https://obsidian.md) 构建
- 使用 [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js)
- 受轻量化、云端支持笔记需求的启发

---

Made with ❤️ by [Arkylin](https://github.com/arkylin)