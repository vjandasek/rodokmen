"""Builds src/fonts/noto-sans-400.ttf and -700.ttf for the PDF export (src/pdf.ts).

jsPDF embeds TrueType fonts, while the app bundles Noto Sans as WOFF2 split into a Latin and a
Latin Extended subset (src/fonts.css). This merges both subsets of each weight into one TTF.
Needs fontTools and brotli (pip install fonttools brotli). Run from FamTreeWeb/:

    python3 scripts/fonts_to_ttf.py
"""
import os
import tempfile

from fontTools.merge import Merger, Options
from fontTools.ttLib import TTFont

FONTS = 'src/fonts'
# Every Czech letter and the symbols the tree uses must be in the result.
NEEDED = 'AaZz ÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž†–'


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for weight in ('400', '700'):
            parts = []
            for subset in ('latin', 'latin-ext'):
                font = TTFont(os.path.join(FONTS, f'noto-sans-{subset}-{weight}-normal.woff2'))
                font.flavor = None
                path = os.path.join(tmp, f'{subset}-{weight}.ttf')
                font.save(path)
                parts.append(path)
            merged = Merger(options=Options(drop_tables=['vhea', 'vmtx'])).merge(parts)
            out = os.path.join(FONTS, f'noto-sans-{weight}.ttf')
            merged.save(out)
            cmap = TTFont(out).getBestCmap()
            missing = [c for c in NEEDED if ord(c) not in cmap]
            if missing:
                raise SystemExit(f'{out}: missing {missing}')
            print(out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
