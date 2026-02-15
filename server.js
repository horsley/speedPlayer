const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontenttype/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "webm",
]);

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";

const config = loadConfig();

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (requestUrl.pathname === "/api/tracks") {
      await handleTracks(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/stream") {
      await handleStream(req, res, requestUrl);
      return;
    }

    await serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器内部错误。" });
  }
});

server.on("error", (error) => {
  console.error(`服务启动失败：${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Speed Player 已启动：http://${HOST}:${PORT}`);
  console.log(`WebDAV 根目录：${config.webdavUrl}`);
});

function loadConfig() {
  const webdavUrl = process.env.WEBDAV_URL;
  if (!webdavUrl) {
    console.error("缺少 WEBDAV_URL。请在启动前设置 WebDAV 根目录地址。");
    process.exit(1);
  }

  let normalizedUrl;
  try {
    normalizedUrl = ensureTrailingSlash(webdavUrl);
  } catch {
    console.error("WEBDAV_URL 格式不合法。示例：https://example.com/music/");
    process.exit(1);
  }

  const username = process.env.WEBDAV_USERNAME || "";
  const password = process.env.WEBDAV_PASSWORD || "";

  return {
    webdavUrl: normalizedUrl,
    authHeader: buildAuthHeader(username, password),
  };
}

async function handleTracks(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  try {
    const tracks = await crawlWebDav(config.webdavUrl, config.authHeader);
    sendJson(res, 200, { tracks });
  } catch (error) {
    sendJson(res, 502, { error: error.message || "读取 WebDAV 目录失败。" });
  }
}

async function handleStream(req, res, requestUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendMethodNotAllowed(res, "GET, HEAD");
    return;
  }

  const relativePath = requestUrl.searchParams.get("path");
  if (!relativePath) {
    sendJson(res, 400, { error: "缺少 path 参数。" });
    return;
  }

  if (!isSafeRelativePath(relativePath)) {
    sendJson(res, 400, { error: "非法 path 参数。" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = buildFileUrl(config.webdavUrl, relativePath);
  } catch {
    sendJson(res, 400, { error: "path 参数格式错误。" });
    return;
  }

  const headers = {};
  if (config.authHeader) {
    headers.Authorization = config.authHeader;
  }
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: "follow",
    });
  } catch {
    sendJson(res, 502, { error: "无法连接 WebDAV 读取音频。" });
    return;
  }

  if (upstream.status === 401 || upstream.status === 403) {
    sendJson(res, 502, { error: "WebDAV 鉴权失败，请检查后端凭据。" });
    return;
  }

  if (!upstream.ok && upstream.status !== 206) {
    sendJson(res, 502, { error: `读取音频失败：HTTP ${upstream.status}` });
    return;
  }

  const passHeaders = [
    "content-type",
    "content-length",
    "accept-ranges",
    "content-range",
    "etag",
    "last-modified",
    "cache-control",
  ];

  for (const headerName of passHeaders) {
    const value = upstream.headers.get(headerName);
    if (value) {
      res.setHeader(headerName, value);
    }
  }

  res.statusCode = upstream.status;

  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendMethodNotAllowed(res, "GET, HEAD");
    return;
  }

  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }

  const filePath = path.join(__dirname, fileName);

  try {
    const content = await fs.promises.readFile(filePath);
    const ext = path.extname(fileName);
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.statusCode = 200;

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    res.end(content);
  } catch {
    sendJson(res, 500, { error: "读取静态文件失败。" });
  }
}

function sendMethodNotAllowed(res, allow) {
  res.setHeader("Allow", allow);
  sendJson(res, 405, { error: "Method Not Allowed" });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function buildAuthHeader(username, password) {
  if (!username && !password) {
    return "";
  }

  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function ensureTrailingSlash(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  url.hash = "";
  return url.toString();
}

function normalizeDirectoryUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  url.hash = "";
  return url.toString();
}

function normalizeResourceUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  url.hash = "";
  return url.toString();
}

function safeDecodePath(pathname) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

function buildRelativePath(rootUrl, fileUrl) {
  const root = new URL(ensureTrailingSlash(rootUrl));
  const file = new URL(fileUrl, root);
  const rootPath = safeDecodePath(root.pathname);
  const filePath = safeDecodePath(file.pathname);

  if (filePath.startsWith(rootPath)) {
    return filePath.slice(rootPath.length);
  }

  return filePath.replace(/^\/+/, "");
}

function getFileNameFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const segments = safeDecodePath(url.pathname).split("/").filter(Boolean);
  return segments[segments.length - 1] || safeDecodePath(url.pathname);
}

function isAudioResource(resourceUrl, contentType) {
  if (contentType && contentType.toLowerCase().startsWith("audio/")) {
    return true;
  }

  const pathname = new URL(resourceUrl).pathname;
  const extension = pathname.split(".").pop()?.toLowerCase() || "";
  return SUPPORTED_AUDIO_EXTENSIONS.has(extension);
}

async function crawlWebDav(rootUrl, authHeader) {
  const queue = [ensureTrailingSlash(rootUrl)];
  const visited = new Set();
  const tracks = new Map();

  while (queue.length) {
    const currentDir = normalizeDirectoryUrl(queue.shift());
    if (visited.has(currentDir)) {
      continue;
    }

    visited.add(currentDir);
    const resources = await propfind(currentDir, authHeader);

    for (const resource of resources) {
      if (!resource.url) {
        continue;
      }

      if (resource.isDirectory) {
        const directoryUrl = normalizeDirectoryUrl(resource.url);
        if (directoryUrl !== currentDir && !visited.has(directoryUrl)) {
          queue.push(directoryUrl);
        }
        continue;
      }

      if (!isAudioResource(resource.url, resource.contentType)) {
        continue;
      }

      const normalizedFileUrl = normalizeResourceUrl(resource.url);
      if (tracks.has(normalizedFileUrl)) {
        continue;
      }

      const relativePath = buildRelativePath(rootUrl, normalizedFileUrl);
      tracks.set(normalizedFileUrl, {
        name: resource.displayName || getFileNameFromUrl(normalizedFileUrl),
        relativePath: relativePath || getFileNameFromUrl(normalizedFileUrl),
      });
    }
  }

  return Array.from(tracks.values()).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

async function propfind(directoryUrl, authHeader) {
  const headers = {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
  };

  if (authHeader) {
    headers.Authorization = authHeader;
  }

  let response;
  try {
    response = await fetch(directoryUrl, {
      method: "PROPFIND",
      headers,
      body: PROPFIND_BODY,
    });
  } catch {
    throw new Error("连接 WebDAV 失败。请检查地址或网络。");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("WebDAV 鉴权失败，请检查后端凭据。");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`WebDAV 请求失败：HTTP ${response.status}`);
  }

  const xmlText = await response.text();
  return parsePropfindResponse(xmlText, directoryUrl);
}

function parsePropfindResponse(xmlText, baseUrl) {
  const responseBlocks = xmlText.match(/<[^>]*:?response\b[\s\S]*?<\/[^>]*:?response>/gi) || [];

  return responseBlocks
    .map((responseBlock) => {
      const hrefRaw = extractTagText(responseBlock, "href");
      if (!hrefRaw) {
        return null;
      }

      let absoluteUrl;
      try {
        absoluteUrl = new URL(hrefRaw, baseUrl).toString();
      } catch {
        return null;
      }

      const propBlock = pickStatus200Prop(responseBlock);
      const displayName = extractTagText(propBlock, "displayname");
      const contentType = extractTagText(propBlock, "getcontenttype");
      const resourceTypeRaw = extractTagInner(propBlock, "resourcetype");
      const isDirectory = /<[^>]*:?collection(?:\s|\/|>)/i.test(resourceTypeRaw);

      return {
        url: absoluteUrl,
        displayName,
        contentType,
        isDirectory,
      };
    })
    .filter(Boolean);
}

function pickStatus200Prop(responseBlock) {
  const propStats = responseBlock.match(/<[^>]*:?propstat\b[\s\S]*?<\/[^>]*:?propstat>/gi) || [];

  for (const propStat of propStats) {
    const status = extractTagText(propStat, "status");
    if (/\s200\s/.test(status)) {
      const prop = extractTagInner(propStat, "prop");
      if (prop) {
        return prop;
      }
    }
  }

  return extractTagInner(responseBlock, "prop");
}

function extractTagText(xmlText, tagName) {
  const inner = extractTagInner(xmlText, tagName);
  if (!inner) {
    return "";
  }

  return decodeXml(inner.replace(/<[^>]*>/g, "")).trim();
}

function extractTagInner(xmlText, tagName) {
  if (!xmlText) {
    return "";
  }

  const pattern = new RegExp(
    `<[^>]*:?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tagName}>`,
    "i",
  );
  const match = xmlText.match(pattern);
  return match ? match[1] : "";
}

function decodeXml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isSafeRelativePath(relativePath) {
  if (!relativePath || relativePath.includes("\0")) {
    return false;
  }

  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);

  if (!segments.length) {
    return false;
  }

  return !segments.some((segment) => segment === "." || segment === "..");
}

function buildFileUrl(rootUrl, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return new URL(encodedPath, ensureTrailingSlash(rootUrl)).toString();
}
