import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { createRequire } from "node:module";
import mammoth from "mammoth";
import type pdfParser from "pdf-parse";
import readXlsxFile from "read-excel-file/node";

// The package root runs its bundled demo when loaded by some ESM test runners.
// Loading the library entry directly avoids that side effect.
const pdf = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as typeof pdfParser;

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml",
  ".html", ".htm", ".xml", ".log", ".sql", ".js", ".jsx", ".ts", ".tsx", ".py",
  ".java", ".go", ".rs", ".toml", ".ini", ".conf",
]);
const BINARY_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx"]);
const VISUAL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"]);
const IGNORED_DIRECTORIES = new Set([".git", ".svn", "node_modules", "dist", "dist-electron", "build", ".cache"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_CHARACTERS = 140_000;
const MAX_FOLDER_FILES = 300;
const MAX_FOLDER_CHARACTERS = 700_000;

export const KNOWLEDGE_EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS, ...VISUAL_EXTENSIONS];
export const OCR_VISUAL_EXTENSIONS = [".pdf", ...VISUAL_EXTENSIONS];

export interface ExtractedKnowledge {
  sourcePath: string;
  name: string;
  extension: string;
  text: string;
  bytes: number;
}

export async function extractKnowledgeFile(sourcePath: string): Promise<ExtractedKnowledge | undefined> {
  const extension = extname(sourcePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension) && !VISUAL_EXTENSIONS.has(extension)) return undefined;
  const fileStat = await stat(sourcePath);
  if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) return undefined;

  let text = "";
  if (TEXT_EXTENSIONS.has(extension)) {
    text = await readFile(sourcePath, "utf8");
    if (extension === ".html" || extension === ".htm") text = htmlToText(text);
  } else if (extension === ".pdf") {
    text = (await pdf(await readFile(sourcePath))).text;
  } else if (extension === ".docx") {
    text = (await mammoth.extractRawText({ path: sourcePath })).value;
  } else if (extension === ".xlsx") {
    const rows = await readXlsxFile(sourcePath);
    text = rows.map((row) => row.map((cell) => cell === null ? "" : String(cell).replace(/\t/g, " ")).join("\t")).join("\n");
  } else if (VISUAL_EXTENSIONS.has(extension)) {
    text = "[视觉原件已保留。Claude Agent SDK 可在相关任务中按需调用内置离线 PP-OCRv6；复杂版面可选 PaddleOCR-VL 增强。应用不预判也不自动路由。]";
  }

  const normalized = sanitizeExtractedText(text).slice(0, MAX_FILE_CHARACTERS);
  if (!normalized) return undefined;
  return { sourcePath, name: basename(sourcePath), extension, text: normalized, bytes: fileStat.size };
}

export async function extractKnowledgeFolder(rootPath: string): Promise<{
  content: string;
  files: number;
  bytes: number;
  formats: string[];
  visualFiles: string[];
}> {
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error("请选择一个知识库文件夹。");
  const paths: string[] = [];
  await walk(rootPath, paths);

  const chunks: string[] = [];
  const formats = new Set<string>();
  let bytes = 0;
  let characters = 0;
  let files = 0;
  const visualFiles: string[] = [];
  for (const sourcePath of paths.slice(0, MAX_FOLDER_FILES)) {
    if (characters >= MAX_FOLDER_CHARACTERS) break;
    try {
      const extracted = await extractKnowledgeFile(sourcePath);
      if (!extracted) continue;
      const excerpt = extracted.text.slice(0, MAX_FOLDER_CHARACTERS - characters);
      chunks.push(`## ${relative(rootPath, sourcePath).replace(/\\/g, "/")}\n\n${excerpt}`);
      characters += excerpt.length;
      bytes += extracted.bytes;
      files += 1;
      formats.add(extracted.extension.slice(1).toUpperCase());
      if (OCR_VISUAL_EXTENSIONS.includes(extracted.extension)) visualFiles.push(sourcePath);
    } catch {
      // A broken or password-protected file must not abort the rest of a folder import.
    }
  }
  if (!files) throw new Error("文件夹中没有可读取的知识文件。支持文本、Markdown、JSON、CSV、PDF、DOCX、XLSX、HTML 等格式。");
  return {
    content: `# 本地文件夹知识库\n\n来源目录：${rootPath}\n\n${chunks.join("\n\n---\n\n")}`,
    files,
    bytes,
    formats: [...formats].sort(),
    visualFiles,
  };
}

async function walk(directory: string, output: string[]): Promise<void> {
  if (output.length >= MAX_FOLDER_FILES) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= MAX_FOLDER_FILES) break;
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(fullPath, output);
    } else if (entry.isFile()) {
      const extension = extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension) || VISUAL_EXTENSIONS.has(extension)) output.push(fullPath);
    }
  }
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function sanitizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
