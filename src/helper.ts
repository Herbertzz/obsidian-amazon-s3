import imageType from "image-type";
import { MarkdownView, App } from "obsidian";
import { parse } from "path-browserify";
import { FileData } from "types";

interface Image {
  path: string;
  name: string;
  source: string;
}

// ![](./dsa/aa.png) local image should has ext, support ![](<./dsa/aa.png>), support ![](image.png "alt")
// ![](https://dasdasda) internet image should not has ext
const REGEX_FILE =
  /\!\[(.*?)\]\(<(\S+\.\w+)>\)|\!\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|\!\[(.*?)\]\((https?:\/\/.*?)\)/g;
const REGEX_WIKI_FILE = /\!\[\[(.*?)(\s*?\|.*?)?\]\]/g;

export default class Helper {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  // 获取当前文件的 frontmatter 对象
  getFrontmatter(): Record<string, any> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return {};
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    return cache?.frontmatter ?? {};
  }

  // 获取 frontmatter 中指定 key 的值，若不存在则返回默认值
  getFrontmatterValue<T>(key: string, defaultValue: T|undefined = undefined): T|undefined {
    let value = defaultValue;
    const frontmatter = this.getFrontmatter();
    if (frontmatter.hasOwnProperty(key)) {
      value = frontmatter[key] as T;
    }
    return value;
  }

  getEditor() {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView) {
      return mdView.editor;
    } else {
      return null;
    }
  }

  getValue() {
    const editor = this.getEditor();
    return editor?.getValue();
  }

  setValue(value: string) {
    const editor = this.getEditor();
    if (!editor) {
        return;
    }

    const { left, top } = editor.getScrollInfo();
    const position = editor.getCursor();

    editor.setValue(value);
    editor.scrollTo(left, top);
    editor.setCursor(position);
  }

  // get all file urls, include local and internet
  getAllFiles(): Image[] {
    const editor = this.getEditor();
    if (!editor) {
      return [];
    }

    return this.getImageLink(editor.getValue());
  }

  getImageLink(value: string): Image[] {
    const matches = value.matchAll(REGEX_FILE);
    const WikiMatches = value.matchAll(REGEX_WIKI_FILE);

    let fileArray: Image[] = [];

    for (const match of matches) {
      const source = match[0];

      const name = match[1] ?? match[3] ?? match[5] ?? "";
      const path = match[2] ?? match[4] ?? match[6] ?? "";

      fileArray.push({
        path: path,
        name: name,
        source: source,
      });
    }

    for (const match of WikiMatches) {
      let name = parse(match[1] ?? '').name;
      const path = match[1] ?? "";
      const source = match[0];
      if (match[2]) {
        name = `${name}${match[2]}`;
      }
      fileArray.push({
        path: path,
        name: name,
        source: source,
      });
    }

    return fileArray;
  }

  hasBlackDomain(src: string, blackDomains: string) {
    if (blackDomains.trim() === "") {
      return false;
    }
    const blackDomainList = blackDomains.split(",").filter(item => item !== "");
    let url = new URL(src);
    const domain = url.hostname;

    return blackDomainList.some(blackDomain => domain.includes(blackDomain));
  }

  // 生成 Markdown 文件链接
  async makeFileLink(buffer: ArrayBuffer, path: string, name: string = ''): Promise<string> {
    const imagetype = await imageType(buffer);
    if (imagetype) {
        return `![${name}](${encodeURI(path)})`
    }
    return `[${name}](${encodeURI(path)})`
  }
}