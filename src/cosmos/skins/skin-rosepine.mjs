/**
 * 皮肤 · 星图玫瑰松 Rosé Pine（**默认皮肤**；add-cosmos-skin-themes 1.3）。
 *
 * 血统：Rosé Pine 官方色板（rose-pine/palette）——base `#191724` / gold `#f6c177` /
 * iris `#c4a7e7`。夜紫底 + 金鸢尾银河带 / 松绿×鸢尾星云 / 金色虚线；与风格 D 血缘
 * 最近，语义色几乎零迁移。
 *
 * 移植词汇映射（design D5）：demo `draft → created` 取冷亮域（原 in-progress 的玫瑰色
 * 属暖域，按「皮肤语义契约」改由 `--cos-waiting` 承载注意力语义），`complete → executed`
 * 即金域；`reviewed` 由 created 升亮派生（冷亮升亮域）；`proto` 由 created 向灰蓝降饱和。
 */

import { createGalaxySkin } from './galaxy-factory.mjs';
import { mix } from '../skin-kit.mjs';

const CREATED = '#9ccfd8';
const GOLD = '#f6c177';

const PROP = Object.freeze({
  proto: '#8ea6c0',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.34),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#908caa',
  busy: '#6fd0da',
  waiting: '#f4a978',
  'done-unread': '#7fd6a4',
  free: '#cfe6ea'
});

/** 创建玫瑰松皮肤实例（引擎构造参数形态；每次创建独立 glow sprite 缓存）。 */
export function createSkinRosepine() {
  return createGalaxySkin({
    id: 'rosepine',
    bg: { mode: 'band', base: '#191724', colors: ['#c4a7e7', '#f6c177', '#e0def4'] },
    bgStars: { dim: '#31748f', mid: '#e0def4', bright: '#f6c177' },
    dust: ['#31748f', '#c4a7e7'],
    prop: PROP,
    sess: SESS,
    gold: PROP.executed,
    selection: GOLD,
    line: { dash: [2, 4], alpha: 0.28, color: GOLD },
    orbit: { dash: [4, 6], alpha: 0.20 },
    glowK: 1,
    flare: 'cross',
    hotCore: true,
    rings: 'double',
    waiting: 'pillar',
    hover: 'ring2',
    meteor: { trail: '#ebbcba', head: '#f6c177' }
  });
}
