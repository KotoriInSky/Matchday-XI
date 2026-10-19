# 导出：浏览器、本地与 GitHub Actions

## 浏览器导出（默认）

- 单张：球员浮窗选择小卡／大卡／Highlight，再导出 PNG。
- 批量：「备份 → 卡片导出」选择球员、卡片类型与尺寸，下载 ZIP。
- 卡框长边：1024、2048、4096 px。同类卡框保持一致尺寸；出框人物、标签和阴影向外扩展透明画布，因此 PNG 实际尺寸可能超过所选长边。
- 视频：「备份 → 视频导出」，方式选择「浏览器」。提供 720p、1080p、1440p（2K）、2160p，30／60 fps，H.264 MP4，无音轨。
- 浏览器会检测当前规格的编码支持。分辨率不会静默降低；不支持时调整规格、换新版 Chrome／Edge，或使用备用方案。
- 导出期间保持页面在前台，支持取消。浏览器支持时，导出文件逐步写入本站的浏览器临时存储；不可用时回退内存缓冲。刷新前保存，单张卡片须在关闭浮窗前保存。重新导出失败会保留上次结果。
- 素材不上传；内置字体从本站加载，无需连接 Google Fonts。原始图片清晰度和设备内存仍会限制实际效果与可用尺寸。

浏览器绘制复用现有 HTML/CSS 卡片与动画时间轴，将计算后的样式、伪元素、图片与所需字体嵌入 SVG，再绘制到目标尺寸 Canvas；视频逐帧交给 WebCodecs，由 Mediabunny 封装 MP4，不使用屏幕录制。没有另建一套近似的卡片布局。SVG/Canvas 与 Chromium 截图可能有细微抗锯齿差异；对严格转播交付可使用本地或 Actions 渲染。Chrome 已实测，其他浏览器及真实手机尚未全面验证。

视频复用透明 Canvas，并共享同一帧内相同的计算样式，减少样式复制和整帧搬运。Canvas 捕获按输出时间采样，原生截图保留绘制等待。MP4 预留头部元数据空间，分块写出；批量卡片逐张写入 ZIP，浏览器和本地服务都无需先保留全部 PNG。下载链接释放后删除对应临时文件；其他标签页仍在使用的文件会保留，异常关闭留下的文件在下次导出时回收。临时存储不可用时仍可下载，但大文件会占用更多内存。

捕获只读取文档样式、行内样式和动画实际使用的属性，并保留字体与语言所需的默认值；每帧重新收集属性及计算值，兼容动态规则、伪元素、遮罩和 Web Animations。遇到无法读取的样式表或 `all` 声明时，回退完整属性捕获。内部保留完整属性参考路径，供像素对照测试使用。

## GitHub Actions 手动导出

1. 将项目代码放到自己的 GitHub 仓库，启用 Actions。工作流必须已存在于默认分支。
2. 网页「备份 → 下载项目」。把 JSON 上传到仓库，例如 `exports/project.json`。
3. 打开 **Actions → Render project → Run workflow**。
4. 填写项目路径；输出选择 `video` 或 `cards`。视频选择高度和帧率；卡片填写尺寸、类型 `small,big,key` 和球员槽位 `all` 或 `1,2,3`。槽位不是球衣号码。
5. 运行结束后打开该次任务，在 **Artifacts** 下载结果，默认保留三天。

照片、自定义字体和队徽会随 JSON 上传。私人素材请使用私有仓库；删除文件的新提交不会移除旧提交内容。背景视频不包含在 JSON 内，需单独上传并填写 `background_video`，也可在下载项目之前改用图片或纯色背景。GitHub 文件上传限制、Actions 运行额度和仓库权限仍适用。

该工作流不接收网页访客任务，不需要把 token 放进前端，不构成公共云渲染 API。输入通过环境变量传递，文件路径必须位于仓库内；仅授予仓库读取权限，不推送生成文件。输出由 artifact 保存，不进入 Pages 构建。

## 本地备用

本地项目安装 Chrome／Chromium 与 FFmpeg 后，在视频导出中选择「本地渲染服务」。下载保留 30 分钟。卡片仍默认由浏览器生成；需要 Chromium 截图方式时使用脚本：

```powershell
$env:PROJECT_FILE = 'exports/project.json'
$env:EXPORT_KIND = 'cards' # 或 video
$env:CARD_TYPES = 'small,big,key'
$env:CARD_PLAYERS = 'all'
$env:CARD_SIZE = '2048'
npm run render:project
```

脚本会临时启动本地服务，输出至 `.export-output/`，结束后关闭自己启动的服务。视频规格通过 `EXPORT_HEIGHT`、`EXPORT_FPS` 设置。

网页与脚本使用二进制流上传背景视频，服务端直接写入任务临时文件，不再转为 base64 放入 JSON 或传给渲染页。渲染页使用任务专属同源 URL，支持 Range 分段读取与跳转；视频上限 200 MiB，项目 JSON 上限仍为 200 MiB。未完成上传的任务最多保留 30 分钟，取消、断线或失败会关闭写入并删除任务；渲染完成后删除输入视频，只保留下载结果。旧 JSON 视频请求仍兼容。脚本使用 Node 22 的文件 Blob 上传，结果逐块下载，下载成功后才替换输出文件。

## 验证

- `npm run test:browser-export`：PNG 实际尺寸、透明边界、两套模板、选定组合 ZIP、取消、真实 H.264 MP4，禁止调用本地 API。
- `npm run test:export-resources`：两套动画的固定时间点像素、Canvas 复用、离线帧调度，以及画面捕获耗时；可用 `EXPORT_BASELINE=1` 保存优化前的对照数据。
- `npm run test:export-storage`：临时文件与内存回退、MP4 所需的随机写入、增量 ZIP、取消、下载生命周期和跨任务文件回收。
- `npm run test:export-styles`：精简与完整样式捕获逐像素对照，覆盖动态行内样式、规则增删、伪元素、动画、简写属性和回退。
- `npm run test:export-upload`：二进制上传、Range 读取、大小限制、上传中断和任务槽位回收，无需启动页面。
- `npm run test:export-upload-client`：创建任务返回前取消、上传取消／失败清理和旧 JSON 客户端兼容；`npm run test:export-media` 验证网页实际上传、背景循环及 H.264 MP4。
- `npm run bench:export-upload`：隔离进程比较旧 JSON／base64 与二进制上传，记录服务端 RSS、JS 堆和缓冲区峰值增量；默认输入 64 MiB，可用 `UPLOAD_BENCH_MIB` 调整。结果保存至 `test-results/export-upload-benchmark.json`，不代表浏览器、GPU、编码器或完整导出的内存峰值。
- `npm run build` 后 `npm run test:static-export`：只提供静态文件，通过 UI 下载 PNG／MP4，验证无编码器提示与移动布局。
- `npm run render:project`：Actions 所用脚本已本地验证 PNG ZIP 与 720p MP4。工作流尚未在 GitHub 运行，首次上传后需在那里核验 runner 环境。
