#!/usr/bin/env python3
"""Static control inventory for studio.html: every button/input/select/a/[role=tab] with an id,
and whether any script or inline handler references that id. A control with no reference
and no inline handler is a *candidate* dead control (needs manual confirmation)."""
import re, sys, json, glob, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(root, 'studio.html'), encoding='utf-8').read()
code = ''
for f in glob.glob(os.path.join(root, 'js', '**', '*.js'), recursive=True):
    code += open(f, encoding='utf-8', errors='ignore').read()
tag = re.compile(r'<(button|input|select|textarea|a)\b([^>]*)>', re.I)
rows = []
for m in tag.finditer(html):
    attrs = m.group(2)
    idm = re.search(r'\bid="([^"]+)"', attrs)
    if not idm: continue
    cid = idm.group(1)
    inline = bool(re.search(r'\bon\w+=', attrs)) or 'href="#' in attrs and False
    refs = len(re.findall(r'[\'"`#]' + re.escape(cid) + r'[\'"`\s\)\.\[,]', code))
    typ = re.search(r'\btype="([^"]+)"', attrs)
    if m.group(1).lower() == 'a' and 'href="' in attrs and 'href="#"' not in attrs: kind = 'link'
    else: kind = m.group(1).lower()
    rows.append({'id': cid, 'tag': kind, 'inline_handler': inline, 'js_refs': max(refs, 0)})
cand = [r for r in rows if r['js_refs'] == 0 and not r['inline_handler'] and r['tag'] != 'link']
json.dump({'total_controls_with_id': len(rows), 'candidate_dead': cand, 'all': rows}, open(os.path.join(root, 'reports', 'studio_control_inventory.json'), 'w'), indent=1)
print('controls with id:', len(rows), ' candidate dead:', len(cand))
for r in cand: print('  ', r['tag'], r['id'])
