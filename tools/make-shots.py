#!/usr/bin/env python3
"""把 scripts/capture-docs.js 抓取的原始 PNG 合成 README 用图：
 - 桌宠截图是透明窗口，这里合成到柔和的粉紫渐变「桌面示意背景」上
 - 把悬停过程的帧合成 GIF
依赖 Pillow。用法: python3 tools/make-shots.py"""
import glob, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), '..', 'docs', 'screenshots')
raw = os.path.join(root, '_raw')

def backdrop(size):
    w, h = size
    bg = Image.new('RGB', size)
    px = bg.load()
    top, bot = (244, 232, 255), (255, 226, 238)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return bg.convert('RGBA')

def comp(name):
    im = Image.open(os.path.join(raw, name)).convert('RGBA')
    bg = backdrop(im.size)
    bg.alpha_composite(im)
    return bg.convert('RGB')

for n in ('pet-hover.png', 'pet-idle.png'):
    comp(n).save(os.path.join(root, n), optimize=True)

frames = [comp(os.path.basename(f)) for f in sorted(glob.glob(os.path.join(raw, 'frame-*.png')))]
pal = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
pal[0].save(os.path.join(root, 'pet-hover.gif'), save_all=True, append_images=pal[1:], duration=130, loop=0, optimize=True)

for n in ('manager-default.png', 'manager-fetch-error.png', 'manager-edit.png'):
    Image.open(os.path.join(raw, n)).convert('RGB').save(os.path.join(root, n), optimize=True)
print('ok', os.listdir(root))
