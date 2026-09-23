#!/usr/bin/env python3
"""Build the bundled AnimCJK font; no Python dependency is needed at runtime.

One-time build dependency: fonttools==4.60.1 in a temporary Python environment.
Usage: python scripts/build-anim-font.py [--output /tmp/AnimCJKWorksheet.otf]
The pinned input and fixed font timestamps make repeated builds byte-identical.
"""
import argparse
import calendar
import gzip
import hashlib
import json
from pathlib import Path

import fontTools
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE_SHA256 = '7355173dd81acf7b4c0290487aecef114084e990e3a8952cf2c0c2d563dd6a3a'
REVISION = 'ec5e17cca76c87587790bcbce5ea0b4d4fb753d6'
FAMILY = 'AnimCJK Worksheet'
POSTSCRIPT_NAME = 'AnimCJKWorksheet-Regular'
MODIFICATION = (
    'Modified 2026-09-22 by kanlinji contributors: 1,013 AnimCJK '
    'graphicsZhHant glyphs from commit ' + REVISION + ' converted to an '
    'OpenType CFF font. Independent stroke contours retain their geometry '
    'and are oriented consistently to preserve overlapping stroke fills. '
    'Quadratic curves are represented as equivalent cubic curves at CFF '
    'coordinate precision. Source Y-up coordinates and 1024-unit em retained. '
    'No missing glyphs added. This derived font remains under the Arphic '
    'Public License; see the accompanying ARPHICPL.txt and NOTICE.txt. '
    'Rebuild source: scripts/build-anim-font.py and data/tw.json.gz.'
)


def draw_strokes(paths, pen):
    """SVG fills strokes separately; consistent direction preserves their union."""
    for path in paths:
        # A multi-contour stroke could contain intentional counters. The pinned
        # dataset has exactly one closed contour per independently filled stroke.
        if path.count('M') != 1 or not path.endswith('Z'):
            raise ValueError('Expected one closed contour per stroke')
        area = AreaPen(None)
        parse_path(path, area)
        parse_path(path, ReverseContourPen(pen) if area.value < 0 else pen)


class CubicRecordingPen(BasePen):
    """Record absolute geometry, expressing source quadratic curves as cubics."""
    def __init__(self):
        super().__init__(None)
        self.commands = []

    def _moveTo(self, point):
        self.commands.append(('moveTo', (point,)))

    def _lineTo(self, point):
        self.commands.append(('lineTo', (point,)))

    def _curveToOne(self, p1, p2, p3):
        self.commands.append(('curveTo', (p1, p2, p3)))

    def _closePath(self):
        self.commands.append(('closePath', ()))


def canonical(commands):
    """CFF may leave the final straight segment implicit in closePath."""
    result = []
    start = None
    for operation, points in commands:
        if operation == 'moveTo':
            start = points[0]
        if operation == 'closePath' and result[-1] == ('lineTo', (start,)):
            result.pop()
        result.append((operation, points))
    return result


def verify(path, records):
    font = TTFont(path, recalcTimestamp=False)
    cmap = font.getBestCmap()
    if set(cmap) != {ord(char) for char in records} or ord('甚') in cmap:
        raise ValueError('Generated font character coverage changed')
    glyphs = font.getGlyphSet()
    largest_error = 0
    for char, item in records.items():
        expected, actual = CubicRecordingPen(), CubicRecordingPen()
        draw_strokes(item['paths'], expected)
        glyphs[cmap[ord(char)]].draw(actual)
        left, right = canonical(expected.commands), canonical(actual.commands)
        if len(left) != len(right):
            raise ValueError(f'Contour command count changed for {char}')
        for (op1, points1), (op2, points2) in zip(left, right):
            if op1 != op2 or len(points1) != len(points2):
                raise ValueError(f'Contour command changed for {char}')
            for p1, p2 in zip(points1, points2):
                error = max(abs(a - b) for a, b in zip(p1, p2))
                largest_error = max(largest_error, error)
                if error > .005:
                    raise ValueError(f'Outline geometry changed for {char}: {error}')
    font.close()
    return largest_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/fonts/AnimCJKWorksheet.otf')
    args = parser.parse_args()
    if fontTools.version != '4.60.1':
        raise SystemExit('Use fonttools==4.60.1 for reproducible output.')
    source = (ROOT / 'data/tw.json.gz').read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Pinned Taiwan dataset checksum mismatch.')
    records = json.loads(gzip.decompress(source))
    notice = records.pop('_notice')
    if notice['version'] != REVISION or len(records) != 1013:
        raise SystemExit('Unexpected upstream revision or character count.')
    records = dict(sorted(records.items(), key=lambda item: ord(item[0])))
    names = {ord(char): f'u{ord(char):05X}' for char in records}
    builder = FontBuilder(1024, isTTF=False)
    builder.setupGlyphOrder(['.notdef', *names.values()])
    builder.setupCharacterMap(names)
    charstrings = {'.notdef': T2CharStringPen(1024, None).getCharString()}
    metrics = {'.notdef': (1024, 0)}
    for char, item in records.items():
        pen = T2CharStringPen(1024, None, roundTolerance=0)
        draw_strokes(item['paths'], pen)
        name = names[ord(char)]
        charstrings[name] = pen.getCharString()
        bounds = BoundsPen(None)
        draw_strokes(item['paths'], bounds)
        metrics[name] = (1024, round(bounds.bounds[0]))
    builder.setupCFF(POSTSCRIPT_NAME, {
        'FullName': FAMILY + ' Regular', 'FamilyName': FAMILY,
        'Weight': 'Regular', 'version': '1.000', 'Notice': MODIFICATION,
    }, charstrings, {})
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=900, descent=-124, lineGap=0)
    builder.setupNameTable({
        'familyName': FAMILY, 'styleName': 'Regular',
        'uniqueFontIdentifier': POSTSCRIPT_NAME + ';1.000;' + REVISION,
        'fullName': FAMILY + ' Regular', 'psName': POSTSCRIPT_NAME,
        'version': 'Version 1.000', 'description': MODIFICATION,
        'copyright': 'Copyright 1999 Arphic Technology Co., Ltd.; AnimCJK Copyright 2016-2026 FM&SH.',
        'licenseDescription': (ROOT / 'public/licenses/ARPHICPL.txt').read_text(),
        'licenseInfoURL': 'https://github.com/parsimonhi/animCJK/blob/' + REVISION + '/licenses/APL/english/ARPHICPL.TXT',
    })
    builder.setupOS2(sTypoAscender=900, sTypoDescender=-124, sTypoLineGap=0,
                     usWinAscent=900, usWinDescent=124, fsType=0, fsSelection=0x40)
    builder.setupPost()
    timestamp = calendar.timegm((2026, 9, 22, 0, 0, 0)) + 2082844800
    builder.font['head'].created = builder.font['head'].modified = timestamp
    builder.font.recalcTimestamp = False
    builder.save(args.output)
    error = verify(args.output, records)
    output = args.output.read_bytes()
    print(f'{len(records)} glyphs verified; maximum CFF coordinate error {error:.8f} font units.')
    print(f'{args.output}: {len(output):,} bytes; SHA-256 {hashlib.sha256(output).hexdigest()}')


if __name__ == '__main__':
    main()
