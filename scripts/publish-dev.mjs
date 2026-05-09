import { cpSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgValue(argv, key) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg.startsWith(`${key}=`)) {
            return arg.slice(`${key}=`.length).trim();
        }
        if (arg === key) {
            return (argv[i + 1] ?? "").trim();
        }
    }
    return "";
}

function readPluginId() {
    const manifestRaw = readFileSync("manifest.json", "utf8");
    const manifest = JSON.parse(manifestRaw);
    return String(manifest.id ?? "").trim();
}

function expandHomeDir(inputPath) {
    if (inputPath === "~") {
        return os.homedir();
    }
    if (inputPath.startsWith("~/")) {
        return path.join(os.homedir(), inputPath.slice(2));
    }
    return inputPath;
}

function resolveDest(argv) {
    const destFromArg = expandHomeDir(parseArgValue(argv, "--dest"));
    if (destFromArg) {
        return destFromArg;
    }

    const destFromEnv = expandHomeDir(
        (process.env.DEST ?? process.env.npm_config_dest ?? "").trim(),
    );
    if (destFromEnv) {
        return destFromEnv;
    }

    const vaultFromArg = expandHomeDir(parseArgValue(argv, "--vault"));
    const vaultFromEnv = (
        process.env.OBSIDIAN_VAULT ??
        process.env.npm_config_obsidian_vault ??
        process.env.npm_config_vault ??
        ""
    ).trim();
    const vault = expandHomeDir(vaultFromArg || vaultFromEnv).trim();
    if (!vault) {
        return "";
    }

    const pluginId = readPluginId();
    if (!pluginId) {
        return "";
    }

    return path.join(vault, ".obsidian", "plugins", pluginId);
}

const dest = resolveDest(process.argv.slice(2));
if (!dest) {
    console.error("错误: 请指定发布目标。可用方式:");
    console.error("1) --dest=/path/to/plugin-dir");
    console.error("2) --vault=/path/to/vault");
    console.error("3) 环境变量 OBSIDIAN_VAULT=/path/to/vault");
    console.error("示例: npm run publish-dev -- --vault=/path/to/vault");
    process.exit(1);
}

mkdirSync(dest, { recursive: true });

const artifacts = ["main.js", "manifest.json", "styles.css"];
for (const file of artifacts) {
    cpSync(file, path.join(dest, file));
}

console.log(`已发布到: ${dest}`);
