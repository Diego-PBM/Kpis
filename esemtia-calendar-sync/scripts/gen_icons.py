#!/usr/bin/env python3
"""Genera icons/icon{16,48,128}.png: un cuadrado azul con una tarjeta de
calendario blanca y una franja roja arriba. Sin dependencias externas
(solo zlib de la stdlib), para no depender de Pillow/ImageMagick."""
import struct, zlib, os

def make_png(size, path):
    blue = (42, 120, 214, 255)
    white = (255, 255, 255, 255)
    red = (235, 104, 52, 255)
    dark = (11, 11, 11, 255)

    margin = max(1, size // 8)
    card_top = margin + max(1, size // 6)
    card = (margin, card_top, size - margin, size - margin)
    stripe_h = max(1, size // 10)

    def pixel(x, y):
        cx0, cy0, cx1, cy1 = card
        if cy0 <= y < cy0 + stripe_h and cx0 <= x < cx1:
            return red
        if cx0 <= x < cx1 and cy0 <= y < cy1:
            # un par de "puntos" que simulan filas de eventos
            row = (y - cy0 - stripe_h)
            if row > 0 and row % max(2, size // 8) == max(1, size // 16) and (x - cx0) % max(3, size // 5) < max(2, size // 10):
                return dark
            return white
        return blue

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtro "none" por scanline
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(out_dir, exist_ok=True)
    for s in (16, 48, 128):
        make_png(s, os.path.join(out_dir, f'icon{s}.png'))
        print('wrote', f'icon{s}.png')
