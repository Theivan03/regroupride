#!/usr/bin/env python3
"""Genera la web de eventos en un solo archivo (para subirlo a mano a Netlify arrastrándolo).
Uso: python3 tools/web_single.py salida.html [--local]   (--local deja las bibliotecas y fuentes como archivos locales)
Necesita terser (npm i terser) en TERSER o en el PATH."""
import base64, os, re, subprocess, sys, tempfile
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
out = sys.argv[1]; local = '--local' in sys.argv
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
m = re.search(r'<script>\n(.*)</script>', s, re.S)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(m.group(1))
js = subprocess.check_output([os.environ.get('TERSER', 'terser'), f.name, '-c', '-m'], text=True)
s = s[:m.start()] + '<script>' + js.strip() + '</script>' + s[m.end():]
if not local:
    sym = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(root, 'simbolo.svg'), 'rb').read()).decode()
    s = re.sub(r'@font-face\{[^}]*\}\n', '', s)
    s = s.replace('<link rel="icon" href="/favicon.ico">', '<link rel="icon" href="' + sym + '"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Outfit:wght@100..900&display=swap">')
    s = s.replace('<script src="/supabase.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>')
    s = s.replace('"/qrcode.js"', '"https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js"').replace('"/jsqr.js"', '"https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"')
    assert 'jsdelivr.net/npm/jsqr' in s and 'qrcode-generator' in s
    s = s.replace('/simbolo.svg', sym)
open(out, 'w', encoding='utf-8').write(s)
print(out, len(s.encode()))
