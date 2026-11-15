/**
 * 皮肤 · 知识星图 Obsidian（add-cosmos-skin-themes 1.3）。
 *
 * 血统：Obsidian Graph View——近黑底 / 紫罗兰节点 / 细实线边。
 * 实线细边替代虚线（图谱 edge 本色）、无轨道环——Cosmos 在视觉上认祖归宗。
 *
 * 移植词汇映射（design D5）：demo `draft`（雾蓝冷亮）→ created、`complete`（金）→
 * executed；reviewed 升亮派生、proto 降饱和。
 */

import { createGalaxySkin } from './galaxy-factory.mjs';
import { mix } from '../skin-kit.mjs';

const CREATED = '#8fb2e0';
const ACCENT = '#a882ff';
const GOLD = '#e2bd62';

const PROP = Object.freeze({
  proto: '#8c96b0',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.34),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#6e7386',
  busy: '#6cc4e8',
  waiting: '#e8a05c',
  'done-unread': '#63d0b0',
  free: '#9fd0e8'
});

/** 创建知识星图皮肤实例。 */
export function createSkinObsidian() {
  return createGalaxySkin({
    id: 'obsidian',
    bg: { mode: 'gradient', stops: ['#232330', '#1a1a20', '#121217'] },
    bgStars: { dim: '#3a3f52', mid: '#c9cbd4', bright: '#d4bff5' },
    dust: ['#2a2d3a', '#4a3f66'],
    prop: PROP,
    sess: SESS,
    gold: PROP.executed,
    selection: ACCENT,
    line: { dash: [], alpha: 0.18, color: ACCENT },
    orbit: { dash: [4, 6], alpha: 0.1, off: true },
    glowK: 0.5,
    flare: 'none',
    hotCore: true,
    rings: 'none',
    waiting: 'pulse',
    hover: 'ring',
    meteor: { trail: '#c9cbd4', head: '#eaeaf0' }
  });
}
