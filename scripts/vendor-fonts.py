"""Maintenance only (Python 3): vendor fonts; npm/build never downloads them."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
specs = (ROOT / 'src/engine/constants.ts').read_text(encoding='utf-8').split('export const FONT_SPECS')[1].split('};')[0]
families = {a or b: spec for a, b, spec in re.findall(r"(?:'([^']+)'|(\w+)):\s*'([^']*)'", specs)}
families.update({'Newsreader': 'wght@600', 'Noto Serif SC': 'wght@500;600;700;900', 'Saira Condensed': 'wght@500;600;700;800'})
AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
destination = ROOT / 'public/fonts'
destination.mkdir(parents=True, exist_ok=True)
manifest = {'generated': date.today().isoformat(), 'families': {}}

def download(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': AGENT}), timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)

def sha(data):
    return hashlib.sha256(data).hexdigest()

for family, spec in families.items():
    slug = family.lower().replace(' ', '-')
    directory = destination / slug
    directory.mkdir(exist_ok=True)
    upstream = f"https://raw.githubusercontent.com/google/fonts/main/ofl/{family.lower().replace(' ', '')}/OFL.txt"
    license_data = download(upstream)
    assert b'SIL OPEN FONT LICENSE Version 1.1' in license_data, f'Unverified licence: {family}'
    source = 'https://fonts.googleapis.com/css2?family=' + quote(family + (':' + spec if spec else '')) + '&display=swap'
    css = download(source).decode('utf-8')
    urls = sorted(set(re.findall(r'url\((https:[^)]+)\)', css)))

    def asset(url):
        name = sha(url.encode())[:20] + '.woff2'
        target = directory / name
        data = target.read_bytes() if target.exists() else download(url)
        assert data[:4] == b'wOF2', f'Expected WOFF2: {url}'
        target.write_bytes(data)
        return name, {'source': url, 'sha256': sha(data), 'bytes': len(data)}

    with ThreadPoolExecutor(max_workers=8) as pool:
        assets = dict(pool.map(asset, urls))
    for name, info in assets.items():
        css = css.replace(info['source'], './' + name)
    (directory / 'font.css').write_text(css, encoding='utf-8')
    (directory / 'OFL.txt').write_bytes(license_data)
    manifest['families'][family] = {'css': slug + '/font.css', 'source': source, 'license': 'OFL-1.1', 'licenseSource': upstream, 'licenseSha256': sha(license_data), 'assets': assets}
    print(f'{family}: {len(urls)} WOFF2 subsets', flush=True)

(destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Font assets and upstream licences saved in public/fonts.', flush=True)
