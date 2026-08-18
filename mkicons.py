#!/usr/bin/env python3
"""Generate PNG app icons (dark tile, road with dashed centre line, '66' badge) with no dependencies."""
import zlib, struct, math, sys, os

def render(size):
    bg=(11,13,16); road=(38,45,54); line=(255,210,63); badge=(255,210,63); ink=(17,17,17)
    cx=size/2
    # 7-segment style '66' drawn as thick strokes
    def seg_on(digit, seg): return seg in {'6':'abcdefg'.replace('b','')}[digit]  # 6 = a,c,d,e,f,g
    px=bytearray()
    for y in range(size):
        px.append(0)
        for x in range(size):
            col=bg
            # road band
            if abs(x-cx)<size*0.30: col=road
            # dashed centre line
            if abs(x-cx)<size*0.03 and (y//max(1,int(size*0.10)))%2==0: col=line
            # badge circle
            r=size*0.30; dx=x-cx; dy=y-size*0.55
            if dx*dx+dy*dy<=r*r:
                col=badge
                # digits '66' inside badge: two glyph boxes
                gw=size*0.16; gh=size*0.28; t=size*0.045
                for gx0 in (cx-gw-size*0.02, cx+size*0.02):
                    gy0=size*0.55-gh/2
                    lx=x-gx0; ly=y-gy0
                    if 0<=lx<=gw and 0<=ly<=gh:
                        a = ly<t                       # top
                        f = lx<t and ly<gh/2           # upper-left
                        g = abs(ly-gh/2)<t/2           # middle
                        e = lx<t and ly>=gh/2          # lower-left
                        c = lx>gw-t and ly>=gh/2       # lower-right
                        d = ly>gh-t                    # bottom
                        if a or f or g or e or c or d: col=ink
            px+=bytes(col)
    raw=bytes(px)
    def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')

out=os.path.dirname(os.path.abspath(__file__))
for s in (180,192,512):
    open(os.path.join(out,f'icon-{s}.png'),'wb').write(render(s))
    print('wrote icon-%d.png'%s)
