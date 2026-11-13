// Unit tests for LayerBoat's pure maths and encoding, run in Node:
//   node tests/unit.js
// Functions are taken straight from the shipped source, so these test the
// real code, not copies.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'after-effects/layerboat-core.jsx'), 'utf8');
const plugin = fs.readFileSync(path.join(root, 'figma-plugin/code.js'), 'utf8');

// pull one function's source out of a file by name
function grab(src, name) {
  const re = new RegExp('(^|\\n)( *)(async )?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('missing ' + name);
  const start = m.index + m[1].length, indent = m[2];
  const end = src.indexOf('\n' + indent + '}', start);
  return src.slice(start, end + indent.length + 2);
}
const ctx = {};
const load = (src, names) => { new Function('ctx', names.map((n) => grab(src, n)).join('\n') + '\n' + names.map((n) => 'ctx.' + n + ' = ' + n + ';').join('\n'))(ctx); };
load(core, ['svd2', 'groupTransformOf', 'inv2', 'mMul', 'mR', 'mS', 'mT', 'mApply', 'groupMatrix', 'fromBase64', 'base64Of', 'asciiJSON', 'pathData']);
ctx.B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
global.B64 = ctx.B64;
load(plugin, ['r', 'invert', 'apply', 'mul', 'parsePathData', 'gradientPaint']);
global.r = ctx.r;

let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
}
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);
const rand = (a, b) => a + Math.random() * (b - a);

// svd2 rebuilds the matrix it split
for (let t = 0; t < 200; t++) {
  const M = [rand(-3, 3), rand(-3, 3), rand(-3, 3), rand(-3, 3)];
  const s = ctx.svd2(M), R = (a) => [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]];
  const mul2 = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
  const X = mul2(mul2(R(s.phi), [[s.s1, 0], [0, s.s2]]), R(s.theta)).flat();
  check('svd2 round trip', X.every((v, i) => near(v, M[i], 1e-9)), M.join(','));
}
// a shape group's transform, as After Effects applies it, gives back the matrix
global.val = (g, n, fb) => (g && g[n] !== undefined ? g[n] : fb);
for (let t = 0; t < 200; t++) {
  const M = [rand(-3, 3), rand(-3, 3), rand(-3, 3), rand(-3, 3)];
  const g = ctx.groupTransformOf(M);
  if (Math.abs(g.skew) > 85) continue;
  const sk = ctx.mMul(ctx.mMul(ctx.mR(0), [1, 0, -Math.tan(g.skew * Math.PI / 180), 1, 0, 0]), ctx.mR(0));
  const G = ctx.mMul(ctx.mMul(ctx.mR(g.rotation), sk), ctx.mS(g.scale[0] / 100, g.scale[1] / 100));
  check('group transform round trip', [G[0], G[2], G[1], G[3]].every((v, i) => near(v, M[i], 1e-9)), M.join(','));
}
// base64 both ways, on random binary
for (let t = 0; t < 20; t++) {
  const b = crypto.randomBytes(1 + Math.floor(Math.random() * 50000));
  const bin = b.toString('latin1');
  check('base64 encode', ctx.base64Of(bin) === b.toString('base64'));
  check('base64 decode', ctx.fromBase64(b.toString('base64')) === bin);
}
// JSON sent as plain ASCII still means the same thing
const sample = { name: '₦50,000 · café 你好 🙂', n: [1, 2.5] };
const ascii = ctx.asciiJSON(sample);
check('asciiJSON is ASCII', /^[\x00-\x7f]*$/.test(ascii));
check('asciiJSON round trip', JSON.stringify(JSON.parse(ascii)) === JSON.stringify(sample));
// SVG path data parses back to the same points
const parsed = ctx.parsePathData('M 0 0 L 10 0 L 10 10 Z');
check('path parse: one closed path', parsed.length === 1 && parsed[0].closed && parsed[0].v.length === 3);
// a gradient sent from After Effects lands in Figma where it started
for (let t = 0; t < 50; t++) {
  const node = { x: rand(-50, 50), y: rand(-50, 50), width: rand(20, 300), height: rand(20, 300) };
  const g = { type: Math.random() < 0.5 ? 'LINEAR' : 'RADIAL', start: [rand(-50, 300), rand(-50, 300)], end: [rand(-50, 300), rand(-50, 300)], stops: [{ pos: 0, color: [1, 0, 0, 1] }, { pos: 1, color: [0, 0, 1, 1] }] };
  const p = ctx.gradientPaint(g, node, 1);
  const inv = ctx.invert(p.gradientTransform);
  // Figma: gradient space (0, 0.5) is the start for linear, (0.5, 0.5) the centre for radial
  const s0 = ctx.apply(inv, g.type === 'LINEAR' ? 0 : 0.5, 0.5), e0 = ctx.apply(inv, 1, 0.5);
  const toPx = (q) => [node.x + q[0] * node.width, node.y + q[1] * node.height];
  const S = toPx(s0), E = toPx(e0);
  const wantE = g.type === 'LINEAR' ? g.end : g.end;
  check('gradient to Figma: start', near(S[0], g.start[0], 1e-6) && near(S[1], g.start[1], 1e-6), S + ' vs ' + g.start);
  check('gradient to Figma: end', near(E[0], wantE[0], 1e-6) && near(E[1], wantE[1], 1e-6), E + ' vs ' + wantE);
}
// Illustrator's JSON writer: control characters and non-ASCII survive the trip
const aiSrc = fs.readFileSync(path.join(root, 'after-effects/illustrator-export.jsx'), 'utf8');
const ai = {};
new Function('ai', grab(aiSrc, 'toJSON') + '\n' + grab(aiSrc, 'sameStyle') + '\nai.toJSON = toJSON; ai.sameStyle = sameStyle;')(ai);
for (const v of ['The many faces\rof the sea', 'naira \u20a6 50', 'quote " and \\ slash', 'tab\tend', '']) {
  const back = JSON.parse(ai.toJSON({ characters: v }));
  check('Illustrator JSON keeps ' + JSON.stringify(v), back.characters === v, JSON.stringify(back.characters));
}
check('Illustrator JSON is plain ASCII', /^[\x20-\x7e]*$/.test(ai.toJSON({ a: 'é\r€', b: [1, null, true] })));
const segA = { start: 0, end: 1, fontFamily: 'Inter', fontSize: 12, color: [0, 0, 0, 1] };
check('matching text runs join', ai.sameStyle(segA, Object.assign({}, segA, { start: 1, end: 2 })));
check('different colours stay apart', !ai.sameStyle(segA, Object.assign({}, segA, { color: [1, 0, 0, 1] })));
// After Effects to Illustrator: the comp as SVG must be well formed, with names kept
{
  const sx = {};
  load(core, ['mApply', 'asciiJSON', 'fmt', 'pathBox', 'mergePaths', 'xmlText', 'svgNum', 'svgColor', 'svgWriter', 'svgPaint', 'svgOpacity', 'svgVector', 'svgText', 'svgImage', 'svgItems', 'compSvg']);
  Object.assign(sx, ctx);
  const layers = [
    { kind: 'vector', name: 'Card & "bg"', paths: ['M 0 0 C 0 0 100 0 100 0 C 100 0 100 50 100 50 Z'], fill: [1, 0, 0], fillOpacity: 0.5, opacity: 1 },
    { kind: 'vector', name: 'Card & "bg"', paths: ['M 0 0 L 10 10'], stroke: [0, 0, 1], strokeWidth: 2, cap: 'ROUND', join: 'BEVEL', dashes: [4, 2], opacity: 0.8 },
    { kind: 'vector', name: 'Glow', paths: ['M 0 0 Z'], fillGradient: { type: 'RADIAL', start: [0, 0], end: [3, 4], stops: [{ pos: 0, color: [1, 1, 1, 1] }, { pos: 1, color: [0, 0, 0, 0.5] }] }, opacity: 1 },
    { kind: 'text', name: '1st <title>', text: 'Hello\rWorld', family: 'Inter', ps: 'Inter-Bold', size: 40, color: [0, 0, 0], align: 'CENTER', origin: [50, 60], rotation: 0, opacity: 1, x: 0, y: 0, tracking: 20 },
    { kind: 'text', name: 'runs', text: 'ab\rcd', family: 'Inter', size: 20, color: [0, 0, 0], align: 'LEFT', lineStarts: [[10, 20], [10, 44]], rotation: 90, opacity: 1, x: 0, y: 0,
      runs: [{ start: 0, end: 3, family: 'Inter', ps: 'Inter-Regular', size: 20, color: [1, 0, 0] }, { start: 3, end: 5, family: 'Inter', ps: 'Inter-Bold', size: 20, color: [0, 1, 0] }] },
    { kind: 'image', name: 'photo', image: '/a/b.png', x: 5, y: 6, width: 10, height: 20, rotation: 0, opacity: 1 },
    { kind: 'frame', name: 'Pre comp', x: 1, y: 2, width: 30, height: 40, rotation: 10, scale: 0.5, opacity: 1, children: [{ kind: 'group', name: 'G', opacity: 0.5, children: [] }] },
  ];
  const svg = sx.compSvg({ width: 200, height: 100 }, layers, { '/a/b.png': 'iVBORw0KGgo=' });
  const py = require('child_process').spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as E; r=E.fromstring(sys.stdin.read()); print(len(list(r.iter())))'], { input: svg });
  check('comp SVG is well formed XML', py.status === 0, String(py.stderr));
  check('SVG ids are unique', (() => { const ids = svg.match(/ id="[^"]*"/g); return new Set(ids).size === ids.length; })());
  const rect = 'M 0 0 C 0 0 384 0 384 0 C 384 0 384 576 384 576 C 384 576 0 576 0 576 C 0 576 0 0 0 0 Z', glyph = 'M 10 10 C 12 10 20 12 20 20 Z';
  let mg = sx.mergePaths([glyph, rect], 4);
  check('intersect with a rectangle keeps the artwork', mg.paths.length === 1 && mg.paths[0] === glyph && mg.exact, JSON.stringify(mg));
  mg = sx.mergePaths([rect, 'M 10 10 L 50 10 L 50 50 L 10 50 Z'], 4);
  check('two rectangles intersect to their overlap', mg.paths.length === 1 && /M 10 10 L 50 10/.test(mg.paths[0]), JSON.stringify(mg));
  check('subtract inside becomes even-odd', sx.mergePaths([rect, glyph], 3).evenodd && sx.mergePaths([rect, glyph], 3).exact);
  check('add stays non-zero', !sx.mergePaths([rect, glyph], 2).evenodd);
  check('artwork past a clipping rectangle is clipped to it', JSON.stringify(sx.mergePaths(['M -5 10 L 20 10 L 20 20 Z', rect], 4).clip) === '[0,0,384,576]');
  check('a curve is not taken for a rectangle', !sx.pathBox(glyph).rect && sx.pathBox(rect).rect);
  check('SVG keeps plain layer names', svg.indexOf('data-name="Card &amp; &quot;bg&quot;"') > 0);
  check('SVG gives repeated names their own ids', /id="bn1" data-name="Card &amp; &quot;bg&quot;"/.test(svg) && /id="bn2" data-name="Card &amp; &quot;bg&quot;"/.test(svg));
  const note = JSON.parse(decodeURIComponent(svg.slice(svg.indexOf('<!-- bridge-text:') + 17, svg.indexOf(' -->'))));
  const recs = Object.keys(note).map((k) => note[k]);
  check('text travels in the note, a line per line', recs[0].lines.length === 2 && recs[0].lines[0][0].text === 'Hello' && recs[0].lines[1][0].text === 'World' && recs[0].align === 'CENTER', JSON.stringify(recs[0]));
  check('text runs are split at their lines', recs[1].lines[0].map((r) => r.text).join('|') === 'ab' && recs[1].lines[1].map((r) => r.text).join('|') === 'cd', JSON.stringify(recs[1].lines));
  check('text runs keep their PostScript fonts', recs[1].lines[1][0].ps === 'Inter-Bold' && recs[1].lines[0][0].ps === 'Inter-Regular');
  check('each text leaves a square where it goes', /<path id="bn\d+" data-name="runs" fill="none" stroke="none" d="M /.test(svg));
  check('the note keeps names out of the comment', note && svg.indexOf('<!-- bridge-text:') < svg.indexOf('<svg'));
  check('the comp clip comes last in the defs and wraps everything', /<g clip-path="url\(#clip1\)">/.test(svg) && /id="clip1"><rect width="200" height="100"/.test(svg));
}
// ExtendScript is ES3: a reserved word as a bare object key is a syntax error there
for (const [label, text] of [['core', core], ['Illustrator part', aiSrc]]) {
  const bad = text.match(/[{,]\s*(switch|default|case|class|new|delete|in|for|if|do|var|function|return|this|typeof|void|with|catch|finally|throw|try|while|break|continue|instanceof|import|export|enum|super|const|extends|null|true|false)\s*:/g);
  check('no reserved words as bare keys in the ' + label, !bad, bad && bad.join(' '));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
