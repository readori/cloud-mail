#!/usr/bin/env python3
from pathlib import Path
import re, sys, yaml

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / '.github/workflows'
errors=[]
sha_re=re.compile(r'^[0-9a-f]{40}$')
for path in sorted(WF.glob('*.yml')):
    text=path.read_text(encoding='utf-8')
    for i,line in enumerate(text.splitlines(),1):
        m=re.search(r'\buses:\s*([^\s#]+)', line)
        if not m: continue
        target=m.group(1)
        if target.startswith('./'): continue
        if '@' not in target:
            errors.append(f'{path}:{i}: external action missing ref: {target}')
            continue
        ref=target.rsplit('@',1)[1]
        if not sha_re.fullmatch(ref):
            errors.append(f'{path}:{i}: external action must be pinned to full commit SHA: {target}')

for path in sorted(WF.glob('*.yml')):
    text=path.read_text(encoding='utf-8')
    if 'actions/setup-node@' in text and "node-version: '22.23.2'" not in text and 'node-version: "22.23.2"' not in text:
        errors.append(f'{path}: setup-node must pin Node 22.23.2')

lock = ROOT/'cfmail-push-gateway/pnpm-lock.yaml'
if not lock.is_file(): errors.append('push gateway pnpm-lock.yaml missing')
if 'pnpm install --frozen-lockfile' not in (WF/'push-gateway-deploy.yml').read_text():
    errors.append('push gateway production workflow must use frozen lockfile')
if not (ROOT/'.github/scripts/generate_supply_chain_manifest.py').is_file():
    errors.append('supply chain manifest generator missing')

if errors:
    print('\n'.join('ERROR: '+e for e in errors)); sys.exit(1)
print('PASS: workflows pin external actions by commit SHA, Node/pnpm are deterministic, and production installs use lockfiles.')
