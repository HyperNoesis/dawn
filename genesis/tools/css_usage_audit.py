#!/usr/bin/env python3
"""CSS dead-rule audit for css/genesis-system.css.
A top-level (or @media-nested) style rule is 'provably unused' only when EVERY selector in its list contains at least
one class/id token that appears NOWHERE in any *.html, *.js (js/, root, vendor excluded) as a substring. Class names built
dynamically from fragments are caught by the substring test (fragments of the name must be absent too, so we test the whole
token and also its dash-prefix up to the last '-' when the token ends with a digit-less variant). Conservative by design.
Usage: css_usage_audit.py [--apply]"""
import glob, os, re, sys, json, tinycss2
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css_path = os.path.join(root, 'css', 'genesis-system.css')
src = open(css_path, encoding='utf-8').read()
corpus = ''
for pat in ('*.html', 'js/**/*.js', 'tools/e2e/*.js'):
    for f in glob.glob(os.path.join(root, pat), recursive=True):
        if '/vendor/' in f: continue
        corpus += open(f, encoding='utf-8', errors='ignore').read() + '\n'
tok_re = re.compile(r'[.#]([A-Za-z_][\w-]*)')
def used(tok):
    if tok in corpus: return True
    # dynamic names like 'tab-' + x  -> keep if the prefix up to last '-' appears followed by quote/concat
    if '-' in tok:
        pre = tok.rsplit('-', 1)[0] + '-'
        if re.search(re.escape(pre) + r'[\'"`$+]', corpus): return True
    return False
rules = tinycss2.parse_stylesheet(src, skip_comments=False, skip_whitespace=False)
dead, total = [], 0
def walk(nodes):
    global total
    for n in nodes:
        if n.type == 'qualified-rule':
            total += 1
            sel = tinycss2.serialize(n.prelude)
            parts = [s.strip() for s in sel.split(',') if s.strip()]
            if re.search(r':(not|is|where|has)\(', sel): continue
            if all((lambda toks: toks and all(not used(t) for t in toks[:1]) )(tok_re.findall(p)) or False for p in parts):
                dead.append((n.source_line, sel.strip()[:100]))
        elif n.type == 'at-rule' and n.lower_at_keyword in ('media', 'supports') and n.content:
            walk(tinycss2.parse_rule_list(n.content, skip_comments=True, skip_whitespace=True))
walk(rules)
if '--apply' in sys.argv:
    deadlines = {l for l, _ in dead}
    def rebuild(nodes):
        out = []
        for n in nodes:
            if n.type == 'qualified-rule' and n.source_line in deadlines and tinycss2.serialize(n.prelude).strip()[:100] in {d for _, d in dead if _ == n.source_line}: continue
            if n.type == 'at-rule' and n.lower_at_keyword in ('media', 'supports') and n.content:
                inner = rebuild(tinycss2.parse_rule_list(n.content, skip_comments=False, skip_whitespace=False))
                if not ''.join(inner).strip(): continue
                out.append('@' + n.at_keyword + tinycss2.serialize(n.prelude) + '{' + ''.join(inner) + '}'); continue
            out.append(n.serialize())
        return out
    open(css_path, 'w', encoding='utf-8').write(''.join(rebuild(rules)))
    print('applied; bytes', len(src), '->', os.path.getsize(css_path))
json.dump({'rules': total, 'provably_unused': len(dead), 'sample': dead[:60]}, open(os.path.join(root, 'reports', 'css_usage_audit.json'), 'w'), indent=1)
print('rules', total, 'provably unused', len(dead))
for d in dead[:25]: print(d)
