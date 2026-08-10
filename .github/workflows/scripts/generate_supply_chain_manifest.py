#!/usr/bin/env python3
import hashlib, json, os, subprocess
from pathlib import Path
from datetime import datetime, timezone

root=Path(__file__).resolve().parents[2]
out=root/'.audit-artifacts'; out.mkdir(exist_ok=True)
components=[]
for rel in ['mail-worker/package.json','mail-vue/package.json','cfmail-push-gateway/package.json']:
    p=root/rel; data=json.loads(p.read_text())
    for scope in ('dependencies','devDependencies'):
        for name,version in sorted(data.get(scope,{}).items()):
            components.append({'SPDXID':f'SPDXRef-{len(components)+1}','name':name,'versionInfo':version,'downloadLocation':'NOASSERTION','filesAnalyzed':False,'supplier':'NOASSERTION','comment':f'{rel}:{scope}'})
files=[]
for pattern in ['mail-worker/package.json','mail-worker/pnpm-lock.yaml','mail-vue/package.json','mail-vue/pnpm-lock.yaml','cfmail-push-gateway/package.json','cfmail-push-gateway/pnpm-lock.yaml','mail-ios/Gemfile.lock','mail-ios/Package.resolved']:
    p=root/pattern
    if p.exists(): files.append({'path':pattern,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
try: commit=subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip()
except Exception: commit=os.environ.get('GITHUB_SHA','unknown')
created=datetime.now(timezone.utc).replace(microsecond=0).isoformat()
sbom={'spdxVersion':'SPDX-2.3','dataLicense':'CC0-1.0','SPDXID':'SPDXRef-DOCUMENT','name':'CF-Mail-CloudMail-source-dependency-sbom','documentNamespace':f'https://cfmail.readori.com/sbom/{commit}','creationInfo':{'created':created,'creators':['Tool: CloudMail supply-chain manifest generator']},'packages':components,'externalDocumentRefs':[],'annotations':[{'annotationType':'OTHER','annotator':'Tool: CloudMail CI','annotationDate':created,'comment':'Direct dependency inventory; lockfile digests bind the complete resolved dependency graph.'}]}
(out/'sbom.spdx.json').write_text(json.dumps(sbom,indent=2,ensure_ascii=False)+'\n')
artifacts=[]
artifact_candidates=[]
for base in [root/'mail-ios'/'build', root/'build']:
    if not base.exists(): continue
    for pattern in ('*.ipa','*.zip','*.xcarchive'):
        artifact_candidates.extend(base.rglob(pattern))
for p in sorted(set(artifact_candidates)):
    if p.is_file():
        artifacts.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
prov={'schemaVersion':1,'sourceCommit':commit,'repository':os.environ.get('GITHUB_REPOSITORY','local'),'workflow':os.environ.get('GITHUB_WORKFLOW','local'),'runId':os.environ.get('GITHUB_RUN_ID','local'),'generatedAt':created,'lockedInputs':files,'artifactDigests':artifacts}
(out/'release-provenance.json').write_text(json.dumps(prov,indent=2,ensure_ascii=False)+'\n')
checks=[]
for p in sorted(out.glob('*.json')): checks.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}")
(out/'checksums.sha256').write_text('\n'.join(checks)+'\n')
print('Generated', out/'sbom.spdx.json')
print('Generated', out/'release-provenance.json')
print('Generated', out/'checksums.sha256')
