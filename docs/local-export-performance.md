# 本地视频导出：原始帧流

本轮沿用 FFmpeg 编解码、Mediabunny 浏览器编码／封装及 Node 标准流 API，不新增自研编码、缩放或上传解析算法。原始帧输入使用 FFmpeg 的 [rawvideo demuxer](https://ffmpeg.org/ffmpeg-formats.html#rawvideo)，背压及中断使用 Node 的 [pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options)。没有引入新的运行依赖。

## 实现

本地 4K 路径改为计算样式 SVG／Canvas → RGBA → 同源二进制请求 → Node 流 → FFmpeg／NVENC。保留原有画面捕获、软件读回 Canvas、编码质量及每 120 帧重建页面的策略，跳过逐帧 PNG 压缩、base64 返回及 FFmpeg PNG 解码。720p 对照没有稳定收益，故 720p／1080p／1440p 继续采用 PNG 传输；1080p／1440p 的独立收益尚待测量。状态 API 的 `frameFormat` 报告实际选择的 `rgba` 或 `png`。

每次只提交一帧；服务器逐块写入 FFmpeg，等待写入回调后才确认完成，浏览器收到确认后开始下一帧。Node 不拼接整个原始帧，也不将中间帧写盘。4K RGBA 单帧仍为 31.6 MiB，浏览器还需保留像素数组和 Blob，因此不声称全链路零复制或固定峰值内存。

专属帧端点校验任务、随机密钥、帧序号、类型和精确字节数；超长、截断或取消后的流不会继续追加帧。沿用本机 Host／Origin 检查及任务取消清理。

实测 Chromium 的 Fetch 请求拦截会把整个 POST 请求体额外复制进 CDP，Blob 和 FormData 也会发生。渲染文档先通过响应头安装 CSP，在加载后移除 HTTP 请求拦截；CSP 限制外部脚本、图片、视频、字体和连接，WebSocket 仍关闭。单独验证外部服务没有收到请求，以及 4K 像素没有再次出现在 CDP 请求体中。

## 复现

先执行 `npm run build`，再运行：

```powershell
$env:BENCH_PROJECT = 'E:/Downloads/matchday-lineup (1).json'
$env:BENCH_HEIGHT = '2160'
$env:BENCH_RUNS = '3'
$env:BENCH_VALIDATE = '1'
# 使用与驱动兼容的 FFmpeg；本机配置为 8.0.1。
$env:FFMPEG_PATH = 'C:/Users/KotoriInSky/AppData/Local/MatchdayXI/tools/ffmpeg-8.0.1/ffmpeg.exe'
$env:FFPROBE_PATH = 'C:/Users/KotoriInSky/AppData/Local/MatchdayXI/tools/ffmpeg-8.0.1/ffprobe.exe'
$env:FFMPEG_ENCODER = 'h264_nvenc'
npm run bench:local-export
```

基准在 8893 端口提供固定生产构建；不要在运行期间重新构建或同时运行其他浏览器测试。对每套模板交替运行 PNG 和原始帧路径，使用相同素材、时间点、编码参数。每批 12 帧，跨开场、出场、Highlight 附近和结尾，属于动画采样批次，不是整条时间轴的完整视频。

`renderAndEncodeMs` 包含这些帧的生成、传输、FFmpeg 输入处理及编码结束；`totalMs` 另含浏览器页面初始化。PNG 解码／原始像素对照在计时批次后单独运行。报告与短 MP4 位于 `test-results/local-frame-stream/`。`BENCH_HEIGHT=720` 可补测低分辨率，`BENCH_OUTPUT` 可指定新的结果目录。

Node RSS／external 以 100 ms 间隔采样，包含运行顺序、GC 和之前批次的保留内存影响；不能据此推断浏览器、GPU 或整机峰值。页面重建策略继续保留，长时内存曲线和多渲染实例仍待后续验证。

`npm run test:export-frame-stream` 覆盖 RGBA／透明度、帧顺序、背压、长度限制、取消、连续帧监听器释放、Canvas 主动释放和重建续传、外部资源限制及 CDP 复制检查。`npm run test:export` 和 `npm run test:export-media` 检查实际任务、MP4、取消及背景视频。

## 本机测量（2026-10-19）

真实项目 JSON 的 SHA256 为 `47833d5f0d2617ab66b73aaf8d00112d3b214b530b60badac1604f4691544661`。机器为 Core Ultra 9 285H／32 GiB／RTX 5060 Laptop，FFmpeg 8.0.1、NVENC p5／CQ18。生产构建固定；两条路径都包含同一版不可见图层裁减，因此下表衡量本轮传输改动的独立收益。

| 规格／模板 | PNG 批次中位数 | 原始帧批次中位数 | 耗时减少 |
| --- | ---: | ---: | ---: |
| 4K60／经典 | 14.99 秒 | 13.26 秒 | 11.6% |
| 4K60／新版 | 8.63 秒 | 7.32 秒 | 15.3% |
| 720p60／经典 | 9.35 秒 | 9.12 秒 | 2.4% |
| 720p60／新版 | 2.66 秒 | 2.90 秒 | -9.0% |

每项为三轮、每轮 12 帧，含编码结束；加入页面初始化后，两套模板总耗时中位数分别从 17.99／11.53 秒变为 16.27／10.26 秒。两套模板另各检查 5 个画面，包括连续三个关键帧，解码后改变像素数及最大通道差都为 0。短 MP4 均为 3840×2160、60 fps、12 帧。

两套模板的 PNG／原始帧短 MP4 进一步通过 FFmpeg SSIM 对照，所有分量均为 1。实际任务的短夹具完成 720p60／4K60 两种完整导出，各为 6.1 秒、366 帧；4K 跨过第 120／240／360 帧页面重建，完整文件解码通过。背景视频完成 720p30、183 帧，覆盖上传和循环；活动任务连续取消三次后均可立即新建任务。

最终构建补查经典 26.7 秒附近的连续帧及新版 24.488 秒 Highlight 实际材质／立绘切换前、中、后三帧，改变像素数均为 0；对应结果分别位于 `test-results/local-frame-stream/highlight-validation/` 和 `season-highlight-cut/`。`npm run test:export-cancel` 可复查两次 4K 和一次 PNG 活动取消；默认使用 `test:export-resources` 生成的项目夹具，也可通过 `EXPORT_PROJECT` 指定。

经典模板 Node RSS 采样峰值从各轮的 338–367 MiB 变为 329–342 MiB，新版结果随运行顺序有重叠；不据此承诺固定的内存降幅。主要内存改动是单帧背压、Node 分块转发和主动释放 Canvas；浏览器的 SVG 原生资源占用仍需页面重建限制。

720p 的波动及新版回退说明原始帧传输不能直接套用于所有规格。产品仅在 2160p 启用；较低分辨率等待单独测量再决定。取消导出时还修复了 Windows 输出文件被 FFmpeg 占用的清理竞争：等待编码进程关闭后再删除任务文件。

这不是完整 34 秒项目的新总用时，也没有重新运行此前约一小时的完整导出。SVG 序列化及解码仍占主要耗时；不能用本轮比例直接保证整个视频的速度。

## 片尾卡片画面修正（2026-10-20）

新版完整 4K60 成片检查发现，片尾阵型的小卡背面覆盖了立绘，号码与名字呈镜像；同一时刻原生浏览器预览正确。原因是 SVG `foreignObject` 解码到 Canvas 时会将 3D 图层拍平，未按预览的方式隐藏背面。PNG 与 RGBA 互相对照会同时保留这个错误，完整解码也只能证明媒体文件有效。

捕获副本现在使用浏览器 `DOMMatrixReadOnly` 累积 `preserve-3d` 上下文中的变换，通过逆矩阵判断被隐藏的背面；仅将副本中的该面设为透明，保留布局、原有翻转角度和实时预览。浏览器导出和本地导出共用这项修正。

`npm run test:export-backface` 先复现了零度正面被镜像背面覆盖的问题，再验证正反向角度、89／91 度侧面临界点、往返定位、两种样式捕获及两套模板片尾的全部 11 张立绘。真实项目另检查 4K 转场与最终画面，包括完整捕获和不可见图层优化路径；成片仍需按画面内容复核，不能仅凭传输像素相等或解码通过作出结论。
