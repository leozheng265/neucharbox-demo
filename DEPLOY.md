# Deploying the NeuCharBox live demo · 部署说明

This is a **static site**: one folder of HTML, CSS and JavaScript. No build step,
no Node, no database, no environment variables, no external requests (the 3D
library is vendored in `vendor/`). Serving it means copying the folder to any
web server or static host.

这是一个**纯静态站点**：一个包含 HTML、CSS 和 JavaScript 的文件夹。无需构建、无需
Node、无数据库、无环境变量、无外部请求（3D 库已内置在 `vendor/` 中）。部署就是把
整个文件夹放到任意 Web 服务器或静态托管上。

## Requirements · 要求

1. **Serve over HTTPS.** WebGL and the Kickstarter link both expect it.
   必须使用 HTTPS。
2. **Host outside mainland China.** Visitors are Kickstarter backers, mostly in
   North America and Europe; a mainland server is slow for them and needs an ICP
   filing. Good options: Alibaba Cloud OSS + CDN in Hong Kong or Singapore,
   Cloudflare Pages, Vercel, Netlify, GitHub Pages.
   服务器请放在中国大陆以外（访问者主要在北美和欧洲，大陆服务器对他们很慢且需要
   ICP 备案）。推荐：阿里云香港/新加坡 OSS + CDN、Cloudflare Pages、Vercel、
   Netlify、GitHub Pages。
3. **Serve `.js` files with `Content-Type: text/javascript`.** Every host above
   does this by default. If you use Nginx or OSS with custom MIME settings,
   check it — ES modules will not run with a wrong MIME type.
   `.js` 文件必须以 `text/javascript` 类型返回（各大托管默认如此；自建 Nginx/OSS
   请检查 MIME 设置，否则 ES 模块无法运行）。
4. **Default cache headers are fine.** The page versions its own modules.
   缓存策略保持默认即可，页面会自行给模块加版本号。
5. **Domain:** add a CNAME record for `demo.neucharbox.com` pointing at the
   host, and enable HTTPS for it on the host side.
   域名：为 `demo.neucharbox.com` 添加指向托管的 CNAME 记录，并在托管侧开启 HTTPS。

## What to upload · 上传内容

Everything in this repository except `serve.py`, `test/` and `docs/` (those
are for development and can stay, they are harmless). The site root must be
this folder, so `index.html` is at `/`.

上传本仓库全部内容即可（`serve.py`、`test/`、`docs/` 仅用于开发，留着也无妨）。
站点根目录必须是本文件夹，即 `index.html` 位于 `/`。

## Check after deploying · 部署后检查

- `https://demo.neucharbox.com/` shows the scene picker.
- `https://demo.neucharbox.com/#home` loads the home scene, the room renders,
  and the browser console has no errors.
- Try it once on a phone.

## Local preview · 本地预览

```bash
python serve.py        # then open http://localhost:8765/
```

## Updating · 更新

Replace the files with the new version of the repository. If a scene file is
changed on a host with aggressive caching, bump `V` in `js/scenes/index.js`.

直接用新版本仓库文件覆盖即可。若托管缓存较激进且修改了场景文件，请把
`js/scenes/index.js` 中的 `V` 版本号加一。
