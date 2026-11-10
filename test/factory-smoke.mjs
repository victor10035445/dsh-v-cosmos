/**
 * bundle 工厂冒烟（对齐 hive factory-smoke）：lib/client.js 懒 CJS 工厂可求值、
 * 导出面形状正确、external 模块经 stub require 注入不触碰真实 react。
 * 运行：先 npm run build，再 node test/factory-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundlePath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const source = readFileSync(bundlePath, "utf8");
assert.ok(source.includes("window.__ModuleLoader__.load"), "懒工厂 banner");
assert.ok(source.includes('id: "dsh-v-cosmos"'), "插件 id");

/* 求值：stub window + require（react/@deepseek-ai/* external 由 stub 供给）。 */
const loaded = [];
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(def) {
        loaded.push(def);
      }
    }
  },
  require(name) {
    return new Proxy({}, { get: () => () => ({}) });
  }
};
const compiled = new Function("window", "require", source);
compiled(sandbox.window, sandbox.require);

assert.equal(loaded.length, 1, "单次 load 注册");
const def = loaded[0];
assert.equal(def.id, "dsh-v-cosmos");
assert.equal(typeof def.factory, "function");

const exportsShape = def.factory(sandbox.require);
assert.equal(typeof exportsShape.apply, "function", "apply 入口");
assert.deepEqual(exportsShape.inject, ["slots", "locale", "sessions", "workspaces", "uiSession", "uiWorkspace"], "inject 声明（宿主 cordis 规则：ctx 属性须经 inject 声明方可访问）");
assert.equal(typeof exportsShape.mergeScene, "function", "冒烟观测面导出");
assert.equal(typeof exportsShape.sceneDiffLevel, "function");
assert.equal(typeof exportsShape.createSkinD, "function");
assert.equal(typeof exportsShape.createCosmosEngine, "function");
assert.equal(typeof exportsShape.fetchScene, "function");
assert.equal(typeof exportsShape.subscribeCosmosEvents, "function");
assert.equal(typeof exportsShape.loadCosmosSettings, "function", "设置读面导出（调参消费通道）");
assert.equal(typeof exportsShape.saveCosmosSettings, "function", "设置写面导出");
assert.ok(exportsShape.cosmosOpenStore && typeof exportsShape.cosmosOpenStore.subscribe === "function", "开合 store 导出");

/* sourcemap 同步产出（宿主 client-modules 探测组装索引 map）。 */
const mapPath = fileURLToPath(new URL("../lib/client.js.map", import.meta.url));
const map = JSON.parse(readFileSync(mapPath, "utf8"));
assert.equal(map.file, "client.js", "map.file 键补齐");
assert.ok(Array.isArray(map.sources) && map.sources.some((s) => s.includes("client.jsx")), "map 回指源码");

console.log("factory-smoke: all assertions passed");
