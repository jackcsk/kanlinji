#!/usr/bin/env python3
"""Package unchanged Taiwan MOE full-stroke-hint PNGs for offline use.

Usage: python3 scripts/import-moe.py /tmp/6063png.zip /tmp/moe-iframe-index.csv
Sources and CC BY-NC-ND 3.0 TW terms: public/licenses/MOE-NOTICE.txt.
This maintenance tool is not required to run the Node.js application.
"""
import base64
import csv
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = [
    '71ab4ab4f48c8503095819a88f0032b8408b1705afe89902196cc0be8d3fbfc3',
    '44036a65a3a95b6dec5a538ce1cd58098370cd0e309ca5e12a72f0ceaf32e986',
]


def unicode_filename(entry):
    if entry.flag_bits & 0x800:
        return entry.filename
    # Most original names use Big5, accompanied by an authoritative Unicode
    # Path Extra Field (0x7075). Verify that field against the original bytes.
    offset = 0
    while offset < len(entry.extra):
        tag, size = struct.unpack_from('<HH', entry.extra, offset)
        field = entry.extra[offset + 4:offset + 4 + size]
        offset += 4 + size
        if tag == 0x7075:
            expected_crc = zlib.crc32(entry.filename.encode('cp437'))
            if field[0] != 1 or struct.unpack_from('<I', field, 1)[0] != expected_crc:
                raise ValueError(f'Invalid Unicode filename metadata: {entry.filename}')
            return field[5:].decode('utf-8')
    raise ValueError(f'Missing Unicode filename metadata: {entry.filename}')


if len(sys.argv) != 3:
    sys.exit(__doc__)
sources = [Path(arg) for arg in sys.argv[1:]]
for source, expected in zip(sources, EXPECTED):
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        sys.exit(f'Checksum mismatch: {source}')

with sources[1].open(encoding='utf-8-sig', newline='') as source:
    rows = list(csv.DictReader(source))
expected_characters = set()
for row in rows:
    character = row['國字']
    if len(character) != 1 or int(row['uniocde(10進位制) ']) != ord(character):
        sys.exit(f'Invalid manifest row: {row}')
    expected_characters.add(character)
if len(rows) != 6063 or len(expected_characters) != 6063:
    sys.exit('Expected exactly 6063 distinct characters in the official manifest')

data = {}
with zipfile.ZipFile(sources[0]) as archive:
    for entry in archive.infolist():
        if entry.is_dir():
            continue
        name = PurePosixPath(unicode_filename(entry))
        if name.parent.as_posix() != '6063png' or name.suffix != '.png' or len(name.stem) != 1:
            sys.exit(f'Unexpected archive entry: {name}')
        character = name.stem
        if character in data:
            sys.exit(f'Duplicate character: {character}')
        png = archive.read(entry)
        if png[:8] != b'\x89PNG\r\n\x1a\n' or png[12:16] != b'IHDR':
            sys.exit(f'Invalid PNG: {name}')
        width, height = struct.unpack('>II', png[16:24])
        if width not in (50, 95, 140) or height != 725:
            sys.exit(f'Unexpected dimensions for {name}: {width} x {height}')
        data[character] = {
            'png': base64.b64encode(png).decode('ascii'),
            'width': width,
            'height': height,
            'sha256': hashlib.sha256(png).hexdigest(),
        }
if set(data) != expected_characters:
    sys.exit(f'Archive/manifest coverage mismatch: {sorted(set(data) ^ expected_characters)}')

raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
target = ROOT / 'data/moe.json.gz'
target.write_bytes(gzip.compress(raw, mtime=0))
print(f'moe: {len(data)} characters, {target.stat().st_size:,} bytes')
print(f'sha256: {hashlib.sha256(target.read_bytes()).hexdigest()}')
