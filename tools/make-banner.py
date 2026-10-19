#!/usr/bin/env python3
"""生成 docs/banner.svg（粉色二次元风格封面）。文字使用 Noto Sans CJK SC（SIL OFL）转成矢量路径，
因此在任何设备/GitHub 上显示一致，不依赖字体。吉祥物为本项目原创手绘 SVG 猫娘（取自 src/pet.html）。
依赖: fontTools。用法: python3 tools/make-banner.py"""
import re, os, math, random
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.join(os.path.dirname(__file__), '..')
FONT_DIR = '/usr/share/fonts/opentype/noto/'

def load(ttc, family):
    for f in TTCollection(FONT_DIR + ttc).fonts:
        if f['name'].getDebugName(1) == family:
            return f
    raise SystemExit('font not found')

BOLD = load('NotoSansCJK-Bold.ttc', 'Noto Sans CJK SC')
REG = load('NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC')

def text_path(font, text, x, y, size, spacing=0.0):
    """返回 (svg path d, 总宽度)"""
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
    s = size / upm; cx = x; ds = []
    for ch in text:
        gn = cmap.get(ord(ch))
        if gn is None:
            cx += size * 0.3; continue
        pen = SVGPathPen(gs)
        gs[gn].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        ds.append(pen.getCommands())
        cx += gs[gn].width * s + spacing
    return ' '.join(ds), cx - x

pet = open(os.path.join(ROOT, 'src', 'pet.html'), encoding='utf-8').read()
m = re.search(r'<svg id="pet-svg"[^>]*>(.*?)</svg>', pet, re.S)
cat_inner = m.group(1)
cat_inner = re.sub(r'class="[^"]*"', '', cat_inner)  # 去掉动画 class，静态展示

W, H = 1280, 400
random.seed(7)

def star(cx, cy, r, op=0.9, fill='#fff'):
    k = r * 0.28
    return (f'<path d="M{cx} {cy-r} Q{cx+k} {cy-k} {cx+r} {cy} Q{cx+k} {cy+k} {cx} {cy+r} '
            f'Q{cx-k} {cy+k} {cx-r} {cy} Q{cx-k} {cy-k} {cx} {cy-r}Z" fill="{fill}" opacity="{op}"/>')

def petal(cx, cy, s, rot, op):
    return (f'<g transform="translate({cx} {cy}) rotate({rot}) scale({s})" opacity="{op}">'
            '<path d="M0 -10 C 9 -10 12 2 0 12 C -12 2 -9 -10 0 -10Z" fill="#ffc2d8"/>'
            '<path d="M0 -10 L0 -2" stroke="#ff9bbd" stroke-width="1.2" stroke-linecap="round"/></g>')

def coin(cx, cy, r, label, rot, op=0.95):
    return (f'<g transform="translate({cx} {cy}) rotate({rot})" opacity="{op}">'
            f'<circle r="{r}" fill="url(#coinG)" stroke="#ffd166" stroke-width="3"/>'
            f'<circle r="{r*0.74}" fill="none" stroke="#fff3c4" stroke-width="2" stroke-dasharray="3 4"/>'
            f'<text y="{r*0.30}" text-anchor="middle" font-size="{r*0.95}" font-weight="800" fill="#c98a00" '
            f'font-family="Arial, Helvetica, sans-serif">{label}</text></g>')

title_d, tw = text_path(BOLD, 'AI 余额管理大师', 70, 190, 92, spacing=3)
sub_d, _ = text_path(REG, 'AI Balance Master', 74, 238, 30, spacing=4)
tag_lines = ['薅来的额度、订阅的套餐——还剩多少、何时过期、会不会白白浪费？', '让一只桌宠替你盯着。']
tag1, _ = text_path(BOLD, tag_lines[0], 74, 292, 25)
tag2, _ = text_path(BOLD, tag_lines[1], 74, 326, 25)

chips = ['Electron', 'VRM 3D 桌宠', '本地存储', 'Key 加密']
chip_svg = []
cx = 74
for c in chips:
    d, w = text_path(BOLD, c, 0, 0, 17)
    pw = w + 28
    chip_svg.append(
        f'<g transform="translate({cx} 350)"><rect width="{pw:.0f}" height="30" rx="15" fill="#ffffff" opacity="0.78" stroke="#ffb3cf" stroke-width="1.5"/>'
        f'<path d="{d}" transform="translate(14 21)" fill="#d6336c"/></g>')
    cx += pw + 10

deco = []
for _ in range(34):
    deco.append(star(random.randint(20, W - 20), random.randint(15, H - 15), random.choice([4, 5, 6, 8]), op=random.choice([0.5, 0.7, 0.9])))
for _ in range(16):
    deco.append(petal(random.randint(20, W - 20), random.randint(15, H - 15), random.choice([0.8, 1, 1.3]), random.randint(0, 360), random.choice([0.5, 0.7, 0.9])))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="AI余额管理大师 · AI Balance Master">
  <title>AI余额管理大师 · AI Balance Master</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe0ee"/><stop offset="0.5" stop-color="#f4dcff"/><stop offset="1" stop-color="#d9ecff"/>
    </linearGradient>
    <linearGradient id="titleG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff5c93"/><stop offset="0.6" stop-color="#c04fd8"/><stop offset="1" stop-color="#7c6cf0"/>
    </linearGradient>
    <linearGradient id="coinG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="1" stop-color="#ffc83d"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="hairG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd4e2"/><stop offset="0.55" stop-color="#ffa9c6"/><stop offset="1" stop-color="#ff92b4"/></linearGradient>
    <linearGradient id="eyeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9d8bff"/><stop offset="1" stop-color="#5a46e8"/></linearGradient>
    <linearGradient id="dressG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d5d94"/><stop offset="1" stop-color="#364470"/></linearGradient>
    <radialGradient id="cheekG" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff87a8" stop-opacity="0.8"/><stop offset="1" stop-color="#ff87a8" stop-opacity="0"/></radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#d6336c" flood-opacity="0.28"/></filter>
  </defs>

  <rect width="{W}" height="{H}" rx="28" fill="url(#bg)"/>
  <circle cx="1040" cy="190" r="230" fill="url(#glow)"/>
  <circle cx="120" cy="40" r="150" fill="url(#glow)" opacity="0.7"/>
  <g>{''.join(deco)}</g>

  <!-- 漂浮的额度币 -->
  {coin(760, 70, 34, '$', -14)}
  {coin(870, 335, 26, '¥', 12)}
  {coin(1232, 300, 24, 'T', 18, 0.9)}
  {coin(690, 250, 18, 'T', -8, 0.8)}

  <!-- 标题（矢量路径） -->
  <path d="{title_d}" fill="#ffffff" stroke="#ffffff" stroke-width="10" stroke-linejoin="round" opacity="0.9"/>
  <path d="{title_d}" fill="url(#titleG)"/>
  <path d="{sub_d}" fill="#a35a86"/>
  <path d="{tag1}" fill="#5b3a63"/>
  <path d="{tag2}" fill="#d6336c"/>
  {''.join(chip_svg)}

  <!-- 吉祥物：原创手绘 SVG 猫娘（静态） -->
  <g transform="translate(905 32) scale(1.32)" filter="url(#soft)">{cat_inner}</g>

  <!-- 气泡 -->
  <g transform="translate(1068 66)">
    <rect width="168" height="46" rx="18" fill="#fff" stroke="#ffc2d8" stroke-width="2"/>
    <path d="M30 46 L22 62 L48 46Z" fill="#fff" stroke="#ffc2d8" stroke-width="2" stroke-linejoin="round"/>
    <rect x="28" y="44" width="22" height="4" fill="#fff"/>
    <path d="{text_path(BOLD, '额度快到期啦！', 0, 0, 20)[0]}" transform="translate(16 30)" fill="#e03131"/>
  </g>
</svg>
'''
out = os.path.join(ROOT, 'docs', 'banner.svg')
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w', encoding='utf-8').write(svg)
print('banner.svg', len(svg) // 1024, 'KB')
