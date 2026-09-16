const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.action === "status") {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: {
      available: true, provider: "rapidocr_onnxruntime", model: "PP-OCRv6-small",
      localFirst: true, offline: true, pid: process.pid, pythonBundled: true,
    } }) + "\n");
    return;
  }
  if (request.action === "recognize") {
    if (String(request.path).includes("crash")) process.exit(23);
    if (String(request.path).includes("hang")) return;
    if (String(request.path).includes("noise")) process.stdout.write("library diagnostic on stdout\n");
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: {
      success: true, provider: "rapidocr_onnxruntime", model: "PP-OCRv6-small", pageCount: 1,
      pages: [{ page: 1, markdown: `中文识别:${request.path}` }], durationMs: 2,
    } }) + "\n");
    return;
  }
  if (request.action === "shutdown") {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { stopping: true } }) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: "unknown action" }) + "\n");
});
