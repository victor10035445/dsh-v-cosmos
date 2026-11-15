/**
 * 皮肤 · Linear 靛紫（add-cosmos-skin-themes 1.3）。
 *
 * 血统：Linear.app 设计语言——近黑 `#08090A` / 靛紫 `#5E6AD2` / 1px 半透明细描边。
 * 精密仪器气质：细实线 + 柔光晕 + 极淡轨道。
 *
 * 移植词汇映射（design D5）：demo `draft`（靛蓝冷亮）→ created、`complete`（金）→
 * executed；reviewed 升亮派生、proto 降饱和；原 `in-progress` 暖橙按语义契约移交
 * HUD 注意力信号（`--cos-waiting`）。
 */

import { createGalaxySkin } from './galaxy-factory.mjs';
import { mix } from '../skin-kit.mjs';

const CREATED = '#8b96e8';
const ACCENT = '#5e6ad2';
const GOLD = '#dcbd6a';

const PROP = Object.freeze({
  proto: '#8a92ae',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.34),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#43495c',
  busy: ACCENT,
  waiting: '#e0a26a',
  'done-unread': '#6fcf97',
  free: '#a5b0e8'
});

/** 创建 Linear 靛紫皮肤实例。 */
export function createSkinLinear() {
  return createGalaxySkin({
    id: 'linear',
    bg: { mode: 'gradient', stops: ['#14152b', '#0b0c12', '#070809'] },
    bgStars: { dim: '#2a2e40', mid: '#9aa2b1', bright: '#8f9bd8' },
    dust: ['#1b1e2e', '#2a3350'],
    dustAlpha: 0.9,
    prop: PROP,
    sess: SESS,
    gold: PROP.executed,
    selection: ACCENT,
    line: { dash: [], alpha: 0.16, color: ACCENT },
    orbit: { dash: [4, 6], alpha: 0.1 },
    glowK: 0.8,
    flare: 'halo',
    hotCore: true,
    rings: 'single',
    waiting: 'pillar',
    hover: 'ring',
    meteor: { trail: '#a5b0e8', head: '#e6e9f2' }
  });
}
