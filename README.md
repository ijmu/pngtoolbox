# PNGToolbox

pngtoolbox.com 的源码仓库 —— 一个在浏览器本地运行的图片工具站，图片处理全部在用户浏览器内完成，无需注册账号。

## 主要工具页（根目录 *.html）

- 格式转换：WebP 转 PNG、PNG 转 JPG、PNG 转 WebP、WebP 转 JPG
- 背景处理：PNG 透明背景、PNG 白底背景
- 场景页：批量 WebP 转 PNG、iPhone / Android 场景下的 WebP 转换
- 另有一批指南与科普页（PNG 格式、压缩、透明度、格式对比等），及 about / privacy / terms 等站点页

## 目录结构

- 根目录 `*.html`：各工具页与内容页；`styles.css` 等为全局样式
- `src/`：TypeScript 源码（convert-core.ts 转换核心、converter-ui.ts 界面、transparent-tool.ts 透明背景工具等）
- `scripts/`：构建与校验脚本（copy-static.mjs、verify-dist.mjs）
- `assets/`：静态资源

## 本地运行与构建

```bash
npm install
npm run dev        # Vite 本地开发
npm run build      # 构建并输出到 dist/
npm run typecheck  # 类型检查
```

## 部署

Vercel 静态部署：`vercel.json` 指定 buildCommand 为 `npm run build`、输出目录为 `dist`。
