// The file types the knowledge base accepts. Kept apart from parse.ts so the browser can use it without
// pulling in the server-side parsers.
const CODE = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "html", "css", "scss", "json", "yaml", "yml", "toml", "xml", "lua", "r", "scala", "dart"];

export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "xlsx", "csv", "md", "markdown", "txt", "text", "log", ...CODE, "png", "jpg", "jpeg", "webp", "gif"];
export const CODE_EXTENSIONS = new Set(CODE);
