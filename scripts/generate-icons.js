// 生成 DSH 桌面图标: assets/icon.ico (Windows) / icon.icns (macOS) / icon.png (通用)
// 源图: assets/fish.svg (官方鱼标, 取自 deepseek-harness apps/web/public/favicon.svg)
// 依赖 sharp: 自动在 deepseek-harness 仓库的 pnpm store 里查找, 也可用环境变量
// DSH_SHARP 或本机安装的 sharp 覆盖。
// 运行:  node scripts\generate-icons.js      (在 dsh-desktop 目录下)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- 定位 sharp (pnpm store / 环境变量 / 本机安装) ----------
function resolveSharp() {
  if (process.env.DSH_SHARP) {
    try { return require(process.env.DSH_SHARP); } catch (e) { /* fall through */ }
  }
  try { return require('sharp'); } catch (e) { /* fall through */ }
  // 常见布局: ~/deepseek-harness/node_modules/.pnpm/sharp@*/node_modules/sharp
  const pnpmRoot = path.join(os.homedir(), 'deepseek-harness', 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmRoot)) {
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!/^sharp@/.test(entry)) continue;
      const p = path.join(pnpmRoot, entry, 'node_modules', 'sharp');
      if (!fs.existsSync(path.join(p, 'package.json'))) continue;
      try { return require(p); } catch (e) { /* try next */ }
    }
  }
  return null;
}

const sharp = resolveSharp();
if (!sharp) {
  console.error('找不到 sharp。请安装 sharp (npm i -D sharp), 或设置 DSH_SHARP 指向其入口。');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

// ---------- 从 fish.svg 提取鱼形 path ----------
const fishSvg = fs.readFileSync(path.join(ASSETS, 'fish.svg'), 'utf8');
const m = fishSvg.match(/<path[^>]*\sd="([^"]+)"/);
if (!m) throw new Error('assets/fish.svg 中未找到 path 的 d 属性');
const fishD = m[1];

// ---------- 1024 画布: 深色圆角底 + 居中白色鱼标 (与 DSH 深色主题一致) ----------
const TILE = '#2C2C2E'; // 与 main.js THEME_BG 一致
const FISH = '#FFFFFF';
const SCALE = (1024 / 50) * 0.62; // 鱼标约占画布 62%
const X = (1024 - 50 * SCALE) / 2;
const Y = (1024 - 50 * SCALE) / 2;

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="220" fill="${TILE}"/>
  <g transform="translate(${X},${Y}) scale(${SCALE})">
    <path d="${fishD}" fill="${FISH}"/>
  </g>
</svg>`;

// ---------- ICO 容器 (Vista+ 全 PNG 条目) ----------
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    const b = size >= 256 ? 0 : size;
    e.writeUInt8(b, 0); // width
    e.writeUInt8(b, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// ---------- ICNS 容器 (macOS, PNG 条目) ----------
function buildIcns(chunks) {
  const parts = [];
  for (const { type, data } of chunks) {
    const h = Buffer.alloc(8);
    h.write(type, 0, 4, 'ascii');
    h.writeUInt32BE(8 + data.length, 4);
    parts.push(h, data);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  const svgBuf = Buffer.from(iconSvg);

  // icon.ico: 16/24/32/48/64/128/256
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    icoPngs.push({ size, data: await sharp(svgBuf).resize(size, size).png().toBuffer() });
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(icoPngs));
  console.log('✓ assets/icon.ico');

  // icon.icns: icp4(16) icp5(32) ic07(128) ic08(256) ic09(512) ic10(1024)
  const icnsChunks = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    icnsChunks.push({ type, data: await sharp(svgBuf).resize(size, size).png().toBuffer() });
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'), buildIcns(icnsChunks));
  console.log('✓ assets/icon.icns');

  // icon.png: 256 通用预览
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), await sharp(svgBuf).resize(256, 256).png().toBuffer());
  console.log('✓ assets/icon.png');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
