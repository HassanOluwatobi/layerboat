// LayerBoat to After Effects: Figma side.
// Reads the selection and turns it into a JSON description the AE panel rebuilds.

figma.showUI(__html__, { width: 280, height: 290, themeColors: true });
// Temporary copies used for measuring and exporting live in one frame at the
// bottom of the layers list, kept collapsed and removed when the work is done,
// so they never flash at the top of the layers panel. The frame sits at the
// page origin, so a copy's position inside it equals its position on the page.
var SCRATCH = null;
function scratch() {
  if (SCRATCH && !SCRATCH.removed) return SCRATCH;
  var f = figma.createFrame();
  f.name = 'LayerBoat (working, removed automatically)';
  f.fills = []; f.clipsContent = false; f.x = 0; f.y = 0; f.resize(1, 1);
  figma.currentPage.insertChild(0, f);
  try { f.expanded = false; } catch (e) {}
  SCRATCH = f;
  return f;
}
function dropScratch() {
  try { if (SCRATCH && !SCRATCH.removed) SCRATCH.remove(); } catch (e) {}
  SCRATCH = null;
}

// The status line in the plugin follows the selection
var busy = false;
function selSummary() {
  var s = figma.currentPage.selection;
  if (!s.length) return 'Select layers or a frame.';
  if (separateFrames(s)) return s.length + ' frames selected. Each becomes its own comp.';
  if (s.length === 1) return '\u201c' + s[0].name + '\u201d is ready to send.';
  return s.length + ' layers selected. They go across together.';
}
// a selection LayerBoat restores itself is not news, so the result of a send stays on screen
var quietUntil = 0;
function postSel() { if (!busy && Date.now() > quietUntil) figma.ui.postMessage({ type: 'sel', text: selSummary() }); }
figma.on('selectionchange', postSel);
figma.on('currentpagechange', function () { dropScratch(); postSel(); });


var warnings = {};
function warn(key) { warnings[key] = true; }

// ---------- matrix helpers (Figma 2x3: [[a, c, tx], [b, d, ty]]) ----------
function mul(m, n) {
  return [
    [m[0][0] * n[0][0] + m[0][1] * n[1][0], m[0][0] * n[0][1] + m[0][1] * n[1][1], m[0][0] * n[0][2] + m[0][1] * n[1][2] + m[0][2]],
    [m[1][0] * n[0][0] + m[1][1] * n[1][0], m[1][0] * n[0][1] + m[1][1] * n[1][1], m[1][0] * n[0][2] + m[1][1] * n[1][2] + m[1][2]]
  ];
}
function invert(m) {
  var a = m[0][0], c = m[0][1], tx = m[0][2], b = m[1][0], d = m[1][1], ty = m[1][2];
  var det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0]];
  return [
    [d / det, -c / det, (c * ty - d * tx) / det],
    [-b / det, a / det, (b * tx - a * ty) / det]
  ];
}
function apply(m, x, y) {
  return [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]];
}
function decompose(m) {
  var a = m[0][0], b = m[1][0], c = m[0][1], d = m[1][1];
  var sx = Math.sqrt(a * a + b * b);
  var det = a * d - b * c;
  var sy = sx ? det / sx : 0;
  var rot = Math.atan2(b, a) * 180 / Math.PI;
  // whatever rotation and scale leave over is a skew along x
  var shear = sx ? (a * c + b * d) / sx / sx : 0;
  return { x: m[0][2], y: m[1][2], rotation: rot, scaleX: sx * 100, scaleY: sy * 100, skew: Math.atan(shear) * 180 / Math.PI };
}
function r(n) { return Math.round(n * 1000) / 1000; }

// ---------- colour / paint ----------
function col(c, extraOpacity) {
  var a = (c.a === undefined ? 1 : c.a) * (extraOpacity === undefined ? 1 : extraOpacity);
  return [r(c.r), r(c.g), r(c.b), r(a)];
}

function paints(list, w, h, fancy) {
  var out = [];
  if (!list || list === figma.mixed) return out;
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.visible === false) continue;
    var op = p.opacity === undefined ? 1 : p.opacity;
    if (p.type === 'SOLID') {
      out.push({ type: 'solid', color: col(p.color), opacity: r(op), blend: p.blendMode || 'NORMAL' });
    } else if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') {
      var T = p.gradientTransform, isRadial = p.type === 'GRADIENT_RADIAL', sp, ep;
      if (!isRadial) {
        // t = T00*x/w + T01*y/h + T02 along the gradient. In pixels the
        // gradient runs along g = (T00/w, T01/h), so the ramp is exact even
        // on shapes that are not square.
        var gx = T[0][0] / (w || 1), gy = T[0][1] / (h || 1), g2 = gx * gx + gy * gy;
        if (g2 < 1e-12) { out.push({ type: 'raster' }); continue; }
        var sx0 = -T[0][2] * gx / g2, sy0 = -T[0][2] * gy / g2;
        sp = [sx0, sy0]; ep = [sx0 + gx / g2, sy0 + gy / g2];
      } else {
        // The radial shape in pixels is the unit circle through inv(T) scaled
        // by w and h. After Effects can only draw circles, so ellipses are
        // rendered by Figma instead.
        var inv = invert(T);
        var ax = inv[0][0] * w, ay = inv[1][0] * h, bx = inv[0][1] * w, by = inv[1][1] * h;
        var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
        if (Math.abs(la - lb) > 0.02 * Math.max(la, lb) || Math.abs(ax * bx + ay * by) > 0.02 * la * lb) { out.push(fancy ? affinePaint('radial2', p, w, h, op) : { type: 'raster' }); continue; }
        var c0 = apply(inv, 0.5, 0.5);
        sp = [c0[0] * w, c0[1] * h]; ep = [sp[0] + la / 2, sp[1]];
      }
      var stops = [];
      for (var k = 0; k < p.gradientStops.length; k++) {
        var st = p.gradientStops[k];
        stops.push({ pos: r(st.position), color: col(st.color) });
      }
      out.push({
        type: isRadial ? 'radial' : 'linear',
        start: [r(sp[0]), r(sp[1])],
        end: [r(ep[0]), r(ep[1])],
        stops: stops,
        opacity: r(op),
        blend: p.blendMode || 'NORMAL'
      });
    } else if (fancy && (p.type === 'GRADIENT_ANGULAR' || p.type === 'GRADIENT_DIAMOND')) {
      // drawn natively in After Effects from the gradient's own transform
      out.push(affinePaint(p.type === 'GRADIENT_ANGULAR' ? 'angular' : 'diamond', p, w, h, op));
    } else if (p.type === 'GRADIENT_ANGULAR' || p.type === 'GRADIENT_DIAMOND' || p.type === 'IMAGE' || p.type === 'VIDEO') {
      // After Effects has no equivalent, so these are rendered by Figma as an exact PNG
      out.push({ type: 'raster', blend: p.blendMode || 'NORMAL' });
    }
  }
  return out;
}

// Angular, diamond and elliptical radial gradients as a centre and a matrix
// taking gradient space (centred on 0.5, 0.5) to the layer's pixels.
function affinePaint(type, p, w, h, op) {
  var inv = invert(p.gradientTransform);
  var c = apply(inv, 0.5, 0.5);
  var stops = [];
  for (var k = 0; k < p.gradientStops.length; k++) stops.push({ pos: r(p.gradientStops[k].position), color: col(p.gradientStops[k].color) });
  return {
    type: type,
    center: [r(c[0] * w), r(c[1] * h)],
    m: [inv[0][0] * w, inv[0][1] * w, inv[1][0] * h, inv[1][1] * h],
    stops: stops,
    opacity: r(op),
    blend: p.blendMode || 'NORMAL'
  };
}

var DASH_RASTER = false;
// ---------- raster jobs ----------
// Anything After Effects cannot draw natively is rendered by Figma as an exact
// 2x PNG: image fills, angular and diamond gradients, gradient strokes, arrows.
var imageJobs = [];
var textJobs = [];

// A lone image fill with a blend mode is exported plain and blended in After
// Effects, so it still mixes with what lies beneath it.
function rasterBlend(list) {
  if (list.length !== 1 || list[0].type !== 'raster') return null;
  var b = list[0].blend;
  return b && b !== 'NORMAL' && b !== 'PASS_THROUGH' ? b : null;
}
function needsRaster(list) {
  for (var i = 0; i < list.length; i++) if (list[i].type === 'raster') return true;
  return false;
}

function onlyTranslation(node) {
  return [[1, 0, node.absoluteTransform[0][2]], [0, 1, node.absoluteTransform[1][2]]];
}

// fills only, cropped to the layer's own box
async function exportFills(node) {
  var copy = node.clone();
  try {
    scratch().appendChild(copy);
    if ('children' in copy) { while (copy.children.length) copy.children[0].remove(); }
    if ('strokes' in copy) copy.strokes = [];
    if ('effects' in copy) copy.effects = [];
    if ('clipsContent' in copy) copy.clipsContent = true;
    // a lone fill's blend mode is applied in After Effects instead
    if (copy.fills !== figma.mixed && copy.fills.length === 1 && copy.fills[0].blendMode && copy.fills[0].blendMode !== 'NORMAL') {
      var f0 = JSON.parse(JSON.stringify(copy.fills[0])); f0.blendMode = 'NORMAL'; copy.fills = [f0];
    }
    copy.relativeTransform = onlyTranslation(node);
    var bytes = await copy.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 }, useAbsoluteBounds: true });
    return { png: figma.base64Encode(bytes), scale: 2, dx: 0, dy: 0 };
  } finally {
    copy.remove();
  }
}

// the whole layer with its children and effects, at its full painted size
async function exportWhole(node) {
  var copy = node.clone();
  try {
    scratch().appendChild(copy);
    copy.opacity = 1;
    if ('blendMode' in copy) copy.blendMode = 'PASS_THROUGH';
    copy.relativeTransform = onlyTranslation(node);
    var rb = copy.absoluteRenderBounds;
    var bytes = await copy.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 }, useAbsoluteBounds: false });
    var ox = copy.absoluteTransform[0][2], oy = copy.absoluteTransform[1][2];
    return { png: figma.base64Encode(bytes), scale: 2, dx: rb ? r(rb.x - ox) : 0, dy: rb ? r(rb.y - oy) : 0 };
  } finally {
    copy.remove();
  }
}

// stroke only, at its full painted size
async function exportStroke(node) {
  var copy = node.clone();
  try {
    scratch().appendChild(copy);
    if ('children' in copy) { while (copy.children.length) copy.children[0].remove(); }
    if ('fills' in copy) copy.fills = [];
    if ('effects' in copy) copy.effects = [];
    copy.relativeTransform = onlyTranslation(node);
    var rb = copy.absoluteRenderBounds;
    var bytes = await copy.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 }, useAbsoluteBounds: false });
    var ox = copy.absoluteTransform[0][2], oy = copy.absoluteTransform[1][2];
    return { png: figma.base64Encode(bytes), scale: 2, dx: rb ? r(rb.x - ox) : 0, dy: rb ? r(rb.y - oy) : 0 };
  } finally {
    copy.remove();
  }
}

// Exact rounded-rect outline, including iOS-style corner smoothing and
// different radii per corner, by flattening a temporary rectangle.
function roundedRectGeometry(node) {
  var rr = figma.createRectangle();
  try {
    scratch().appendChild(rr);
    rr.resize(Math.max(0.01, node.width), Math.max(0.01, node.height));
    if (node.cornerRadius !== figma.mixed) rr.cornerRadius = node.cornerRadius || 0;
    else {
      rr.topLeftRadius = node.topLeftRadius || 0; rr.topRightRadius = node.topRightRadius || 0;
      rr.bottomLeftRadius = node.bottomLeftRadius || 0; rr.bottomRightRadius = node.bottomRightRadius || 0;
    }
    rr.cornerSmoothing = node.cornerSmoothing || 0;
    rr.x = 0; rr.y = 0;
    var flat = figma.flatten([rr]);
    rr = flat;
    var geo = vectorGeometry(flat);
    var ox = flat.x, oy = flat.y;
    for (var p = 0; p < geo.paths.length; p++) {
      var P = geo.paths[p];
      for (var q = 0; q < P.v.length; q++) P.v[q] = [r(P.v[q][0] + ox), r(P.v[q][1] + oy)];
    }
    return geo;
  } finally {
    try { rr.remove(); } catch (e) {}
  }
}

function boxShape(o, node) {
  var smooth = node.cornerSmoothing || 0;
  if (node.cornerRadius !== figma.mixed && !(smooth > 0 && node.cornerRadius > 0)) {
    o.kind = 'rect'; o.radius = r(node.cornerRadius || 0);
  } else {
    var g = roundedRectGeometry(node); o.kind = 'path'; o.paths = g.paths; o.rule = 'NONZERO';
  }
}

function strokeInfo(node) {
  if (!('strokes' in node)) return null;
  var list = paints(node.strokes, node.width || 0, node.height || 0);
  if (!list.length) return null;
  var weight = node.strokeWeight;
  var sides = null;
  if (weight === figma.mixed || ('strokeTopWeight' in node && (node.strokeTopWeight !== node.strokeBottomWeight || node.strokeLeftWeight !== node.strokeRightWeight || node.strokeTopWeight !== node.strokeLeftWeight))) {
    sides = { top: r(node.strokeTopWeight || 0), right: r(node.strokeRightWeight || 0), bottom: r(node.strokeBottomWeight || 0), left: r(node.strokeLeftWeight || 0) };
    weight = Math.max(sides.top, sides.right, sides.bottom, sides.left);
  }
  if (!weight) return null;
  var cap = node.strokeCap === figma.mixed ? 'NONE' : (node.strokeCap || 'NONE');
  var join = node.strokeJoin === figma.mixed ? 'MITER' : (node.strokeJoin || 'MITER');
  var rasterPaint = false;
  for (var i = 0; i < list.length; i++) if (list[i].type === 'raster') rasterPaint = true;
  var dashed = !!(node.dashPattern && node.dashPattern.length);
  return {
    paints: list,
    weight: r(weight),
    sides: sides,
    align: node.strokeAlign || 'CENTER',
    cap: cap,
    join: join,
    miter: node.strokeMiterLimit || 4,
    dash: node.dashPattern && node.dashPattern.length ? node.dashPattern.slice(0) : null,
    // Arrow ends, dashed strokes and image or angular strokes are drawn by
    // Figma and imported as a PNG. Figma stretches the dash spacing to fit
    // each outline, which After Effects cannot reproduce.
    raster: rasterPaint || (dashed && DASH_RASTER),
    // arrow ends come across as the exact outline Figma draws, as a native shape
    outline: !rasterPaint && list.length === 1 && list[0].type === 'solid' && (cap.indexOf('ARROW') === 0 || cap === 'TRIANGLE_FILLED' || cap === 'CIRCLE_FILLED' || cap === 'DIAMOND_FILLED')
  };
}

function effectsInfo(node) {
  var out = [];
  if (!('effects' in node) || !node.effects) return out;
  for (var i = 0; i < node.effects.length; i++) {
    var e = node.effects[i];
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      out.push({ type: 'dropShadow', color: col(e.color), offset: [r(e.offset.x), r(e.offset.y)], radius: r(e.radius), spread: r(e.spread || 0) });
    } else if (e.type === 'INNER_SHADOW') {
      out.push({ type: 'innerShadow', color: col(e.color), offset: [r(e.offset.x), r(e.offset.y)], radius: r(e.radius), spread: r(e.spread || 0) });
    } else if (e.blurType === 'PROGRESSIVE') {
      out.push({ type: 'unsupported' });
    } else if (e.type === 'LAYER_BLUR') {
      out.push({ type: 'blur', radius: r(e.radius) });
    } else if (e.type === 'BACKGROUND_BLUR') {
      out.push({ type: 'bgBlur', radius: r(e.radius) });
    } else {
      // noise, texture, glass and any newer effect After Effects cannot draw
      out.push({ type: 'unsupported' });
    }
  }
  return out;
}

// ---------- SVG path data -> AE path ----------
function parsePathData(d) {
  var tokens = d.match(/[MLCQZmlcqzHVhv]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  var paths = [];
  var cur = null;
  var i = 0;
  var cx = 0, cy = 0;
  function num() { return parseFloat(tokens[i++]); }
  function start(x, y) {
    finish(false);
    cur = { v: [[x, y]], i: [[0, 0]], o: [[0, 0]], closed: false };
  }
  function finish(closed) {
    if (!cur) return;
    if (closed) {
      cur.closed = true;
      var n = cur.v.length;
      if (n > 1) {
        var f = cur.v[0], l = cur.v[n - 1];
        if (Math.abs(f[0] - l[0]) < 0.001 && Math.abs(f[1] - l[1]) < 0.001) {
          cur.i[0] = cur.i[n - 1];
          cur.v.pop(); cur.i.pop(); cur.o.pop();
        }
      }
    }
    if (cur.v.length) paths.push(cur);
    cur = null;
  }
  while (i < tokens.length) {
    var cmd = tokens[i++];
    if (cmd === 'M') { cx = num(); cy = num(); start(cx, cy); }
    else if (cmd === 'L') {
      cx = num(); cy = num();
      if (!cur) start(cx, cy); else { cur.v.push([cx, cy]); cur.i.push([0, 0]); cur.o.push([0, 0]); }
    }
    else if (cmd === 'H') { cx = num(); cur.v.push([cx, cy]); cur.i.push([0, 0]); cur.o.push([0, 0]); }
    else if (cmd === 'V') { cy = num(); cur.v.push([cx, cy]); cur.i.push([0, 0]); cur.o.push([0, 0]); }
    else if (cmd === 'C') {
      var x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      var last = cur.v.length - 1;
      cur.o[last] = [x1 - cur.v[last][0], y1 - cur.v[last][1]];
      cur.v.push([x, y]); cur.i.push([x2 - x, y2 - y]); cur.o.push([0, 0]);
      cx = x; cy = y;
    }
    else if (cmd === 'Q') {
      var qx = num(), qy = num(), ex = num(), ey = num();
      var lq = cur.v.length - 1;
      var p0 = cur.v[lq];
      var c1 = [p0[0] + 2 / 3 * (qx - p0[0]), p0[1] + 2 / 3 * (qy - p0[1])];
      var c2 = [ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey)];
      cur.o[lq] = [c1[0] - p0[0], c1[1] - p0[1]];
      cur.v.push([ex, ey]); cur.i.push([c2[0] - ex, c2[1] - ey]); cur.o.push([0, 0]);
      cx = ex; cy = ey;
    }
    else if (cmd === 'Z' || cmd === 'z') { finish(true); }
  }
  finish(false);
  for (var p = 0; p < paths.length; p++) {
    var P = paths[p];
    for (var q = 0; q < P.v.length; q++) {
      P.v[q] = [r(P.v[q][0]), r(P.v[q][1])];
      P.i[q] = [r(P.i[q][0]), r(P.i[q][1])];
      P.o[q] = [r(P.o[q][0]), r(P.o[q][1])];
    }
  }
  return paths;
}

function vectorGeometry(node) {
  var out = [];
  var rule = 'NONZERO';
  var vp = node.vectorPaths || [];
  for (var i = 0; i < vp.length; i++) {
    if (vp[i].windingRule === 'EVENODD') rule = 'EVENODD';
    var parsed = parsePathData(vp[i].data);
    for (var k = 0; k < parsed.length; k++) out.push(parsed[k]);
  }
  return { paths: out, rule: rule };
}

// The stroke as Figma draws it, arrowheads included, as filled paths in the
// node's own space.
function outlinedStroke(node) {
  var out = null;
  try {
    out = node.outlineStroke();
    if (!out) return null;
    var geo = vectorGeometry(out);
    // the outline can land outside the node's parent, keeping the node's own relative transform
    var shift = out.parent === node.parent ? mul(invert(node.absoluteTransform), out.absoluteTransform) : mul(invert(node.relativeTransform), out.relativeTransform);
    var linear = [[shift[0][0], shift[0][1], 0], [shift[1][0], shift[1][1], 0]];
    for (var p = 0; p < geo.paths.length; p++) {
      var P = geo.paths[p];
      for (var q = 0; q < P.v.length; q++) {
        var pt = apply(shift, P.v[q][0], P.v[q][1]), ti = apply(linear, P.i[q][0], P.i[q][1]), to = apply(linear, P.o[q][0], P.o[q][1]);
        P.v[q] = [r(pt[0]), r(pt[1])]; P.i[q] = [r(ti[0]), r(ti[1])]; P.o[q] = [r(to[0]), r(to[1])];
      }
    }
    return geo.paths.length ? geo : null;
  } catch (e) {
    return null;
  } finally {
    try { if (out && !out.removed) out.remove(); } catch (e2) {}
  }
}

// Turn any odd shape (star, polygon, boolean, line, mixed-radius rect) into paths
// by flattening a temporary copy. The original is never touched.
function flattenedGeometry(node) {
  var copy = null;
  try {
    copy = node.clone();
    scratch().appendChild(copy);
    copy.relativeTransform = node.absoluteTransform;
    // flattening alone keeps a vector's corner rounding as a setting; a union
    // first bakes it into the outline
    if (node.type === 'VECTOR' && roundedVector(node)) copy = figma.union([copy], scratch());
    var flat = figma.flatten([copy]);
    copy = flat;
    // flatten may shift the origin; express geometry in the original node's space
    var geo = vectorGeometry(flat);
    var shift = mul(invert(node.absoluteTransform), flat.absoluteTransform);
    for (var p = 0; p < geo.paths.length; p++) {
      var P = geo.paths[p];
      for (var q = 0; q < P.v.length; q++) {
        var pt = apply(shift, P.v[q][0], P.v[q][1]);
        var linear = [[shift[0][0], shift[0][1], 0], [shift[1][0], shift[1][1], 0]];
        var ti = apply(linear, P.i[q][0], P.i[q][1]);
        var to = apply(linear, P.o[q][0], P.o[q][1]);
        P.v[q] = [r(pt[0]), r(pt[1])];
        P.i[q] = [r(ti[0]), r(ti[1])];
        P.o[q] = [r(to[0]), r(to[1])];
      }
    }
    flat.remove();
    return geo;
  } catch (err) {
    try { if (copy && !copy.removed) copy.remove(); } catch (e2) {}
    warn('One shape could not be converted (' + node.name + ').');
    return { paths: [], rule: 'NONZERO' };
  }
}

// ---------- node conversion ----------
var nodeOf = new Map();

// ---------- components ----------
// Every copy of a Figma component that differs only in its text is sent as a
// reference to one shared description of the component, drawn in its own space.
// After Effects builds that once as a precomp, and each copy's text goes in as
// an Essential Graphics override.
var mainOf = new Map(), components = {};
async function findMains(nodes) {
  async function walk(n) {
    if (n.visible === false) return;
    if (n.type === 'INSTANCE') { try { var m = await n.getMainComponentAsync(); if (m) mainOf.set(n.id, m); } catch (e) {} }
    if ('children' in n) for (var c = 0; c < n.children.length; c++) await walk(n.children[c]);
  }
  for (var k = 0; k < nodes.length; k++) await walk(nodes[k]);
}
// the part of a layer id inside an instance that is the same in every copy
function idInComponent(id) { var at = String(id).indexOf(';'); return at < 0 ? String(id) : String(id).substring(at + 1); }
var TEXT_ONLY = { characters: true, name: true, width: true, height: true, textAutoResize: true };
// how a text layer looks, leaving out the words themselves
function textLook(t) {
  try {
    var segs = t.getStyledTextSegments(['fontName', 'fontSize', 'fills', 'letterSpacing', 'lineHeight', 'textCase', 'textDecoration']), seen = {}, out = [];
    for (var i = 0; i < segs.length; i++) {
      var k = JSON.stringify([segs[i].fontName, segs[i].fontSize, segs[i].fills, segs[i].letterSpacing, segs[i].lineHeight, segs[i].textCase, segs[i].textDecoration]);
      if (!seen[k]) { seen[k] = true; out.push(k); }
    }
    return out.sort().join('|');
  } catch (e) { return null; }
}
function findById(root, id) { return root.id === id ? root : root.findOne(function (n) { return n.id === id; }); }
function componentRef(node) {
  var main = mainOf.get(node.id);
  if (!main) return null;
  if (Math.abs(node.width - main.width) > 0.5 || Math.abs(node.height - main.height) > 0.5) return null;
  var ov = [];
  try { ov = node.overrides || []; } catch (e) { return null; }
  for (var i = 0; i < ov.length; i++) {
    var target = null;
    try { target = findById(node, ov[i].id); } catch (eN) {}
    var isText = target && target.type === 'TEXT';
    var inner = idInComponent(ov[i].id);
    for (var f = 0; f < ov[i].overriddenFields.length; f++) {
      var fld = ov[i].overriddenFields[f];
      if (fld === 'name') continue;
      if (!isText) return null;
      // text inside a nested component cannot be set from this copy
      if (inner.indexOf(';') >= 0) return null;
      if (TEXT_ONLY[fld]) continue;
      // Figma marks the styling as changed whenever the words change, so it is compared
      if (fld === 'styledTextSegments') {
        var twin = null;
        try { twin = findById(main, inner); } catch (eT) {}
        if (twin && twin.type === 'TEXT' && textLook(twin) !== null && textLook(twin) === textLook(target)) continue;
      }
      return null;
    }
  }
  var name = main.name;
  try { if (main.parent && main.parent.type === 'COMPONENT_SET') name = main.parent.name + ' / ' + main.name; } catch (eP) {}
  return { key: main.id, name: name };
}
function base(node, rootInv) {
  var rel = mul(rootInv, node.absoluteTransform);
  var t = decompose(rel);
  var o = {
    name: node.name,
    id: node.id,
    opacity: 'opacity' in node ? r(node.opacity) : 1,
    blend: 'blendMode' in node ? node.blendMode : 'NORMAL',
    x: r(t.x), y: r(t.y), rotation: r(t.rotation), scaleX: r(t.scaleX), scaleY: r(t.scaleY),
    skew: Math.abs(t.skew) > 0.01 ? r(t.skew) : 0,
    width: r(node.width || 0), height: r(node.height || 0),
    effects: effectsInfo(node)
  };
  nodeOf.set(o, node);
  return o;
}

// Corner rounding on a vector is not part of its paths, so rounded vectors
// use the flattened outline, which has the rounding baked in.
function roundedVector(node) {
  try {
    if (node.cornerRadius === figma.mixed || node.cornerRadius > 0) return true;
    var vs = node.vectorNetwork && node.vectorNetwork.vertices;
    if (vs) for (var i = 0; i < vs.length; i++) if (vs[i].cornerRadius > 0) return true;
  } catch (e) {}
  return false;
}

function shapeData(node, rootInv) {
  var o = base(node, rootInv);
  o.type = 'shape';
  o.fills = paints(node.fills, node.width, node.height, true);
  o.stroke = strokeInfo(node);
  if (needsRaster(o.fills)) { o.imageBlend = rasterBlend(o.fills); o.fills = []; imageJobs.push({ o: o, node: node, kind: 'fills' }); }
  if (o.stroke && o.stroke.raster) { o.stroke = null; imageJobs.push({ o: o, node: node, kind: 'stroke' }); }
  if (o.stroke && o.stroke.outline) {
    var og = outlinedStroke(node);
    if (og) o.strokeOutline = { paths: og.paths, rule: og.rule, color: o.stroke.paints[0].color, opacity: o.stroke.paints[0].opacity };
    else imageJobs.push({ o: o, node: node, kind: 'stroke' });
    o.stroke = null;
  }

  if (node.type === 'RECTANGLE') {
    boxShape(o, node);
  } else if (node.type === 'ELLIPSE' && node.arcData &&
             node.arcData.innerRadius === 0 &&
             Math.abs(node.arcData.endingAngle - node.arcData.startingAngle - 2 * Math.PI) < 0.0001) {
    o.kind = 'ellipse';
  } else if (node.type === 'VECTOR' && !roundedVector(node)) {
    var g = vectorGeometry(node);
    o.kind = 'path'; o.paths = g.paths; o.rule = g.rule;
  } else {
    var fg = flattenedGeometry(node);
    o.kind = 'path'; o.paths = fg.paths; o.rule = fg.rule;
  }
  return o;
}

function textData(node, rootInv) {
  var o = base(node, rootInv);
  o.type = 'text';
  o.characters = node.characters;
  var segs = node.getStyledTextSegments(['fontName', 'fontSize', 'fills', 'letterSpacing', 'lineHeight', 'textCase', 'textDecoration']);
  o.segments = [];
  for (var i = 0; i < segs.length; i++) o.segments.push(textStyle(segs[i], node));
  var first = o.segments[0] || textStyle({}, node);
  for (var k in first) if (first.hasOwnProperty(k)) o[k] = first[k];
  o.align = node.textAlignHorizontal || 'LEFT';
  o.vAlign = node.textAlignVertical || 'TOP';
  o.autoResize = node.textAutoResize || 'NONE';
  o.stroke = strokeInfo(node);
  // text driven by a component property becomes an editable control in After Effects
  try {
    var ref = node.componentPropertyReferences && node.componentPropertyReferences.characters;
    if (ref) o.propName = ref.replace(/#[^#]*$/, '');
  } catch (eP) {}
  textJobs.push({ o: o, node: node });
  return o;
}

function textStyle(s, node) {
  var t = {};
  t.start = s.start || 0;
  t.end = s.end === undefined ? node.characters.length : s.end;
  var fnt = s.fontName || { family: 'Inter', style: 'Regular' };
  t.fontFamily = fnt.family;
  t.fontStyle = fnt.style;
  t.fontSize = r(s.fontSize || 12);
  var fills = paints(s.fills, node.width, node.height);
  t.color = [0, 0, 0, 1];
  if (fills.length && fills[0].type === 'solid') { t.color = fills[0].color.slice(0); t.color[3] = r(t.color[3] * fills[0].opacity); }
  else if (fills.length && (fills[0].type === 'linear' || fills[0].type === 'radial')) { t.gradient = fills[0]; t.color = fills[0].stops[0].color.slice(0); }
  var ls = s.letterSpacing || { unit: 'PIXELS', value: 0 };
  t.tracking = r(ls.unit === 'PERCENT' ? ls.value * 10 : (ls.value / t.fontSize) * 1000);
  var lh = s.lineHeight || { unit: 'AUTO' };
  t.leading = lh.unit === 'PIXELS' ? r(lh.value) : (lh.unit === 'PERCENT' ? r(lh.value / 100 * t.fontSize) : null);
  t.textCase = s.textCase || 'ORIGINAL';
  t.underline = s.textDecoration === 'UNDERLINE';
  t.strike = s.textDecoration === 'STRIKETHROUGH';
  return t;
}

function decodeXml(t) {
  return t.replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
          .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Figma's own line breaks and baselines, read from an SVG export with live
// text. After Effects then rebuilds the text with exactly the same lines.
async function textLayout(node, o) {
  var copy = node.clone();
  var svg;
  try {
    scratch().appendChild(copy);
    if ('effects' in copy) copy.effects = [];
    copy.relativeTransform = onlyTranslation(node);
    svg = await copy.exportAsync({ format: 'SVG_STRING', svgOutlineText: false, useAbsoluteBounds: true });
  } finally { copy.remove(); }
  var re = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g, m, spans = [];
  while ((m = re.exec(svg))) {
    var ym = /\by="([-\d.e]+)"/.exec(m[1]), xm = /\bx="([-\d.e]+)"/.exec(m[1]);
    if (!ym) continue;
    spans.push({ x: xm ? parseFloat(xm[1]) : 0, y: parseFloat(ym[1]), text: decodeXml(m[2].replace(/<[^>]+>/g, '')).replace(/[\r\n\u2028\u2029]/g, '') });
  }
  if (!spans.length) return;
  var lines = [];
  for (var i = 0; i < spans.length; i++) {
    var last = lines[lines.length - 1];
    if (last && Math.abs(last.y - spans[i].y) < 0.5) { last.text += spans[i].text; last.x = Math.min(last.x, spans[i].x); }
    else lines.push({ y: spans[i].y, x: spans[i].x, text: spans[i].text });
  }
  // line step, and blank lines Figma leaves out of the SVG
  var step = 0;
  for (var j = 1; j < lines.length; j++) { var d = lines[j].y - lines[j - 1].y; if (d > 0 && (!step || d < step)) step = d; }
  // rebuild the text with Figma's breaks, tracking where each character went
  var orig = node.characters, p = 0, out = '', map = [];
  for (var L = 0; L < lines.length; L++) {
    if (L > 0) {
      var gaps = step ? Math.max(1, Math.round((lines[L].y - lines[L - 1].y) / step)) : 1;
      for (var g = 0; g < gaps; g++) out += '\r';
    }
    var t = lines[L].text;
    var want = t.toUpperCase();
    while (p < orig.length && orig.substr(p, t.length).toUpperCase() !== want && /\s/.test(orig.charAt(p))) p++;
    if (orig.substr(p, t.length).toUpperCase() !== want) return; // could not line up, keep the plain layout
    for (var c = 0; c < t.length; c++) map[p + c] = out.length + c;
    lines[L].start = p; lines[L].end = p + t.length;
    lines[L].os = out.length; lines[L].oe = out.length + t.length;
    out += t; // Figma's rendered text, so text case is already applied
    p += t.length;
  }
  var segs = [];
  for (var s2 = 0; s2 < o.segments.length; s2++) {
    var sg = o.segments[s2], lo = Infinity, hi = -1;
    for (var q = sg.start; q < sg.end; q++) if (map[q] !== undefined) { lo = Math.min(lo, map[q]); hi = Math.max(hi, map[q]); }
    if (hi < 0) continue;
    var copySeg = {}; for (var kk in sg) if (sg.hasOwnProperty(kk)) copySeg[kk] = sg[kk];
    copySeg.start = lo; copySeg.end = hi + 1;
    segs.push(copySeg);
  }
  o.layout = { text: out, baseline: r(lines[0].y), firstX: r(lines[0].x), step: r(step), lines: lines.length, segments: segs };
  // Ink bounds of a single line as Figma draws it. After Effects fits its own
  // line to them, which absorbs small differences in font versions.
  {
    var copy2 = node.clone(), outl;
    try {
      scratch().appendChild(copy2);
      if ('effects' in copy2) copy2.effects = [];
      copy2.strokes = [];
      try { copy2.textDecoration = 'NONE'; } catch (eD) {}
      copy2.relativeTransform = onlyTranslation(node);
      outl = await copy2.exportAsync({ format: 'SVG_STRING', svgOutlineText: true, useAbsoluteBounds: true });
    } finally { copy2.remove(); }
    var pp = pathPoints(outl);
    if (lines.length === 1) {
      var xLo = Infinity, xHi = -Infinity;
      for (var pi = 0; pi < pp.length; pi++) { if (pp[pi][0] < xLo) xLo = pp[pi][0]; if (pp[pi][0] > xHi) xHi = pp[pi][0]; }
      if (xHi > xLo) o.layout.inkX = [r(xLo), r(xHi)];
    } else {
      // each outline point belongs to the first line whose baseline it sits
      // above, allowing for descenders
      var size = o.fontSize || 12, ink = [];
      for (var li = 0; li < lines.length; li++) ink.push([Infinity, -Infinity]);
      for (var pj = 0; pj < pp.length; pj++) {
        for (var lk = 0; lk < lines.length; lk++) {
          if (pp[pj][1] <= lines[lk].y + 0.3 * size || lk === lines.length - 1) {
            if (pp[pj][0] < ink[lk][0]) ink[lk][0] = pp[pj][0];
            if (pp[pj][0] > ink[lk][1]) ink[lk][1] = pp[pj][0];
            break;
          }
        }
      }
      var perLine = [];
      for (var lm = 0; lm < lines.length; lm++) {
        if (ink[lm][1] > ink[lm][0]) perLine.push({ start: lines[lm].os, end: lines[lm].oe, ink: [r(ink[lm][0]), r(ink[lm][1])] });
      }
      o.layout.lineInk = perLine;
    }
  }
  o.decorations = await decorations(node, o, lines);
}

// After Effects text has no underline or strikethrough, so they are drawn as
// thin bars. Each bar is measured from Figma's own layout of that line.
async function decorations(node, o, lines) {
  var out = [];
  var any = false;
  for (var i = 0; i < o.segments.length; i++) if (o.segments[i].underline || o.segments[i].strike) any = true;
  if (!any) return out;
  for (var L = 0; L < lines.length; L++) {
    var ln = lines[L];
    for (var s = 0; s < o.segments.length; s++) {
      var sg = o.segments[s];
      if (!sg.underline && !sg.strike) continue;
      var a = Math.max(sg.start, ln.start), b = Math.min(sg.end, ln.end);
      if (b <= a) continue;
      var x0 = ln.x + (await measure(node, ln.start, a));
      var x1 = ln.x + (await measure(node, ln.start, b));
      // trailing spaces are not underlined
      var trimmed = node.characters.substring(a, b).replace(/\s+$/, '');
      if (!trimmed.length) continue;
      if (trimmed.length < b - a) x1 = ln.x + (await measure(node, ln.start, a + trimmed.length));
      var size = sg.fontSize;
      var m = await decoMetrics(node, a, sg.underline ? 'UNDERLINE' : 'STRIKETHROUGH');
      var y = m ? ln.y + m.top : (sg.underline ? ln.y + size * 0.11 : ln.y - size * 0.28);
      var thick = m ? m.h : Math.max(1, size / 14);
      out.push({ x: r(x0), y: r(y), w: r(x1 - x0), h: r(thick), color: sg.color });
    }
  }
  return out;
}

// Where Figma draws the underline or strikethrough for the font at index i,
// relative to the baseline. A run of no-break spaces has no glyphs, so its
// outlined SVG holds nothing but the decoration bar.
var decoCache = {};
async function decoMetrics(node, i, kind) {
  var font = node.getRangeFontName(i, i + 1), size = node.getRangeFontSize(i, i + 1);
  if (font === figma.mixed || size === figma.mixed) return null;
  var key = font.family + '|' + font.style + '|' + size + '|' + kind;
  if (decoCache.hasOwnProperty(key)) return decoCache[key];
  var t = figma.createText(), res = null;
  try {
    scratch().appendChild(t);
    t.fontName = font; t.fontSize = size;
    t.characters = '\u00a0\u00a0\u00a0\u00a0\u00a0';
    t.setRangeTextDecoration(0, 5, kind);
    var live = await t.exportAsync({ format: 'SVG_STRING', svgOutlineText: false });
    var bm = /<tspan\b[^>]*\by="([-\d.e]+)"/.exec(live);
    var outl = await t.exportAsync({ format: 'SVG_STRING', svgOutlineText: true });
    var ys = pathYs(outl);
    if (bm && ys.length) {
      var top = Math.min.apply(null, ys), bot = Math.max.apply(null, ys);
      if (bot > top) res = { top: top - parseFloat(bm[1]), h: bot - top };
    }
  } catch (e) { res = null; } finally { t.remove(); }
  decoCache[key] = res;
  return res;
}

// Advance widths of spaces and non-ASCII characters as Figma lays them out.
// After Effects uses them where its own widths differ (fallback fonts, and
// fonts whose space After Effects sizes differently) so the characters after
// them stay where Figma has them.
var widthCache = {};
async function glyphWidths(node, o) {
  var text = node.characters, out = {};
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (ch !== ' ' && (ch.charCodeAt(0) < 128 || /\s/.test(ch))) continue;
    var font = node.getRangeFontName(i, i + 1), size = node.getRangeFontSize(i, i + 1);
    if (font === figma.mixed || size === figma.mixed) continue;
    var key = font.family + '|' + font.style + '|' + size + '|' + ch;
    if (!widthCache.hasOwnProperty(key)) widthCache[key] = await advanceOf(font, size, ch);
    out[key] = widthCache[key];
  }
  for (var k in out) if (out.hasOwnProperty(k)) { o.glyphWidths = out; break; }
}

// advance of one character, with no letter spacing
async function advanceOf(font, size, ch) {
  var t = figma.createText();
  try {
    scratch().appendChild(t);
    t.fontName = font; t.fontSize = size; t.letterSpacing = { unit: 'PIXELS', value: 0 };
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    // Figma rounds text box widths, so twenty copies give a precise average
    var run = '';
    for (var k = 0; k < 20; k++) run += ch;
    t.characters = 'x' + run + 'x';
    var w1 = t.width;
    t.characters = 'xx';
    return r((w1 - t.width) / 20);
  } finally { t.remove(); }
}

// Points along every path in an SVG string, curves sampled, so their
// extremes give the true ink bounds.
function pathPoints(svg) {
  var pts = [], pm, re = /<path\b[^>]*\bd="([^"]+)"/g;
  while ((pm = re.exec(svg))) {
    var toks = pm[1].match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    var cx = 0, cy = 0, sx = 0, sy = 0, lastCtl = null, cmd = 'M', n = [];
    var curve = function (p) { // p: [x0,y0, x1,y1, ..., xn,yn]
      var deg = p.length / 2 - 1;
      for (var t = 1; t <= 8; t++) {
        var u = t / 8, q = p.slice(0);
        for (var lv = deg; lv > 0; lv--) for (var k = 0; k < lv; k++) {
          q[2 * k] = q[2 * k] + (q[2 * k + 2] - q[2 * k]) * u;
          q[2 * k + 1] = q[2 * k + 1] + (q[2 * k + 3] - q[2 * k + 1]) * u;
        }
        pts.push([q[0], q[1]]);
      }
    };
    var flush = function () {
      var c = cmd.toUpperCase(), rel = cmd !== c, b, x, y;
      if (c === 'Z') { cx = sx; cy = sy; lastCtl = null; }
      else if (c === 'H') { for (b = 0; b < n.length; b++) { cx = rel ? cx + n[b] : n[b]; pts.push([cx, cy]); } lastCtl = null; }
      else if (c === 'V') { for (b = 0; b < n.length; b++) { cy = rel ? cy + n[b] : n[b]; pts.push([cx, cy]); } lastCtl = null; }
      else if (c === 'M' || c === 'L' || c === 'T') {
        for (b = 0; b + 2 <= n.length; b += 2) {
          x = rel ? cx + n[b] : n[b]; y = rel ? cy + n[b + 1] : n[b + 1];
          if (c === 'M' && b === 0) { sx = x; sy = y; }
          pts.push([x, y]); cx = x; cy = y;
        }
        lastCtl = null;
      } else if (c === 'C' || c === 'S' || c === 'Q') {
        var step = c === 'C' ? 6 : 4;
        for (b = 0; b + step <= n.length; b += step) {
          var o = rel ? [cx, cy] : [0, 0], p;
          if (c === 'C') p = [cx, cy, o[0] + n[b], o[1] + n[b + 1], o[0] + n[b + 2], o[1] + n[b + 3], o[0] + n[b + 4], o[1] + n[b + 5]];
          else if (c === 'Q') p = [cx, cy, o[0] + n[b], o[1] + n[b + 1], o[0] + n[b + 2], o[1] + n[b + 3]];
          else {
            var r1 = lastCtl ? [2 * cx - lastCtl[0], 2 * cy - lastCtl[1]] : [cx, cy];
            p = [cx, cy, r1[0], r1[1], o[0] + n[b], o[1] + n[b + 1], o[0] + n[b + 2], o[1] + n[b + 3]];
          }
          curve(p);
          lastCtl = [p[p.length - 4], p[p.length - 3]];
          cx = p[p.length - 2]; cy = p[p.length - 1];
        }
      } else if (c === 'A') {
        for (b = 0; b + 7 <= n.length; b += 7) { cx = rel ? cx + n[b + 5] : n[b + 5]; cy = rel ? cy + n[b + 6] : n[b + 6]; pts.push([cx, cy]); }
        lastCtl = null;
      }
      n = [];
    };
    for (var k2 = 0; k2 < toks.length; k2++) {
      if (/[a-zA-Z]/.test(toks[k2])) { flush(); cmd = toks[k2]; } else n.push(parseFloat(toks[k2]));
    }
    flush();
  }
  return pts;
}
function pathYs(svg) { return pathPoints(svg).map(function (p) { return p[1]; }); }

// width of characters [from, to) laid out on their own line
async function measure(node, from, to) {
  if (to <= from) return 0;
  var c = node.clone();
  try {
    scratch().appendChild(c);
    var len = c.characters.length;
    if (to < len) c.deleteCharacters(to, len);
    if (from > 0) c.deleteCharacters(0, from);
    c.textAutoResize = 'WIDTH_AND_HEIGHT';
    return c.width;
  } finally { c.remove(); }
}

function groupData(node, rootInv, isRootFrame) {
  if (!isRootFrame && node.type === 'INSTANCE') {
    var ref = componentRef(node);
    if (ref) {
      var inst = base(node, rootInv);
      inst.type = 'group';
      inst.component = ref.key;
      if (!components[ref.key]) {
        // drawn once, in the copy's own space
        components[ref.key] = { name: ref.name, width: r(node.width), height: r(node.height), layers: [] };
        components[ref.key].layers = groupData(node, invert(node.absoluteTransform), true).children;
      }
      inst.texts = {};
      var tx = node.findAll(function (n) { return n.type === 'TEXT'; });
      for (var ti = 0; ti < tx.length; ti++) inst.texts[idInComponent(tx[ti].id)] = tx[ti].characters;
      return inst;
    }
  }
  var o = base(node, rootInv);
  o.type = 'group';
  o.isFrame = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'COMPONENT_SET' || node.type === 'SECTION';
  o.clips = !!node.clipsContent;
  o.children = [];
  if (o.isFrame && node.type !== 'SECTION') boxShape(o, node);
  var hasBlur = false;
  for (var ef = 0; ef < o.effects.length; ef++) if (o.effects[ef].type === 'blur') hasBlur = true;
  // Opacity, blur and blend modes act on the whole group in Figma, so the
  // group is built as a precomp and these are applied to it as one layer.
  var blendGroup = o.blend && o.blend !== 'PASS_THROUGH' && o.blend !== 'NORMAL';
  if (o.opacity < 1 || hasBlur || blendGroup || (!o.isFrame && o.effects.length)) o.precomp = true;
  // a frame's own background becomes a rectangle at the bottom of the group
  if (o.isFrame && 'fills' in node) {
    var bgFills = paints(node.fills, node.width, node.height, true);
    var bgStroke = strokeInfo(node);
    var bgImage = needsRaster(bgFills);
    if (bgFills.length || bgStroke || bgImage) {
      var bg = base(node, rootInv);
      bg.name = node.name + ' background';
      bg.id = node.id + ':bg';
      bg.type = 'shape';
      if (!o.precomp) { bg.effects = o.effects; o.effects = []; } else bg.effects = [];
      bg.opacity = 1;
      bg.blend = 'NORMAL';
      bg.fills = bgFills;
      bg.stroke = bgStroke;
      boxShape(bg, node);
      if (needsRaster(bg.fills)) { bg.imageBlend = rasterBlend(bg.fills); bg.fills = []; }
      if (bgImage) imageJobs.push({ o: bg, node: node, kind: 'fills' });
      if (bg.stroke && bg.stroke.raster) { bg.stroke = null; imageJobs.push({ o: bg, node: node, kind: 'stroke' }); }
      o.children.push(bg);
    }
  }
  // Figma masks clip every later sibling in the same parent.
  var maskId = null;
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (child.visible === false) continue;
    if ('isMask' in child && child.isMask) {
      var m = maskData(child, rootInv);
      if (m) { o.children.push(m); maskId = m.id; }
      continue;
    }
    var c = convert(child, rootInv);
    if (!c) continue;
    if (maskId) c.matte = maskId;
    o.children.push(c);
  }
  // a clipping frame becomes a matte for everything inside it, unless
  // nothing inside reaches past its edges
  if (o.isFrame && o.clips && !isRootFrame && !clipIsHarmless(node)) {
    var clip = base(node, rootInv);
    clip.id = node.id + ':clip';
    clip.name = node.name + ' clip';
    clip.type = 'mask';
    clip.effects = [];
    clip.opacity = 1;
    clip.blend = 'NORMAL';
    boxShape(clip, node);
    o.children.unshift(clip);
    o.clipId = clip.id;
  }
  return o;
}

function maskData(node, rootInv) {
  var m = base(node, rootInv);
  m.type = 'mask';
  m.effects = [];
  m.opacity = 1;
  m.blend = 'NORMAL';
  if (node.type === 'RECTANGLE') { boxShape(m, node); }
  else if (node.type === 'ELLIPSE' && node.arcData && node.arcData.innerRadius === 0 &&
           Math.abs(node.arcData.endingAngle - node.arcData.startingAngle - 2 * Math.PI) < 0.0001) { m.kind = 'ellipse'; }
  else if (node.type === 'VECTOR') { var g = vectorGeometry(node); m.kind = 'path'; m.paths = g.paths; m.rule = g.rule; }
  else { var fg = flattenedGeometry(node); m.kind = 'path'; m.paths = fg.paths; m.rule = fg.rule; }
  if (m.kind === 'path' && (!m.paths || !m.paths.length)) return null;
  // a luminance mask is drawn as it looks; its brightness sets what shows
  if (node.maskType === 'LUMINANCE') {
    m.luma = true;
    m.fills = paints(node.fills, node.width, node.height);
    if (needsRaster(m.fills)) { m.fills = []; imageJobs.push({ o: m, node: node, kind: 'fills' }); }
  }
  return m;
}

// A layer with an effect After Effects cannot draw (noise, texture, glass,
// progressive blur) is rendered by Figma as one image, effects and all.
function hasUnsupportedEffect(node) {
  if (!('effects' in node) || !node.effects) return false;
  for (var i = 0; i < node.effects.length; i++) {
    var e = node.effects[i];
    if (e.visible === false) continue;
    if (e.blurType === 'PROGRESSIVE') return true;
    if (['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'].indexOf(e.type) < 0) return true;
  }
  return false;
}
function rasterNode(node, rootInv) {
  var o = base(node, rootInv);
  o.type = 'shape';
  o.effects = [];
  o.fills = [];
  o.stroke = null;
  o.kind = 'rect'; o.radius = 0;
  imageJobs.push({ o: o, node: node, kind: 'whole' });
  warn('Layers with noise, texture, glass or progressive blur come in as images.');
  return o;
}

function convert(node, rootInv) {
  if (node.visible === false) return null;
  if (hasUnsupportedEffect(node)) return rasterNode(node, rootInv);
  switch (node.type) {
    case 'TEXT':
      return textData(node, rootInv);
    case 'GROUP':
    case 'FRAME':
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE':
    case 'SECTION':
      return groupData(node, rootInv, false);
    case 'RECTANGLE':
    case 'ELLIPSE':
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'LINE':
    case 'BOOLEAN_OPERATION':
      return shapeData(node, rootInv);
    default:
      warn(node.type.toLowerCase() + ' layers are skipped.');
      return null;
  }
}

// ---------- combining ----------
// A group made only of plain vector shapes (an icon, a logo, a badge) can be
// built as one shape layer with a shape group per piece, the way a motion
// designer would draw it. Each piece then carries its own position inside the
// layer, in "mx". After Effects decides whether to combine (the default) or
// keep every piece on its own layer.
function plainLeaf(o) {
  if (o.type !== 'shape') return false;
  if (o.image || o.strokeImage || o.strokeOutline || o.imageBlend || o.matte) return false;
  if (rasterJobFor(o)) return false;
  if (o.effects && o.effects.length) return false;
  if (o.blend && o.blend !== 'NORMAL' && o.blend !== 'PASS_THROUGH') return false;
  var f = o.fills || [];
  for (var i = 0; i < f.length; i++) {
    if (f[i].type !== 'solid' && f[i].type !== 'linear' && f[i].type !== 'radial') return false;
    if (f[i].blend && f[i].blend !== 'NORMAL' && f[i].blend !== 'PASS_THROUGH') return false;
  }
  var st = o.stroke;
  if (st && (st.sides || (st.align && st.align !== 'CENTER') || st.raster)) return false;
  return !!o.kind;
}
function rasterJobFor(o) {
  for (var i = 0; i < imageJobs.length; i++) if (imageJobs[i].o === o) return true;
  return false;
}
// true when everything inside the frame already sits within its bounds, so
// its clipping changes nothing
function clipIsHarmless(node) {
  var b = node.absoluteBoundingBox;
  if (!b || node.rotation) return false;
  var rad = 0;
  if ('cornerRadius' in node) {
    if (node.cornerRadius === figma.mixed) rad = Math.max(node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomLeftRadius || 0, node.bottomRightRadius || 0);
    else rad = node.cornerRadius || 0;
  }
  var ok = true;
  (function walk(n) {
    if (!ok || !('children' in n)) return;
    for (var i = 0; i < n.children.length; i++) {
      var c = n.children[i];
      if (c.visible === false) continue;
      var rb = c.absoluteRenderBounds;
      if (rb && (rb.x < b.x - 0.5 || rb.y < b.y - 0.5 || rb.x + rb.width > b.x + b.width + 0.5 || rb.y + rb.height > b.y + b.height + 0.5)) { ok = false; return; }
      // rounded corners clip anything that reaches into a corner square
      if (rb && rad > 0) {
        var inL = rb.x < b.x + rad, inR = rb.x + rb.width > b.x + b.width - rad, inT = rb.y < b.y + rad, inB = rb.y + rb.height > b.y + b.height - rad;
        if ((inL || inR) && (inT || inB)) { ok = false; return; }
      }
      walk(c);
    }
  })(node);
  return ok;
}
function combinable(o, top) {
  if (o.type !== 'group' || !o.children) return false;
  // inner groups must not need a precomp of their own
  if (!top && (o.precomp || (o.effects && o.effects.length))) return false;
  for (var e = 0; o.effects && e < o.effects.length; e++) if (o.effects[e].type === 'bgBlur') return false;
  if (o.clips && o.clipId && !clipIsHarmless(nodeOf.get(o))) return false;
  var leaves = 0;
  for (var i = 0; i < o.children.length; i++) {
    var c = o.children[i];
    if (c.type === 'mask') { if (c.id === o.clipId) continue; return false; }
    if (c.type === 'group') { if (!combinable(c, false)) return false; leaves += 2; continue; }
    if (!plainLeaf(c)) return false;
    leaves++;
  }
  return leaves >= 2;
}
function setLocalTransforms(o, topInv) {
  for (var i = 0; i < o.children.length; i++) {
    var c = o.children[i];
    if (c.type === 'group') { setLocalTransforms(c, topInv); continue; }
    if (c.type === 'mask') continue;
    var n = nodeOf.get(c);
    var t = decompose(mul(topInv, n.absoluteTransform));
    c.mx = { x: r(t.x), y: r(t.y), rotation: r(t.rotation), scaleX: r(t.scaleX), scaleY: r(t.scaleY), skew: Math.abs(t.skew) > 0.01 ? r(t.skew) : 0 };
  }
}
function markMerges(list, isRoot) {
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (o.type !== 'group') continue;
    if (combinable(o, true)) {
      o.combine = true;
      setLocalTransforms(o, invert(nodeOf.get(o).absoluteTransform));
    } else markMerges(o.children, false);
  }
}

function countLayers(list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    n++;
    if (list[i].children) n += countLayers(list[i].children);
  }
  return n;
}

// Escape non-ASCII so the text survives the trip through the macOS clipboard.
function asciiJSON(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, function (ch) {
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

async function loadFonts(nodes) {
  var seen = {};
  async function walk(n) {
    if (n.type === 'TEXT') {
      var segs = n.getStyledTextSegments(['fontName']);
      for (var i = 0; i < segs.length; i++) {
        var key = segs[i].fontName.family + '|' + segs[i].fontName.style;
        if (!seen[key]) { seen[key] = true; try { await figma.loadFontAsync(segs[i].fontName); } catch (e) {} }
      }
    }
    if ('children' in n) for (var c = 0; c < n.children.length; c++) await walk(n.children[c]);
  }
  for (var k = 0; k < nodes.length; k++) await walk(nodes[k]);
}

// ---------- After Effects to Figma ----------
// Layers sent from the After Effects panel are drawn as a new frame next to
// what is on the canvas.
function rotationMatrix(x, y, deg) {
  var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [[c, -s, x], [s, c, y]];
}
async function loadFontSafe(family, style) {
  var f = { family: family || 'Inter', style: style || 'Regular' };
  try { await figma.loadFontAsync(f); return f; } catch (e) {}
  try { f = { family: family, style: 'Regular' }; await figma.loadFontAsync(f); return f; } catch (e2) {}
  f = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(f);
  return f;
}
function solidPaint(c, a) { return { type: 'SOLID', color: { r: c[0], g: c[1], b: c[2] }, opacity: a === undefined ? 1 : a }; }
// After Effects gives the gradient's start and end in the parent's space;
// Figma wants a transform from the layer's unit box into gradient space.
function gradientPaint(g, n, a) {
  var w = Math.max(n.width, 0.01), h = Math.max(n.height, 0.01), x0 = n.x, y0 = n.y;
  var ex = g.end[0] - g.start[0], ey = g.end[1] - g.start[1], qx = -ey, qy = ex;
  var A;
  if (g.type === 'RADIAL') A = [[2 * ex / w, 2 * qx / w, (g.start[0] - ex - qx - x0) / w], [2 * ey / h, 2 * qy / h, (g.start[1] - ey - qy - y0) / h]];
  else A = [[ex / w, qx / w, (g.start[0] - 0.5 * qx - x0) / w], [ey / h, qy / h, (g.start[1] - 0.5 * qy - y0) / h]];
  var det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-9) det = 1e-9;
  var ia = A[1][1] / det, ib = -A[0][1] / det, ic = -A[1][0] / det, id = A[0][0] / det;
  var T = [[ia, ib, -(ia * A[0][2] + ib * A[1][2])], [ic, id, -(ic * A[0][2] + id * A[1][2])]];
  var stops = g.stops.map(function (s) { return { position: Math.max(0, Math.min(1, s.pos)), color: { r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] === undefined ? 1 : s.color[3] } }; });
  return { type: g.type === 'RADIAL' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR', gradientTransform: T, gradientStops: stops, opacity: a === undefined ? 1 : a };
}
async function buildFromAE(list, parent, images, missing) {
  for (var i = 0; i < list.length; i++) {
    var d = list[i], n = null;
    try {
      if (d.kind === 'vector') {
        n = figma.createVector();
        parent.appendChild(n);
        n.vectorPaths = [{ windingRule: d.evenodd ? 'EVENODD' : 'NONZERO', data: d.paths.join(' ') }];
        n.fills = d.fill ? [solidPaint(d.fill, d.fillOpacity)] : (d.fillGradient ? [gradientPaint(d.fillGradient, n, d.fillOpacity)] : []);
        n.strokes = d.stroke ? [solidPaint(d.stroke, d.strokeOpacity)] : (d.strokeGradient ? [gradientPaint(d.strokeGradient, n, d.strokeOpacity)] : []);
        if (n.strokes.length) {
          n.strokeWeight = Math.max(0.01, d.strokeWidth); n.strokeAlign = 'CENTER';
          if (d.cap) n.strokeCap = d.cap;
          if (d.join) n.strokeJoin = d.join;
          if (d.dashes) n.dashPattern = d.dashes;
        }
        n.name = d.name || (d.fill || d.fillGradient ? 'Fill' : 'Stroke');
      } else if (d.kind === 'group') {
        var tmp = [];
        var holder = figma.createFrame();
        holder.fills = []; holder.clipsContent = false;
        parent.appendChild(holder);
        holder.resize(Math.max(1, parent.width || 1), Math.max(1, parent.height || 1));
        await buildFromAE(d.children, holder, images, missing);
        for (var k = 0; k < holder.children.length; k++) tmp.push(holder.children[k]);
        if (tmp.length) {
          n = figma.group(tmp, parent);
          n.name = d.name;
        }
        holder.remove();
      } else if (d.kind === 'text') {
        var font = await loadFontSafe(d.family, d.style);
        if (font.family !== d.family || font.style !== d.style) missing[d.family + ' ' + d.style] = true;
        n = figma.createText();
        parent.appendChild(n);
        n.fontName = font;
        n.characters = d.text.replace(/\r/g, '\n');
        n.fontSize = Math.max(1, d.size);
        n.fills = d.color ? [solidPaint(d.color, 1)] : [];
        if (d.stroke) { n.strokes = [solidPaint(d.stroke, 1)]; n.strokeWeight = Math.max(0.01, d.strokeWidth); n.strokeAlign = 'OUTSIDE'; }
        if (d.tracking) n.letterSpacing = { unit: 'PERCENT', value: d.tracking / 10 };
        if (d.leading) n.lineHeight = { unit: 'PIXELS', value: d.leading };
        if (d.runs) {
          for (var ri = 0; ri < d.runs.length; ri++) {
            var run = d.runs[ri], a = run.start, b = Math.min(run.end, n.characters.length);
            if (b <= a) continue;
            try {
              if (run.family) {
                var rf = await loadFontSafe(run.family, run.style);
                if (rf.family !== run.family || rf.style !== run.style) missing[run.family + ' ' + run.style] = true;
                n.setRangeFontName(a, b, rf);
              }
              n.setRangeFontSize(a, b, Math.max(1, run.size));
              n.setRangeFills(a, b, run.color ? [solidPaint(run.color, 1)] : []);
              if (run.tracking !== undefined) n.setRangeLetterSpacing(a, b, { unit: 'PERCENT', value: run.tracking / 10 });
            } catch (eRun) { missing['Text styling failed: ' + (eRun && eRun.message ? eRun.message : eRun)] = true; }
          }
        }
        n.textAlignHorizontal = d.align;
        if (d.box) { n.textAutoResize = 'HEIGHT'; n.resize(Math.max(1, d.boxWidth || d.width), n.height); }
        n.relativeTransform = rotationMatrix(d.x, d.y, d.rotation);
        // After Effects gives the ink box, so line the rendered ink up with it
        if (!d.rotation) {
          var rb = n.absoluteRenderBounds, at = n.absoluteTransform;
          if (rb && rb.width > 0) { n.x += d.x - (n.x + rb.x - at[0][2]); n.y += d.y - (n.y + rb.y - at[1][2]); }
        }
        if (d.fillGradient && !d.rotation) n.fills = [gradientPaint(d.fillGradient, n, 1)];
        n.name = d.name;
      } else if (d.kind === 'image') {
        n = figma.createRectangle();
        parent.appendChild(n);
        n.resize(Math.max(0.01, d.width), Math.max(0.01, d.height));
        var img = figma.createImage(figma.base64Decode(images[d.image]));
        n.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
        n.relativeTransform = rotationMatrix(d.x, d.y, d.rotation);
        n.name = d.name;
      } else if (d.kind === 'frame') {
        n = figma.createFrame();
        parent.appendChild(n);
        n.fills = []; n.clipsContent = true;
        n.resize(Math.max(1, d.width), Math.max(1, d.height));
        await buildFromAE(d.children, n, images, missing);
        if (d.scale && Math.abs(d.scale - 1) > 0.001) n.rescale(d.scale);
        n.relativeTransform = rotationMatrix(d.x, d.y, d.rotation);
        n.name = d.name;
      }
      if (n && d.opacity !== undefined && d.opacity < 1) n.opacity = Math.max(0, d.opacity);
    } catch (e) { missing['Some layers could not be drawn: ' + (e && e.message ? e.message : e)] = true; }
  }
}
// ---------- Illustrator to Figma ----------
// Illustrator sends LayerBoat's own layer description, the same one the Figma
// side sends to After Effects. Positions are in the artboard's space.
function svgPathData(o) {
  var out = [];
  function n(v) { return Math.round(v * 1000) / 1000; }
  for (var p = 0; p < o.paths.length; p++) {
    var P = o.paths[p], v = P.v, ins = P.i, outs = P.o, len = v.length;
    if (!len) continue;
    out.push('M ' + n(o.x + v[0][0]) + ' ' + n(o.y + v[0][1]));
    var segs = P.closed ? len : len - 1;
    for (var k = 0; k < segs; k++) {
      var a = k, b = (k + 1) % len;
      out.push('C ' + n(o.x + v[a][0] + outs[a][0]) + ' ' + n(o.y + v[a][1] + outs[a][1]) + ' ' +
        n(o.x + v[b][0] + ins[b][0]) + ' ' + n(o.y + v[b][1] + ins[b][1]) + ' ' + n(o.x + v[b][0]) + ' ' + n(o.y + v[b][1]));
    }
    if (P.closed) out.push('Z');
  }
  return out.join(' ');
}
// a LayerBoat paint as a Figma paint; the node must already have its size
function bridgePaint(f, o, node) {
  if (!f) return null;
  var a = f.opacity === undefined ? 1 : f.opacity;
  if (f.type === 'solid') return solidPaint(f.color, (f.color[3] === undefined ? 1 : f.color[3]) * a);
  if (f.type === 'linear' || f.type === 'radial') {
    var g = { type: f.type === 'radial' ? 'RADIAL' : 'LINEAR', start: [o.x + f.start[0], o.y + f.start[1]], end: [o.x + f.end[0], o.y + f.end[1]], stops: f.stops };
    return gradientPaint(g, node, a);
  }
  return null;
}
var FIGMA_BLENDS = { MULTIPLY: 1, SCREEN: 1, OVERLAY: 1, DARKEN: 1, LIGHTEN: 1, COLOR_DODGE: 1, COLOR_BURN: 1, HARD_LIGHT: 1, SOFT_LIGHT: 1, DIFFERENCE: 1, EXCLUSION: 1, HUE: 1, SATURATION: 1, COLOR: 1, LUMINOSITY: 1 };
function applyLook(n, d) {
  if (d.opacity !== undefined && d.opacity < 1) n.opacity = Math.max(0, d.opacity);
  if (d.blend && FIGMA_BLENDS[d.blend]) n.blendMode = d.blend;
}
async function bridgeShape(d, parent, images) {
  var n;
  if (d.image) {
    n = figma.createRectangle();
    parent.appendChild(n);
    n.resize(Math.max(0.01, d.width), Math.max(0.01, d.height));
    n.x = d.x; n.y = d.y;
    var data = images[d.image.key];
    if (data) { var img = figma.createImage(figma.base64Decode(data)); n.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }]; }
    else n.fills = [];
    n.name = d.name;
    return n;
  }
  if (d.kind === 'rect' || !d.paths || !d.paths.length) {
    n = figma.createRectangle();
    parent.appendChild(n);
    n.resize(Math.max(0.01, d.width), Math.max(0.01, d.height));
    n.x = d.x; n.y = d.y;
    if (d.radius) n.cornerRadius = d.radius;
  } else {
    n = figma.createVector();
    parent.appendChild(n);
    n.vectorPaths = [{ windingRule: d.rule === 'EVENODD' ? 'EVENODD' : 'NONZERO', data: svgPathData(d) }];
  }
  var fills = [];
  for (var i = 0; i < (d.fills || []).length; i++) { var p = bridgePaint(d.fills[i], d, n); if (p) fills.push(p); }
  n.fills = fills;
  if (d.stroke && d.stroke.paints && d.stroke.paints.length) {
    var sp = bridgePaint(d.stroke.paints[0], d, n);
    n.strokes = sp ? [sp] : [];
    n.strokeWeight = Math.max(0.01, d.stroke.weight);
    n.strokeAlign = d.stroke.align === 'INSIDE' || d.stroke.align === 'OUTSIDE' ? d.stroke.align : 'CENTER';
    if (d.stroke.cap && n.type === 'VECTOR') n.strokeCap = d.stroke.cap;
    if (d.stroke.join) n.strokeJoin = d.stroke.join;
    if (d.stroke.miter) n.strokeMiterLimit = Math.max(1, d.stroke.miter);
    if (d.stroke.dash && d.stroke.dash.length) n.dashPattern = d.stroke.dash;
  } else n.strokes = [];
  n.name = d.name;
  return n;
}
async function bridgeText(d, parent, missing) {
  var n = figma.createText();
  parent.appendChild(n);
  var font = await loadFontSafe(d.fontFamily, d.fontStyle);
  if (font.family !== d.fontFamily || font.style !== d.fontStyle) missing[d.fontFamily + ' ' + d.fontStyle] = true;
  n.fontName = font;
  var text = String(d.characters || '').replace(/\r/g, '\n');
  n.characters = text;
  var segs = d.segments && d.segments.length ? d.segments : [d];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i], a = s.start || 0, b = Math.min(s.end === undefined ? text.length : s.end, text.length);
    if (b <= a) continue;
    try {
      var f = await loadFontSafe(s.fontFamily, s.fontStyle);
      if (f.family !== s.fontFamily || f.style !== s.fontStyle) missing[s.fontFamily + ' ' + s.fontStyle] = true;
      n.setRangeFontName(a, b, f);
      n.setRangeFontSize(a, b, Math.max(1, s.fontSize || 12));
      n.setRangeFills(a, b, s.color ? [solidPaint(s.color, s.color[3] === undefined ? 1 : s.color[3])] : []);
      if (s.tracking) n.setRangeLetterSpacing(a, b, { unit: 'PERCENT', value: s.tracking / 10 });
      if (s.leading) n.setRangeLineHeight(a, b, { unit: 'PIXELS', value: s.leading });
      if (s.textCase === 'UPPER') n.setRangeTextCase(a, b, 'UPPER');
      if (s.underline) n.setRangeTextDecoration(a, b, 'UNDERLINE');
      else if (s.strike) n.setRangeTextDecoration(a, b, 'STRIKETHROUGH');
    } catch (eRun) { missing['Text styling failed: ' + (eRun && eRun.message ? eRun.message : eRun)] = true; }
  }
  n.textAlignHorizontal = d.align === 'CENTER' || d.align === 'RIGHT' || d.align === 'JUSTIFIED' ? d.align : 'LEFT';
  if (d.autoResize === 'HEIGHT') {
    n.textAutoResize = 'HEIGHT';
    n.resize(Math.max(1, d.width), Math.max(1, n.height));
    n.x = d.x; n.y = d.y;
  } else {
    n.textAutoResize = 'WIDTH_AND_HEIGHT';
    n.x = d.x; n.y = d.y;
    if (d.rotation) n.relativeTransform = rotationMatrix(d.x, d.y, d.rotation);
  }
  // Illustrator measured the ink of the letters, so the drawn letters are lined up with it
  if (d.ink && !d.rotation) {
    var rb = n.absoluteRenderBounds, at = n.absoluteTransform;
    if (rb && rb.width > 0) {
      if (d.autoResize !== 'HEIGHT') n.x += d.ink[0] - (n.x + rb.x - at[0][2]);
      n.y += d.ink[1] - (n.y + rb.y - at[1][2]);
    }
  }
  n.name = d.name;
  return n;
}
// a shape Illustrator exported as SVG, drawn by Figma's own SVG reader
function nodeFromSvg(d, parent, svg) {
  var f = figma.createNodeFromSvg(svg);
  parent.appendChild(f);
  f.x = 0; f.y = 0;
  var kids = f.children.slice(), n = null;
  // the SVG reader wraps everything in groups named after the keys; one level is unwrapped
  if (kids.length === 1 && kids[0].type === 'GROUP' && /^bridge/.test(kids[0].name) && kids[0].children.length) kids = kids[0].children.slice();
  if (kids.length === 1) { parent.appendChild(kids[0]); n = kids[0]; }
  else if (kids.length) n = figma.group(kids, parent);
  f.remove();
  if (n) n.name = d.name;
  return n;
}
async function buildFromBridge(list, parent, images, missing, svgs) {
  svgs = svgs || {};
  for (var i = 0; i < list.length; i++) {
    var d = list[i], n = null;
    try {
      if (d.native && svgs[d.native] && d.type !== 'text') {
        n = nodeFromSvg(d, parent, svgs[d.native]);
        if (n && d.type === 'mask') {
          if (n.type !== 'VECTOR' && n.type !== 'RECTANGLE' && n.type !== 'ELLIPSE') n = figma.flatten([n], parent);
          n.isMask = true;
          n.name = d.name || 'Clip';
        }
      } else if (d.type === 'shape') n = await bridgeShape(d, parent, images);
      else if (d.type === 'text') n = await bridgeText(d, parent, missing);
      else if (d.type === 'mask') {
        n = figma.createVector();
        parent.appendChild(n);
        n.vectorPaths = [{ windingRule: d.rule === 'EVENODD' ? 'EVENODD' : 'NONZERO', data: svgPathData(d) }];
        n.fills = [solidPaint([0, 0, 0], 1)];
        n.strokes = [];
        n.isMask = true;
        n.name = d.name || 'Clip';
      } else if (d.type === 'group') {
        // built in a holder at the parent's origin, so positions stay in the same space
        var holder = figma.createFrame();
        holder.fills = []; holder.clipsContent = false;
        parent.appendChild(holder);
        holder.x = 0; holder.y = 0;
        holder.resize(Math.max(1, parent.width || 1), Math.max(1, parent.height || 1));
        var kids = d.children || [];
        // a clipping path goes first, so it masks everything above it
        var mask = null, rest = [];
        for (var k = 0; k < kids.length; k++) { if (d.clipId && kids[k].id === d.clipId) mask = kids[k]; else rest.push(kids[k]); }
        await buildFromBridge(mask ? [mask].concat(rest) : rest, holder, images, missing, svgs);
        var made = holder.children.slice();
        if (made.length) { n = figma.group(made, parent); n.name = d.name; }
        holder.remove();
      }
      if (n && d.type !== 'mask') applyLook(n, d);
    } catch (e) { missing['Some layers could not be drawn: ' + (e && e.message ? e.message : e)] = true; }
  }
}
async function receiveFromIllustrator(data) {
  var layers = (data.layers || []).slice(), bg = null;
  // Illustrator's white paper becomes the frame's fill
  if (layers.length && /^ai:artboard:/.test(layers[0].id || '')) { var ab = layers.shift(); if (ab.fills && ab.fills[0] && ab.fills[0].type === 'solid') bg = ab.fills[0].color; }
  var old = null;
  for (var i = 0; i < figma.currentPage.children.length; i++) {
    var c = figma.currentPage.children[i];
    if (c.type === 'FRAME' && c.getPluginData('bridgeRoot') === data.rootId) { old = c; break; }
  }
  var frame = figma.createFrame();
  frame.name = data.name || 'From Illustrator';
  frame.resize(Math.max(1, data.width), Math.max(1, data.height));
  frame.fills = bg ? [solidPaint(bg, 1)] : [];
  frame.clipsContent = true;
  frame.setPluginData('bridgeRoot', data.rootId || '');
  if (old) { frame.x = old.x; frame.y = old.y; }
  else {
    var maxX = 0;
    for (var j = 0; j < figma.currentPage.children.length; j++) { var cc = figma.currentPage.children[j]; if (cc !== frame) maxX = Math.max(maxX, cc.x + cc.width); }
    frame.x = maxX + 200; frame.y = 0;
  }
  var missing = {};
  console.log('LayerBoat: drawing ' + layers.length + ' layers, ' + Object.keys(data.svgs || {}).length + ' shapes');
  await buildFromBridge(layers, frame, data.images || {}, missing, data.svgs || {});
  // sending the same artboard again replaces the frame in place
  if (old) old.remove();
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  var notes = (data.warnings || []).concat(Object.keys(missing).map(function (k) { return k.indexOf('Some layers') === 0 || k.indexOf('Text styling') === 0 ? k : 'Font replaced: ' + k + '.'; }));
  return (old ? 'Updated ' : 'Built ') + frame.name + ' from Illustrator.' + (notes.length ? ' ' + notes.join(' ') : '');
}

async function receiveFromAE(text) {
  var data = JSON.parse(text);
  if (data.source === 'illustrator') return receiveFromIllustrator(data);
  var frame = figma.createFrame();
  frame.name = data.name || 'From After Effects';
  frame.resize(Math.max(1, data.width), Math.max(1, data.height));
  frame.fills = data.background ? [{ type: 'SOLID', color: { r: data.background[0], g: data.background[1], b: data.background[2] } }] : [];
  frame.clipsContent = true;
  // to the right of everything on the page
  var maxX = 0;
  for (var i = 0; i < figma.currentPage.children.length; i++) {
    var c = figma.currentPage.children[i];
    if (c !== frame) maxX = Math.max(maxX, c.x + c.width);
  }
  frame.x = maxX + 200; frame.y = 0;
  var missing = {};
  await buildFromAE(data.layers || [], frame, data.images || {}, missing);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  var notes = (data.warnings || []).concat(Object.keys(missing).map(function (k) { return k.indexOf('Some layers') === 0 ? k : 'Font replaced: ' + k + '.'; }));
  return 'Built ' + frame.name + ' from After Effects.' + (notes.length ? ' ' + notes.join(' ') : '');
}

// ---------- Figma to Illustrator ----------
// Illustrator reads SVG well, so the selection goes as SVG with text kept as text
// and layer names kept as ids. A comment at the top carries the frame's name.
function isFrameLike(n) { return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'SECTION'; }
// several whole frames go separately, so each gets its own artboard or comp
function separateFrames(sel) {
  if (sel.length < 2) return false;
  for (var i = 0; i < sel.length; i++) if (!isFrameLike(sel[i]) || !sel[i].parent || sel[i].parent.type !== 'PAGE') return false;
  return true;
}
// top to bottom, then left to right, the way people read a page of screens
function readingOrder(sel) { return sel.slice().sort(function (a, b) { return (Math.round(a.y) - Math.round(b.y)) || (a.x - b.x); }); }
async function svgForIllustrator() {
  var sel = figma.currentPage.selection;
  if (!sel.length) throw new Error('Select a frame or layers first.');
  if (separateFrames(sel)) {
    var parts = [], ordered = readingOrder(sel);
    try {
      for (var k = 0; k < ordered.length; k++) {
        figma.currentPage.selection = [ordered[k]];
        parts.push(await svgForIllustrator());
      }
    } finally { figma.currentPage.selection = sel; }
    return parts.join(String.fromCharCode(10) + '<!-- bridge-next -->' + String.fromCharCode(10));
  }
  var node = sel[0], name = node.name, made = null;
  if (sel.length > 1) {
    // several layers go together, in a group that is removed again straight away
    made = figma.group(sel.slice(), node.parent);
    node = made; name = 'Figma selection';
  }
  try {
    var bytes = await node.exportAsync({ format: 'SVG', svgOutlineText: false, svgIdAttribute: true, svgSimplifyStroke: true });
    var svg = '';
    var CH = 8192;
    for (var i = 0; i < bytes.length; i += CH) svg += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + CH)));
    svg = decodeURIComponent(escape(svg));
    return '<!-- bridge:' + encodeURIComponent(name) + ':' + encodeURIComponent(node.id) + ' -->' + String.fromCharCode(10) + svg;
  } finally {
    if (made) { try { figma.ungroup(made); } catch (e) {} }
  }
}

async function makePayload(sel) {
  imageJobs = [];
  textJobs = [];
  components = {};
  mainOf = new Map();
  await loadFonts(sel);
  await findMains(sel);
  var root, layers = [], compW, compH, name;
  // identifies this frame or selection, so sending it again updates the same comp
  var ids = [];
  for (var si = 0; si < sel.length; si++) ids.push(sel[si].id);
  var rootId = ids.sort().join(',');
  if (sel.length === 1 && (sel[0].type === 'FRAME' || sel[0].type === 'COMPONENT' || sel[0].type === 'INSTANCE')) {
    // a single frame becomes the comp itself
    var f = sel[0];
    var fInv = invert(f.absoluteTransform);
    var g = groupData(f, fInv, true);
    layers = g.children;
    compW = f.width; compH = f.height; name = f.name;
  } else {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < sel.length; i++) {
      var b = sel[i].absoluteBoundingBox;
      if (!b) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    }
    var inv = [[1, 0, -minX], [0, 1, -minY]];
    for (var j = 0; j < sel.length; j++) {
      var c = convert(sel[j], inv);
      if (c) layers.push(c);
    }
    compW = maxX - minX; compH = maxY - minY;
    name = sel.length === 1 ? sel[0].name : 'Figma selection';
  }
  var total = imageJobs.length + textJobs.length;
  if (total) figma.ui.postMessage({ type: 'progress', text: 'Preparing ' + imageJobs.length + ' images and ' + textJobs.length + ' text layers...' });
  for (var q = 0; q < imageJobs.length; q++) {
    var job = imageJobs[q];
    try {
      if (job.kind === 'stroke') job.o.strokeImage = await exportStroke(job.node);
      else if (job.kind === 'whole') job.o.image = await exportWhole(job.node);
      else job.o.image = await exportFills(job.node);
    } catch (e) { warn('One image could not be exported.'); }
  }
  for (var tq = 0; tq < textJobs.length; tq++) {
    try { await textLayout(textJobs[tq].node, textJobs[tq].o); } catch (e2) {}
    try { await glyphWidths(textJobs[tq].node, textJobs[tq].o); } catch (e3) {}
  }
  markMerges(layers, true);
  var used = 0;
  for (var ck in components) if (components.hasOwnProperty(ck)) { markMerges(components[ck].layers, true); used++; }
  var out = {
    bridge: 'figma-to-ae',
    version: 1,
    name: name,
    rootId: rootId,
    width: Math.max(1, Math.round(compW)),
    height: Math.max(1, Math.round(compH)),
    layers: layers
  };
  if (used) out.components = components;
  return out;
}

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'hello') { postSel(); return; }
  var keepSel = figma.currentPage.selection.slice();
  busy = true;
  try { await handle(msg); }
  finally {
    dropScratch();
    try { var alive = keepSel.filter(function (n) { return !n.removed; }); var now = figma.currentPage.selection.map(function (n) { return n.id; }).join(','); if (alive.length === keepSel.length && msg.type !== 'build' && now !== alive.map(function (n) { return n.id; }).join(',')) { quietUntil = Date.now() + 1500; figma.currentPage.selection = alive; } } catch (eS) {}
    busy = false;
  }
};
async function handle(msg) {
  if (msg.type === 'build') {
    console.log('LayerBoat: building ' + (msg.text ? msg.text.length : 0) + ' characters');
    try { figma.ui.postMessage({ type: 'built', ok: true, text: await receiveFromAE(msg.text) }); }
    catch (e) {
      console.log('LayerBoat: build failed', e);
      figma.ui.postMessage({ type: 'built', ok: false, text: 'Could not build the layers: ' + (e && e.message ? e.message : e) });
    }
    return;
  }
  if (msg.type === 'toai') {
    try { figma.ui.postMessage({ type: 'svg', text: await svgForIllustrator() }); }
    catch (e) { figma.ui.postMessage({ type: 'error', text: e && e.message ? e.message : String(e) }); }
    return;
  }
  if (msg.type !== 'copy' && msg.type !== 'send') return;
  warnings = {};
  var sel = figma.currentPage.selection;
  if (!sel.length) {
    figma.ui.postMessage({ type: 'error', text: 'Select something first.' });
    return;
  }
  try {
    var payload, count = 0;
    if (separateFrames(sel)) {
      // each frame becomes its own comp
      var subs = [], ordered = readingOrder(sel);
      for (var fi = 0; fi < ordered.length; fi++) {
        figma.ui.postMessage({ type: 'progress', text: 'Reading frame ' + (fi + 1) + ' of ' + ordered.length + '...' });
        var sub = await makePayload([ordered[fi]]);
        count += countLayers(sub.layers);
        subs.push(sub);
      }
      payload = { bridge: 'figma-to-ae', version: 1, name: subs.length + ' frames', width: subs[0].width, height: subs[0].height, layers: [], multi: subs };
    } else {
      payload = await makePayload(sel);
      count = countLayers(payload.layers);
    }
    figma.ui.postMessage({
      type: 'data',
      mode: msg.type,
      text: asciiJSON(payload),
      count: count,
      warnings: Object.keys(warnings)
    });
  } catch (err) {
    figma.ui.postMessage({ type: 'error', text: 'Something went wrong: ' + (err && err.message ? err.message : err) });
  }
};
