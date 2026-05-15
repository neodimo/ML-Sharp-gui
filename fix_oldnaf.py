#!/usr/bin/env python3
from pathlib import Path

# Read upstream NAF loader
upstream = Path('/home/omid/.openclaw/workspace/research-pixal3d/Pixal3D/pixal3d/trainers/flow_matching/mixins/image_conditioned_proj.py').read_text().replace('\r\n', '\n')
up_idx = upstream.find('    def _load_naf(self):')
up_end = upstream.find('\n    def ', up_idx + 1)
upstream_naf = upstream[up_idx:up_end]

print(f"Upstream NAF: {len(upstream_naf)} chars")

# Read main.cjs
src = Path('src/main.cjs').read_text()

# Find the imageCond block
ic_idx = src.find("if (!imageCond.includes('naf_checkpoint_url'))")
search = src[ic_idx:ic_idx + 3000]
old_start_in_search = search.find('const oldLoadNaf')
backtick_idx = search.find('`', old_start_in_search)
closing_backtick_idx = search.find('`', backtick_idx + 1)
semicolon_idx = search.find(';', closing_backtick_idx)
old_end_in_search = semicolon_idx + 1
old_template = search[old_start_in_search:old_end_in_search]

print(f"Old template: {len(old_template)} chars")
if old_template:
    print(f"  First 80: {repr(old_template[:80])}")
else:
    print("  ERROR: template not found!")
    import sys; sys.exit(1)

# Build the new template
# The Python content goes between backticks
escaped = upstream_naf.replace('`', '\\\\`')
new_template = 'const oldLoadNaf = `' + escaped + '`;'

# Find absolute positions in src
full_old_start = ic_idx + old_start_in_search
full_old_end = ic_idx + old_end_in_search

print(f"\nFull positions: start={full_old_start}, end={full_old_end}")
print(f"Original src[{full_old_start}:{full_old_end}]:")
print(repr(src[full_old_start:full_old_end + 20]))

new_src = src[:full_old_start] + new_template + src[full_old_end:]
Path('src/main.cjs').write_text(new_src)
print(f"\nReplaced. New file length: {len(new_src)}")

# Verify
s2 = Path('src/main.cjs').read_text()
ki = s2.find('const oldLoadNaf')
bi = s2.find('`', ki)
ci = s2.find('`', bi + 1)
raw = s2[bi+1:ci]
print(f"Verify extracted: {len(raw)} chars, match? {raw == upstream_naf}")
if raw != upstream_naf:
    for i in range(min(len(raw), len(upstream_naf))):
        if raw[i] != upstream_naf[i]:
            print(f"First diff at {i}: {repr(raw[i:i+20])} vs {repr(upstream_naf[i:i+20])}")
            break