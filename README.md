# S3 Attachment Uploader

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-purple?logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An Obsidian plugin that automatically uploads local images and attachments to Amazon S3 and replaces local links with cloud links. Perfect for keeping your vault lightweight while ensuring your attachments are always accessible.

## Features

- 🚀 **Automatic Upload**: Upload local attachments to S3 with a single command
- 🔄 **Link Replacement**: Automatically replace local attachment links with S3 URLs
- 📁 **Smart Organization**: Organize uploads by date with customizable folder structure
- 🧹 **Cleanup Tool**: Remove unused S3 files to manage storage costs
- 🌍 **Multi-language Support**: Available in English and Chinese
- ⚡ **Batch Processing**: Upload all attachments or just those in the current file
- 🎯 **File Type Filtering**: Configurable allowed file extensions

## Installation

### Manual Installation

1. Download the latest release from the [Releases](https://github.com/yourusername/obsidian-s3-attachment-uploader/releases) page
2. Extract the plugin files to your vault's plugins directory:
   ```
   VaultFolder/.obsidian/plugins/s3-attachment-uploader/
   ```
3. Enable the plugin in Obsidian Settings > Community Plugins

### From Obsidian Community Plugins

*Coming soon - this plugin is pending review for the community plugin store*

## Configuration

### S3 Setup

1. Create an AWS S3 bucket
2. Create an IAM user with the following permissions:
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
3. Note down the Access Key ID and Secret Access Key

### Plugin Settings

Open Obsidian Settings > S3 Attachment Uploader and configure:

| Setting | Description | Example |
|---------|-------------|---------|
| Access Key ID | Your AWS Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| Secret Access Key | Your AWS Secret Access Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| Region | AWS Region where your bucket is located | `us-east-1` |
| Bucket Name | Name of your S3 bucket | `my-obsidian-attachments` |
| Base URL | Custom domain or CloudFront URL (optional) | `https://cdn.example.com` |
| Folder Path | Prefix for uploaded files | `obsidian-attachments/` |
| Allowed Extensions | Comma-separated list of allowed file types | `png,jpg,jpeg,gif,pdf,mp4` |
| Organize by Date | Create date-based folder structure | ✅ Enabled |
| Date Format | Format for date folders | `YYYY/MM/DD` |
| Use Path Style | Use path-style URLs for S3-compatible services | ❌ Disabled |

## Usage

### Commands

The plugin provides three main commands accessible via Command Palette (`Ctrl/Cmd + P`):

1. **Upload all attachments to S3**: Scans your entire vault and uploads all local attachments
2. **Upload current file attachments to S3**: Uploads only attachments referenced in the currently active file
3. **Clean up unused S3 files**: Removes S3 files that are no longer referenced in your vault

### Ribbon Icon

Click the cloud upload icon in the ribbon to quickly upload attachments from the current file.

### Automatic Processing

When you upload attachments, the plugin will:

1. **Scan** for local attachment links in your markdown files
2. **Upload** the files to your S3 bucket
3. **Replace** local links with S3 URLs
4. **Organize** files in folders (if date organization is enabled)

### Example

Before:
```markdown
![My Image](attachments/image.png)
```

After:
```markdown
![My Image](https://your-bucket.s3.amazonaws.com/obsidian-attachments/2024/01/15/image.png)
```

## File Organization

With date organization enabled, your S3 bucket will be structured like:

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

## Development

### Prerequisites

- Node.js 16.x or later
- npm or yarn

### Setup

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/obsidian-s3-attachment-uploader.git
   cd obsidian-s3-attachment-uploader
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Build the plugin
   ```bash
   npm run build
   ```

### Development Workflow

- `npm run dev`: Start development with hot reload
- `npm run build`: Build for production
- `npm run version`: Bump version and update manifest

## Troubleshooting

### Common Issues

**"Please configure S3 settings first"**
- Ensure all required S3 settings are filled in the plugin settings

**Upload fails with permission errors**
- Verify your IAM user has the required S3 permissions
- Check that the bucket name and region are correct

**Files not found after upload**
- Ensure your bucket policy allows public read access (if needed)
- Check the base URL configuration

**Plugin not loading**
- Verify the plugin files are in the correct directory
- Check the Obsidian console for error messages

### Support

If you encounter issues:

1. Check the [Issues](https://github.com/yourusername/obsidian-s3-attachment-uploader/issues) page
2. Enable debugging in the plugin settings for detailed logs
3. Create a new issue with your configuration (remove sensitive information)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Translation

To add support for additional languages:

1. Create a new locale file in the `locale/` directory (e.g., `locale/fr.json`)
2. Copy the structure from `locale/en.json`
3. Translate all strings
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built for [Obsidian](https://obsidian.md)
- Uses [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js)
- Inspired by the need for lightweight, cloud-backed note-taking

---

Made with ❤️ by [Arkylin](https://github.com/arkylin)