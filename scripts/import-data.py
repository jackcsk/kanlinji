#!/usr/bin/env python3
"""Rebuild compact, licensed stroke datasets from the pinned upstream downloads.

Usage: python3 scripts/import-data.py /tmp/hanzi.tgz /tmp/graphicsZhHant.txt
This maintenance tool is not required to build or run the Node.js application.
"""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = [
    '72baf3d82b114e60d6e40ea05f24d2262a05cd39d544e2f322ba2fceb7beff15',
    '731fe26345833745dc7d37c8213f3ca91585aa0ee18179c0ccda91be41ff6aec',
]
NOTICES = {
    'cn': {
        'sourceUrl': 'https://github.com/chanind/hanzi-writer-data',
        'version': '2.0.1',
        'license': 'Arphic Public License',
        'licenseFile': 'public/licenses/ARPHICPL.txt',
        'copyright': 'Copyright (c) 1999 Arphic Technology Co., Ltd.',
        'attribution': 'hanzi-writer-data by David Chanin; derived from Make Me a Hanzi by Shaunak Kishore and contributors, and Arphic PL KaitiM GB / Arphic PL UKai fonts.',
        'modification': {
            'date': '2026-09-22',
            'by': 'kanlinji contributors',
            'method': 'Repackaged as character-keyed, gzip-compressed JSON. Original stroke path geometry and order retained unchanged. Medians omitted. A coordinate transform added. These derived graphics remain under the Arphic Public License.',
        },
    },
    'tw': {
        'sourceUrl': 'https://github.com/parsimonhi/animCJK',
        'version': 'ec5e17cca76c87587790bcbce5ea0b4d4fb753d6',
        'sourceFile': 'graphicsZhHant.txt',
        'license': 'Arphic Public License',
        'licenseFile': 'public/licenses/ARPHICPL.txt',
        'copyright': 'AnimCJK, Copyright 2016-2026 FM&SH.',
        'attribution': 'See public/licenses/AnimCJK-COPYING.txt for upstream attribution.',
        'modification': {
            'date': '2026-09-22',
            'by': 'kanlinji contributors',
            'method': 'Repackaged as character-keyed, gzip-compressed JSON. Original stroke path geometry and order retained unchanged. Medians omitted. A coordinate transform added. These derived graphics remain under the Arphic Public License.',
        },
    },
}

if len(sys.argv) != 3:
    sys.exit(__doc__)
sources = [Path(arg) for arg in sys.argv[1:]]
for source, expected in zip(sources, EXPECTED):
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        sys.exit(f'Checksum mismatch: {source}')

def record(strokes):
    # Both upstream graphics JSON formats use a 1024-unit, upward Y axis.
    return {'paths': strokes, 'transform': 'translate(0 900) scale(1 -1)'}

cn = {}
with tarfile.open(sources[0]) as archive:
    for entry in archive:
        name = Path(entry.name)
        if name.parent.as_posix() == 'package' and name.suffix == '.json' and len(name.stem) == 1:
            cn[name.stem] = record(json.load(archive.extractfile(entry))['strokes'])
    license_bytes = archive.extractfile('package/APL/english/ARPHICPL.TXT').read()
    (ROOT / 'public/licenses/ARPHICPL.txt').write_bytes(license_bytes)

tw = {}
for line in sources[1].read_text().splitlines():
    item = json.loads(line)
    tw[item['character']] = record(item['strokes'])

for region, data in [('cn', cn), ('tw', tw)]:
    packaged = {'_notice': NOTICES[region], **data}
    raw = json.dumps(packaged, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    target = ROOT / f'data/{region}.json.gz'
    target.write_bytes(gzip.compress(raw, mtime=0))
    print(f'{region}: {len(data)} characters, {target.stat().st_size:,} bytes')
