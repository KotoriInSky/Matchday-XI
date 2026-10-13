# GitHub Pages 部署指南

Matchday XI 适合用 GitHub Pages 托管在线编辑器。公共仓库配合 GitHub Actions 可以构建和发布。PNG／ZIP 与支持 WebCodecs 的 MP4 可在浏览器导出；本地渲染和手动 Actions 工作流作为备用，详见[导出指南](export.md)。

## 选择仓库和网址

本项目使用 [KotoriInSky/Matchday-XI](https://github.com/KotoriInSky/Matchday-XI)，网站地址是 [https://kotoriinsky.github.io/Matchday-XI/](https://kotoriinsky.github.io/Matchday-XI/)。项目部署路径为 `/Matchday-XI/`，区分大小写；本地开发默认路径仍为 `/matchday-xi/`。

如果希望应用直接出现在首页，仓库必须命名为 `<用户名>.github.io`，网址是 `https://<用户名>.github.io/`。组织仓库使用组织名。工作流自动适配两种情况，无需修改源码。

自行部署时，将文档中的账号和仓库名替换为自己的；工作流会按仓库名计算发布路径。

## 首次上传

以下命令供从源码副本创建新仓库时参考。当前项目已有远端，默认分支为 `main`。如果 GitHub 仓库已有提交，应先获取并保留其历史，再提交项目文件。

在项目目录用 PowerShell 执行以下命令。把远端地址替换成刚创建的仓库地址：

```powershell
git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Prepare Matchday XI for GitHub Pages"
git remote add origin https://github.com/<username>/matchday-xi.git
git push -u origin main
```

提交前检查待提交列表：

- 包含 `src/`、`server/`、`public/`、`.github/`、文档、配置文件和 `package-lock.json`。
- `.gitignore` 排除了依赖、构建结果、测试输出、环境文件和日志。
- 演示图片或视频只使用原创或有明确许可的素材。参考录屏、广播截图及私人项目文件不作为演示素材提交。

## 开启网站

1. 在仓库 **Settings → Pages → Build and deployment** 将 **Source** 设为 **GitHub Actions**。
2. 在 **Actions** 找到 **Deploy to GitHub Pages**。第一次推送如果早于 Pages 配置，请点 **Run workflow**，选择 `main` 再运行。
3. 等待 `build` 和 `deploy` 完成，打开部署环境输出的网址。
4. 后续推送到 `main` 会自动部署。Pull request 只执行检查。
5. 网站成功上线后，将真实网站链接加入仓库 **About → Website** 和 README。

安装与构建使用 Node.js 22、`npm ci`、`npm run typecheck` 和 `npm run build`。部署权限仅赋予部署任务，不需要在仓库保存个人访问令牌。

## 自定义域名或路径

默认构建路径由仓库名决定。需要覆盖时，在 **Settings → Secrets and variables → Actions → Variables** 新增仓库变量 `BASE_PATH`：

| 使用方式 | `BASE_PATH` |
| --- | --- |
| 普通仓库 `matchday-xi` | 默认 `/matchday-xi/`，无需设置 |
| 用户或组织首页仓库 | 默认 `/`，无需设置 |
| 自定义域名的根目录 | `/` |
| 其他子路径 | `/你的路径/`，保留开头和结尾斜线 |

绑定自定义域名时，还要在 **Settings → Pages → Custom domain** 配置域名，并按 GitHub 文档设置 DNS、域名验证及 HTTPS。仅设置 `BASE_PATH` 不会绑定域名。

本地验证根路径构建的 PowerShell 命令：

```powershell
$env:BASE_PATH = '/'
npm run build
npm run preview
# 完成后移除本次终端会话的覆盖值
Remove-Item Env:BASE_PATH
```

不同路径构建会覆盖 `dist/`。本地默认开发路径仍为 `/matchday-xi/`，除非设置了 `BASE_PATH`。

## 从在线编辑到本地交付

1. 在线编辑器「备份 → 下载项目」，保存 `matchday-lineup.json`。
2. 下载或克隆代码，运行 `npm ci` 和 `npm run dev`。
3. 在 Vite 输出的本地地址打开编辑器，然后「备份 → 导入项目」。
4. 如使用背景视频，重新选择原视频。它不包含在 JSON 中。
5. 配置 Chrome／Chromium；导出 MP4 时再配置 FFmpeg，随后下载成品。

Pages 上的页面不会自动连接本机渲染器。当前服务仅接受 localhost 同源请求，也不能直接部署为公网导出 API。

## 常见问题

- **页面空白、脚本 404：** 检查仓库名与 `BASE_PATH`，确认部署来自当前 `main`。普通仓库必须使用带仓库名的完整网址。
- **部署权限或 Pages 未启用：** 检查 Source 是否是 GitHub Actions，是否允许仓库运行 Actions，以及 `github-pages` 环境是否限制了 `main`。
- **线上不能导出 MP4：** 检查浏览器对当前规格的 H.264 编码支持，可降低分辨率／帧率或使用新版 Chrome／Edge。仍不支持时，使用本地渲染或手动 Actions。PNG／ZIP 无需视频编码器。
- **更换网址后阵容不见了：** 保存与网站来源绑定，不会跨域同步。同域不同项目路径也不等于独立存储；切换前下载 JSON 备份。
- **字体显示不同：** 检查本站 `fonts/` 资源是否完整部署、`BASE_PATH` 是否正确；内置字体无需连接 Google Fonts。

官方说明：[GitHub Pages 入门](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[自定义域名](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)。
