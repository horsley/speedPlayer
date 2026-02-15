# Speed Player

一个带后端转接的网页播放器：

- 后端配置 WebDAV 地址与账号，不在前端暴露凭据
- 前端调用本地 API，规避播放器与 WebDAV 跨域问题
- 歌单支持本地缓存，默认优先读取缓存，并提供“刷新列表”强制同步
- 递归读取多层目录，支持常见音频格式（`mp3`、`wav`、`flac`、`m4a` 等）
- 播放 / 暂停、快退 5 秒 / 快进 5 秒
- 慢速播放（内置 80%、85%、90%，并支持滑杆调整）
- 移动端播放器固定在页面底部，操作无需滚动到下方

## 1. 配置后端环境变量

```bash
export WEBDAV_URL="https://example.com/remote.php/dav/files/user/music/"
export WEBDAV_USERNAME="your-user"
export WEBDAV_PASSWORD="your-password"
```

可选：

```bash
export PORT=5173
export HOST=0.0.0.0
```

## 2. 启动服务

```bash
node server.js
```

浏览器访问：

```text
http://localhost:5173
```

## 3. 接口说明

- `GET /api/tracks`：递归扫描 WebDAV 并返回歌曲列表
- `GET /api/stream?path=<relativePath>`：按路径转发音频流（支持 `Range`）

## 4. 注意事项

- 后端需要能访问 WebDAV。
- 部分 WebDAV 服务可能对 `PROPFIND` 或 `Range` 有限制，若播放异常请先确认服务端策略。
