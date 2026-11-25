/**
 * dsh-v-cosmos 构建（对齐 dsh-v-hive 工厂）：
 *  - src/client.jsx --esbuild--> lib/client.js（懒 CJS 工厂：window.__ModuleLoader__.load
 *    包裹；react / react-dom / @deepseek-ai/* 全部 external，由 DSH client-modules
 *    的引导基线提供；渲染走 Canvas2D（demo 引擎），无 three 等重依赖 → 无需打进包内）。
 *  - 同时产出 lib/client.js.map（外置 sourcemap）：宿主 client-modules 探测该文件并
 *    组装索引 sourcemap，浏览器里插件栈直接指向 src/client.jsx 原始行列。
 *  - src/index.mjs 原样复制为 lib/index.js（宿主半区纯 ESM，零构建变换；依赖仅 node 内建）；
 *    纯逻辑模块（scan.mjs / associations.mjs / sweep.mjs）保留 .mjs 扩展名复制（lib/index.js
 *    的相对 import 说明符 ./<name>.mjs 与文件名一致，node --check 可直接校验）。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const PLUGIN_ID = "dsh-v-cosmos";

const banner = `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {
"use strict";
var module = { exports: {} };
var exports = module.exports;`;

const footer = `return module.exports;
} });`;

mkdirSync(new URL("./lib", import.meta.url), { recursive: true });

/* CSS 模板字面量完整性守卫（swap-cosmos-session-toggle-titlebar 回归）：`src/client.jsx`
   的整站 CSS 是单个模板字面量，CSS 注释/规则里出现**裸反引号**会提前闭合它——esbuild
   仍能编译（余下文本退化为合法的移位/模板表达式），但产物里的 CSS 常量变为数字 0，
   整站样式静默失效（座位按钮变方、页面裸奔）。构建期直接失败，禁止静默产出。 */
const clientSource = readFileSync(new URL("./src/client.jsx", import.meta.url), "utf8");
const cssMarker = "const CSS = `";
const cssOpenAt = clientSource.indexOf(cssMarker);
if (cssOpenAt < 0) throw new Error("build: src/client.jsx 缺少 `const CSS = ` 模板字面量");
let cssCloseAt = -1;
for (let i = cssOpenAt + cssMarker.length; i < clientSource.length; i += 1) {
  if (clientSource[i] === "\\") {
    i += 1;
    continue;
  }
  if (clientSource[i] === "`") {
    cssCloseAt = i;
    break;
  }
}
if (cssCloseAt < 0) throw new Error("build: src/client.jsx 的 CSS 模板字面量未闭合");
const cssTail = clientSource.slice(cssCloseAt, cssCloseAt + "`;\n\nfunction installStyles".length);
if (cssTail !== "`;\n\nfunction installStyles") {
  throw new Error(
    "build: src/client.jsx 的 CSS 模板字面量内存在裸反引号（会提前闭合 → 整站样式失效）；" +
    "请改用「」等非反引号字符，或转义为 \\`"
  );
}

const result = await esbuild.build({
  entryPoints: ["src/client.jsx"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  outfile: "lib/client.js",
  banner: { js: banner },
  footer: { js: footer },
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  minify: true,
  sourcemap: "external",
  legalComments: "none",
  logLevel: "info",
  metafile: true
});

/* 补 `file` 键（esbuild 默认省略）：生成文件与 map 的对应关系显式化。 */
const mapPath = new URL("./lib/client.js.map", import.meta.url);
const mapJson = JSON.parse(readFileSync(mapPath, "utf8"));
mapJson.file = "client.js";
writeFileSync(mapPath, JSON.stringify(mapJson));

const kb = (bytes) => (bytes / 1024).toFixed(1) + "KB";
console.log(`client bundle: ${kb(result.metafile.outputs["lib/client.js"].bytes)}（minified）`);

/* 宿主半区：纯 ESM 源码直出。入口复制为 lib/index.js（package main 不变），
   纯逻辑模块保留 .mjs 扩展名复制（相对 import 说明符与文件名一致）。 */
copyFileSync(new URL("./src/index.mjs", import.meta.url), new URL("./lib/index.js", import.meta.url));
const HOST_MODULE_FILES = ["scan.mjs", "associations.mjs", "birthline.mjs", "dep-resolve.mjs", "dep-gate.mjs", "sweep.mjs", "shortcuts.mjs", "buttons.mjs", "const-buttons.mjs", "paths.mjs", "configstore.mjs", "skill-provider.mjs", "message.mjs", "queue-store.mjs", "queue-scheduler.mjs", "session-executor.mjs", "warp-plan.mjs", "warp-store.mjs", "warp-scheduler.mjs", "works-store.mjs"];
for (const file of HOST_MODULE_FILES) {
  copyFileSync(new URL("./src/" + file, import.meta.url), new URL("./lib/" + file, import.meta.url));
}
console.log("host half: lib/index.js + " + HOST_MODULE_FILES.join(", ") + "（自 src/ 复制）");
