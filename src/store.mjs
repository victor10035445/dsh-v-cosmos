/**
 * dsh-v-cosmos 页面 store（root 作用域，shell.overlay 条目注册必带——框架据此向条目
 * 组件注入 useStore 与 store actions props；hive hiveStore 同款机制）。
 *
 * Cosmos 的页面态极薄：整页渲染引擎自持状态（相机/选中/toast 在引擎内），
 * store 只承载全屏开关与框架 toast 通道（「打开会话」失败提示用）。
 */
import { defineStore } from "@deepseek-ai/dsh-client-store";

export const cosmosStore = defineStore({
  init: () => ({
    fullscreen: false,
    toast: null // { text, kind, seq }
  }),
  actions: {
    setFullscreen(d, v) {
      d.fullscreen = !!v;
    },
    notify(d, text, kind) {
      d.toast = { text: String(text ?? ""), kind: kind === "err" ? "err" : "ok", seq: (d.toast?.seq ?? 0) + 1 };
    },
    clearToast(d) {
      d.toast = null;
    }
  }
});
