#!/usr/bin/env python3
"""缩小 VRM/GLB 内嵌贴图（>MAX 的贴图等比缩小），用于减小仓库体积。
用法: python3 tools/shrink-vrm.py in.vrm out.vrm [MAX=1024] [THUMB=256]
依赖: Pillow。仅重写图片数据，不改动网格/骨骼/材质/许可证元数据。"""
import struct, json, io, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
THUMB = int(sys.argv[4]) if len(sys.argv) > 4 else 256
d = open(src, 'rb').read()
jl, _ = struct.unpack('<II', d[12:20])
j = json.loads(d[20:20 + jl])
off = 20 + jl
bl, _ = struct.unpack('<II', d[off:off + 8])
bin_ = d[off + 8:off + 8 + bl]

thumb_idx = j.get('extensions', {}).get('VRM', {}).get('meta', {}).get('texture')
thumb_img = None
if thumb_idx is not None:
    thumb_img = j['textures'][thumb_idx]['source']
new_data = {}
for i, im in enumerate(j.get('images', [])):
    bv = j['bufferViews'][im['bufferView']]
    raw = bin_[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']]
    img = Image.open(io.BytesIO(raw))
    limit = THUMB if i == thumb_img else MAX
    if max(img.size) > limit:
        r = limit / max(img.size)
        img = img.resize((max(1, round(img.width * r)), max(1, round(img.height * r))), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'PNG', optimize=True)
        new_data[im['bufferView']] = out.getvalue()

chunks = []
pos = 0
for k, bv in enumerate(j['bufferViews']):
    data = new_data.get(k, bin_[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']])
    pad = (-pos) % 4
    chunks.append(b'\0' * pad)
    pos += pad
    bv['byteOffset'] = pos
    bv['byteLength'] = len(data)
    chunks.append(data)
    pos += len(data)
pad = (-pos) % 4
chunks.append(b'\0' * pad)
pos += pad
newbin = b''.join(chunks)
j['buffers'][0]['byteLength'] = len(newbin)
js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
js += b' ' * ((-len(js)) % 4)
total = 12 + 8 + len(js) + 8 + len(newbin)
with open(dst, 'wb') as f:
    f.write(b'glTF' + struct.pack('<II', 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(newbin), 0x004E4942) + newbin)
print(f'{src}: {len(d)/1e6:.1f} MB -> {dst}: {total/1e6:.1f} MB')
