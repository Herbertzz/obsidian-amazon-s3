# Amazon S3 Uploader for Obsidian

[简体中文说明](README.md)

Upload local images, attachments, or remote resources from Obsidian to Amazon S3 or any S3-compatible object storage, and automatically replace them with remote URLs.

## Features

- Batch upload local attachments and images referenced in the current note.
- Batch download remote images and files referenced in the current note and replace them with local links.
- Support automatic upload from the clipboard when pasting.
- Support automatic upload on drag and drop. Hold `Ctrl/Cmd` to use Obsidian's default behavior.
- Add an `Upload to S3` action to the file context menu and automatically update all backlinks.
- Support download proxy and Referer rules for hotlink-protected resources.
- Support upload path templates and output URL templates.
- Support allowlists for image and file extensions.

## Installation

### Manual installation

1. Create the folder `.obsidian/plugins/amazon-s3-uploader/` inside your vault.
2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
3. Restart Obsidian, or reload community plugins.
4. Enable the plugin in **Settings → Community plugins**.

## Quick start

1. Open the plugin settings and fill in your S3 configuration:
   - `Access key ID`
   - `Secret access key`
   - `Region`
   - `Bucket`
   - `Endpoint` (usually required for S3-compatible services)
2. Set the upload path template. Default: `{year}/{month}/{fullName}`.
3. Set the output URL template. Default: `{endpoint}/{bucket}/{path}`.
4. Run commands from the command palette:
   - `Upload all images`
   - `Download all images`

## Commands

- `Upload all images`: Scan links in the current note and upload supported files.
- `Download all images`: Download remote resources in the current note and replace them with local links.

## Context menu

In the file explorer, the following action is available from the context menu for supported file types:

- `Upload to S3`

After execution, the plugin automatically replaces all Markdown references to that file, including standard links and embeds.

## Supported link formats

### Markdown format

- `![alt](<./path/image.png>)`
- `![alt](./path/image.png)`
- `![alt](image.png "title")`
- `![alt](https://example.com/file)`
- `[text](./path/file.pdf)`

### Wiki format

- `![[image.png]]`
- `![[image.png|alias]]`

## Settings

### Basic settings

- `Custom endpoint`: Usually required for S3-compatible services.
- `Access key ID / Secret access key`: Credentials used for S3 authentication.
- `Region`: For example, `us-east-1`.
- `Bucket`: Target bucket name.
- `Force path style`: Required by some S3-compatible providers.

### Path and URL templates

- `Upload path template (uploadPathTemplate)`: Controls the object key.
- `Output URL template (outputURLTemplate)`: Controls the URL written back into the note.

Supported placeholders:

- Time: `{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}` `{millisecond}`
- Timestamp: `{timestamp}` `{timestampMS}`
- File name: `{fullName}` `{fileName}` `{extName}`
- Hash: `{md5}` `{sha1}` `{sha256}`
- URL: `{endpoint}` `{bucket}` `{path}`

### Automatic upload and remote resources

- `Apply to network images (workOnNetWork)`: Process remote resources during upload and paste operations.
- `Network image domain blacklist (newWorkBlackDomains)`: Comma-separated list.
- `Delete source file after upload (deleteSource)`: Remove the local source file after a successful upload.
- `Auto upload from clipboard (uploadByClipboardSwitch)`
- `Upload image when both text and image exist in clipboard (applyImage)`
- `Auto upload on drag and drop (uploadByDropSwitch)`

### Download settings

- `Download proxy (downloadProxy)`: Build the final request address with the `{url}` placeholder.
- `Referer rules (refererRules)`: One rule per line in the format `domain,referer`.

### Type allowlists

- `Allowed image extensions (allowedImageTypes)`
- `Allowed file extensions (allowedFileTypes)`

Only file types in the allowlists will be processed for upload or download.

## Frontmatter controls

You can override the automatic upload switch for a note with `image-auto-upload` in frontmatter:

```yaml
image-auto-upload: true
```

For hotlink-protected downloads, the plugin will also try to read a Referer value from the current note frontmatter using any of these keys:

- `referer`
- `referrer`
- `source`
- `origin`

## Development

```bash
npm install
npm run dev
```

Build the production bundle:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

## Release

1. Update `version` in `manifest.json`.
2. Update `versions.json` with the mapping from plugin version to minimum Obsidian version.
3. Create a GitHub release with the same tag name, without a leading `v`.
4. Upload `main.js`, `manifest.json`, and `styles.css` as release assets.

## Notes

- Make sure the bucket has the correct write permissions.
- If you want generated links to be directly accessible, configure object read permissions or a CDN policy.
- Test templates and permission settings in a test vault before using them in production.

## References

This project draws on ideas from existing community plugins and adapts them to the current plugin requirements:

- Hotlink-protected downloads with Referer support:
  - https://github.com/lovelyjuice/hotlink-protection-image-downloader
- Obsidian image auto-upload interactions and workflow:
  - https://github.com/renmu123/obsidian-image-auto-upload-plugin