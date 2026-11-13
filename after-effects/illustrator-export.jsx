// LayerBoat for Illustrator. This runs inside Illustrator: the After Effects
// panel sends it over through BridgeTalk. It describes the selection, or
// everything on the active artboard, in the same form the Figma plugin
// uses, writes that to a temporary file and returns the file's path.
function LayerBoatAI_export(opts) {
  opts = opts || {};
  // the script engine keeps running between sends, so old data is cleared first
  try { $.gc(); } catch (eG) {}
  var plog = new File(opts.log || (Folder.temp.fsName + '/bridge-ai-log.txt'));
  try { plog.open('w'); plog.writeln('received ' + new Date()); plog.close(); } catch (eL0) {}
  var started = new Date().getTime();
  // written in batches every second or so, so a slow export still shows where it is
  var pending = [], lastFlush = started;
  function flushLog() { if (!pending.length) return; try { plog.open('a'); plog.write(pending.join(String.fromCharCode(10)) + String.fromCharCode(10)); plog.close(); } catch (eN) {} pending = []; }
  function note(m) {
    var t = new Date().getTime();
    pending.push((t - started) + 'ms ' + m);
    if (t - lastFlush > 1000) { lastFlush = t; flushLog(); }
  }
  if (!app.documents.length) return finish('ERR Open a document in Illustrator first.');
  var doc = app.activeDocument;
  var oldCoords = app.coordinateSystem;
  app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
  var warnings = {};
  var images = 0;
  // every throwaway document is listed, so all of them are closed at the end whatever happens
  var SCRATCH_DOCS = [];
  function scratchDoc(w, h) { var d = app.documents.add(DocumentColorSpace.RGB, w, h); SCRATCH_DOCS.push(d); return d; }
  function closeScratchDocs() {
    for (var i = 0; i < SCRATCH_DOCS.length; i++) { try { SCRATCH_DOCS[i].close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
    SCRATCH_DOCS = [];
  }
  // images for Figma travel inside the data, as base64, and so do the shapes, as SVG
  var IMAGES = {};
  var SVG_TEXT = null;
  var B64PAIRS = null;
  function base64Of(file) {
    var T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (!B64PAIRS) { B64PAIRS = []; for (var p = 0; p < 4096; p++) B64PAIRS.push(T.charAt(p >> 6) + T.charAt(p & 63)); }
    file.encoding = 'BINARY';
    if (!file.open('r')) return null;
    var bin = file.read(); file.close();
    var out = [], part = [], n = bin.length, P = B64PAIRS, i;
    for (i = 0; i + 2 < n; i += 3) {
      var t = ((bin.charCodeAt(i) & 255) << 16) | ((bin.charCodeAt(i + 1) & 255) << 8) | (bin.charCodeAt(i + 2) & 255);
      part.push(P[t >> 12] + P[t & 4095]);
      if (part.length === 8192) { out.push(part.join('')); part = []; }
    }
    var rest = n - i;
    if (rest === 1) { var a = (bin.charCodeAt(i) & 255) << 16; part.push(P[a >> 12] + '=='); }
    else if (rest === 2) { var b = ((bin.charCodeAt(i) & 255) << 16) | ((bin.charCodeAt(i + 1) & 255) << 8); part.push(P[b >> 12] + T.charAt((b >> 6) & 63) + '='); }
    out.push(part.join(''));
    return out.join('');
  }
  try {
    var abIndex = doc.artboards.getActiveArtboardIndex();
    var ab = doc.artboards[abIndex];
    var R = ab.artboardRect;
    var X0 = R[0], Y0 = R[1], W = R[2] - R[0], H = R[1] - R[3];
    // read now: references into the document can go stale once other documents open and close
    var AB_NAME = String(ab.name), AB_COUNT = doc.artboards.length, DOC_NAME = String(doc.name), DOC_PATH = '';
    try { DOC_PATH = doc.fullName.fsName; } catch (eFp) { DOC_PATH = DOC_NAME; }

    // ---------- helpers ----------
    function r(n) { return Math.round(n * 1000) / 1000; }
    function pt(p) { return [r(p[0] - X0), r(Y0 - p[1])]; }
    function enumName(v) { var s = String(v); return s.substring(s.lastIndexOf('.') + 1); }
    var BLENDS = { MULTIPLY: 'MULTIPLY', SCREEN: 'SCREEN', OVERLAY: 'OVERLAY', DARKEN: 'DARKEN', LIGHTEN: 'LIGHTEN',
      COLORDODGE: 'COLOR_DODGE', COLORBURN: 'COLOR_BURN', HARDLIGHT: 'HARD_LIGHT', SOFTLIGHT: 'SOFT_LIGHT',
      DIFFERENCE: 'DIFFERENCE', EXCLUSION: 'EXCLUSION', HUE: 'HUE', SATURATIONBLEND: 'SATURATION', COLORBLEND: 'COLOR', LUMINOSITY: 'LUMINOSITY' };
    function blendOf(item) { try { return BLENDS[enumName(item.blendingMode)] || 'NORMAL'; } catch (e) { return 'NORMAL'; } }

    // a colour as red, green, blue from 0 to 1, or null for no colour
    function rgbOf(c) {
      if (!c) return null;
      var t = c.typename;
      if (t === 'RGBColor') return [c.red / 255, c.green / 255, c.blue / 255];
      if (t === 'GrayColor') { var g = 1 - c.gray / 100; return [g, g, g]; }
      if (t === 'CMYKColor') {
        try {
          var v = app.convertSampleColor(ImageColorSpace.CMYK, [c.cyan, c.magenta, c.yellow, c.black], ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose);
          var out = [v[0] / 255, v[1] / 255, v[2] / 255];
          INK[String(rnd3(out))] = [c.cyan / 100, c.magenta / 100, c.yellow / 100, c.black / 100];
          return out;
        } catch (e) {
          return [(1 - c.cyan / 100) * (1 - c.black / 100), (1 - c.magenta / 100) * (1 - c.black / 100), (1 - c.yellow / 100) * (1 - c.black / 100)];
        }
      }
      if (t === 'SpotColor') {
        var base = rgbOf(c.spot.color), k = c.tint / 100;
        return base ? [1 - (1 - base[0]) * k, 1 - (1 - base[1]) * k, 1 - (1 - base[2]) * k] : null;
      }
      return null;
    }
    function rnd3(c) { return [r(c[0]), r(c[1]), r(c[2])]; }
    var INK = {};

    // A gradient's stops, with Illustrator's midpoints turned into an extra stop
    function stopsOf(g) {
      var out = [], s = g.gradientStops;
      for (var i = 0; i < s.length; i++) {
        var c = rgbOf(s[i].color) || [0, 0, 0], a = (s[i].opacity === undefined ? 100 : s[i].opacity) / 100;
        out.push({ pos: r(s[i].rampPoint / 100), color: rnd3(c).concat([r(a)]) });
        if (i < s.length - 1 && Math.abs(s[i].midPoint - 50) > 0.5) {
          var n = s[i + 1], c2 = rgbOf(n.color) || [0, 0, 0], a2 = (n.opacity === undefined ? 100 : n.opacity) / 100;
          var p = s[i].rampPoint + (n.rampPoint - s[i].rampPoint) * s[i].midPoint / 100;
          out.push({ pos: r(p / 100), color: [r((c[0] + c2[0]) / 2), r((c[1] + c2[1]) / 2), r((c[2] + c2[2]) / 2), r((a + a2) / 2)] });
        }
      }
      return out;
    }
    // A paint as LayerBoat describes it, in the item's own space (ox, oy is its top left)
    function paintOf(c, ox, oy) {
      if (!c || c.typename === 'NoColor') return null;
      if (c.typename === 'GradientColor') {
        var g = c.gradient, o = pt(c.origin), a = c.angle * Math.PI / 180, len = c.length;
        var e = pt([c.origin[0] + len * Math.cos(a), c.origin[1] + len * Math.sin(a)]);
        return { type: g.type === GradientType.RADIAL ? 'radial' : 'linear', start: [r(o[0] - ox), r(o[1] - oy)], end: [r(e[0] - ox), r(e[1] - oy)], stops: stopsOf(g), opacity: 1, blend: 'NORMAL' };
      }
      if (c.typename === 'PatternColor') return { type: 'raster' };
      var rgb = rgbOf(c);
      return rgb ? { type: 'solid', color: rnd3(rgb).concat([1]), opacity: 1, blend: 'NORMAL' } : null;
    }

    // the name the artist gave the item in the Layers panel, or ''
    function ownName(item) { try { return String(item.name || ''); } catch (e) { return ''; } }
    function hex(c) { var rgb = rgbOf(c); if (!rgb) return ''; var h = '#'; for (var i = 0; i < 3; i++) { var v = Math.round(rgb[i] * 255).toString(16).toUpperCase(); h += v.length < 2 ? '0' + v : v; } return h; }
    // An unnamed shape is named after what it looks like, so the timeline reads at a glance
    // works from the points already read (LayerBoat's own path data), since each read from Illustrator is slow
    function shapeName(bpaths, style, fallback) {
      var kind = fallback;
      if (bpaths.length === 1) {
        var bp = bpaths[0], n = bp.v.length, curved = 0;
        for (var i = 0; i < n; i++) if (Math.abs(bp.i[i][0]) + Math.abs(bp.i[i][1]) + Math.abs(bp.o[i][0]) + Math.abs(bp.o[i][1]) > 0.01) curved++;
        if (n === 2 && !bp.closed) kind = 'Line';
        else if (n === 4 && bp.closed && curved === 4) kind = 'Ellipse';
        else if (n === 4 && bp.closed && curved === 0) kind = 'Rectangle';
        else if (bp.closed && curved === 0 && n >= 8 && n % 2 === 0) kind = 'Star';
      }
      var col = '';
      try { col = style.filled ? hex(style.fillColor) : (style.stroked ? hex(style.strokeColor) : ''); } catch (e) {}
      return kind + (col ? ' ' + col : '');
    }
    // control characters become spaces; written with character codes, which survive
    // the trip to Illustrator where some escaped characters do not
    function cleanText(t) {
      t = String(t); var o = '', sp = false;
      for (var i = 0; i < t.length && o.length < 40; i++) {
        var c = t.charCodeAt(i);
        if (c <= 32) { sp = o.length > 0; continue; }
        if (sp) { o += ' '; sp = false; }
        o += t.charAt(i);
      }
      return o;
    }
    // a group is named after the first text inside it, which is usually what it is
    function firstText(g) {
      try {
        for (var i = 0; i < g.pageItems.length; i++) {
          var it = g.pageItems[i];
          if (it.typename === 'TextFrame' && cleanText(it.contents)) return cleanText(it.contents);
          if (it.typename === 'GroupItem') { var t = firstText(it); if (t) return t; }
        }
      } catch (e) {}
      return '';
    }

    function base(item, kind) {
      var gb = item.geometricBounds, tl = pt([gb[0], gb[1]]);
      var name = '';
      try { name = item.name; } catch (e) {}
      var id = '';
      try { id = item.uuid; } catch (e2) {}
      return {
        name: name || kind, id: 'ai:' + (id || Math.random().toString(36).slice(2)), opacity: r((item.opacity === undefined ? 100 : item.opacity) / 100),
        blend: blendOf(item), x: tl[0], y: tl[1], rotation: 0, scaleX: 100, scaleY: 100, skew: 0,
        width: r(gb[2] - gb[0]), height: r(gb[1] - gb[3]), effects: []
      };
    }

    // one Illustrator path as LayerBoat's path, relative to the top left ox, oy
    function pathOf(p, ox, oy) {
      // every read from Illustrator costs time, so each point is fetched once
      var v = [], ins = [], outs = [], pts = p.pathPoints, n = pts.length;
      for (var i = 0; i < n; i++) {
        var pp = pts[i], a = pp.anchor, l = pp.leftDirection, rd = pp.rightDirection;
        v.push([r(a[0] - X0 - ox), r(Y0 - a[1] - oy)]);
        ins.push([r(l[0] - a[0]), r(a[1] - l[1])]);
        outs.push([r(rd[0] - a[0]), r(a[1] - rd[1])]);
      }
      return { v: v, i: ins, o: outs, closed: p.closed };
    }

    function strokeOf(p, ox, oy) {
      if (!p.stroked || !p.strokeWidth) return null;
      var paint = paintOf(p.strokeColor, ox, oy);
      if (!paint) return null;
      if (paint.type === 'raster') return { raster: true };
      var cap = enumName(p.strokeCap), join = enumName(p.strokeJoin);
      var dash = null;
      try { if (p.strokeDashes && p.strokeDashes.length) { dash = []; for (var i = 0; i < p.strokeDashes.length; i++) dash.push(p.strokeDashes[i]); if (dash.length % 2) dash = dash.concat(dash); } } catch (e) {}
      return {
        paints: [paint], weight: r(p.strokeWidth), sides: null, align: 'CENTER',
        cap: cap === 'ROUNDENDCAP' ? 'ROUND' : (cap === 'PROJECTINGENDCAP' ? 'SQUARE' : 'NONE'),
        join: join === 'ROUNDENDJOIN' ? 'ROUND' : (join === 'BEVELENDJOIN' ? 'BEVEL' : 'MITER'),
        miter: p.strokeMiterLimit || 4, dash: dash, raster: false
      };
    }

    // ---------- shapes drawn by After Effects itself ----------
    // Reading shapes point by point through scripting is slow. Instead each shape
    // LayerBoat wants as its own layer is copied, on a layer of its own, into a
    // throwaway Illustrator file. After Effects imports that file and turns each
    // layer into a shape layer with its own Illustrator reader, which is fast and
    // exact. Your file is never changed.
    // For Figma the same throwaway file is saved as SVG instead, which Figma reads itself
    var NATIVE_ON = opts.native !== false;
    var JOBS = [], JOB_BY_KEY = {}, GROUP_ITEMS = [];
    function addJob(item, o, kind) {
      var key = 'bridge' + JOBS.length;
      var job = { key: key, item: item, o: o, kind: kind, skip: false };
      JOBS.push(job); JOB_BY_KEY[key] = job;
      return key;
    }
    function groupItemOf(o) { for (var i = 0; i < GROUP_ITEMS.length; i++) if (GROUP_ITEMS[i].o === o) return GROUP_ITEMS[i].item; return null; }
    // a quick name from the first few points, without reading every point
    function quickName(paths, style, fallback) {
      try {
        if (paths.length === 1 && paths[0].pathPoints.length <= 4) return shapeName([pathOf(paths[0], 0, 0)], style, fallback);
      } catch (e) {}
      return shapeName([], style, fallback);
    }
    var rgbCache = {};
    function rgbColor(c) {
      if (!c || c.typename === 'RGBColor' || c.typename === 'NoColor' || c.typename === 'GradientColor' || c.typename === 'PatternColor') return null;
      var key = c.typename;
      try { if (c.typename === 'CMYKColor') key += [c.cyan, c.magenta, c.yellow, c.black].join(','); else if (c.typename === 'GrayColor') key += c.gray; else if (c.typename === 'SpotColor') key += c.spot.name + c.tint; } catch (e) {}
      if (!rgbCache[key]) {
        var v = rgbOf(c);
        if (!v) return null;
        rgbCache[key] = [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255)];
      }
      var o = new RGBColor(); o.red = rgbCache[key][0]; o.green = rgbCache[key][1]; o.blue = rgbCache[key][2];
      return o;
    }
    function toRGB(nd) {
      if (doc.documentColorSpace !== DocumentColorSpace.CMYK && !doc.spots.length) return;
      var t0 = new Date().getTime(), n = 0;
      var paths = nd.pathItems, np = paths.length;
      for (var i = 0; i < np; i++) {
        var p = paths[i], c;
        if (p.filled && (c = rgbColor(p.fillColor))) { p.fillColor = c; n++; }
        if (p.stroked && (c = rgbColor(p.strokeColor))) { p.strokeColor = c; n++; }
      }
      var gs = nd.gradients;
      for (var g = 0; g < gs.length; g++) {
        var st = gs[g].gradientStops;
        for (var k = 0; k < st.length; k++) { var gc = rgbColor(st[k].color); if (gc) st[k].color = gc; }
      }
      note('colours set to RGB: ' + n + ' in ' + (new Date().getTime() - t0) + 'ms');
    }
    // the payload's colours are rounded, so a path's colour can be one step off
    function nearFill(map, c) {
      for (var k in map) {
        if (!map.hasOwnProperty(k)) continue;
        var p = k.split(',');
        if (Math.abs(p[0] - c.red) <= 1 && Math.abs(p[1] - c.green) <= 1 && Math.abs(p[2] - c.blue) <= 1) return map[k];
      }
      return null;
    }
    // old colour to new colour for every part of o that was recoloured; returns how many
    function fillMap(o, map) {
      var n = 0;
      if (o.__fill) { map[o.__old] = o.__fill; n++; }
      if (o.type === 'group') for (var i = 0; i < o.children.length; i++) n += fillMap(o.children[i], map);
      return n;
    }
    function white() { var c = new RGBColor(); c.red = 255; c.green = 255; c.blue = 255; return c; }
    // the throwaway file: one layer per shape, named by its key, on the same artboard
    function writeNative() {
      var live = [];
      for (var i = 0; i < JOBS.length; i++) if (!JOBS[i].skip) live.push(JOBS[i]);
      if (!live.length) return null;
      var t0 = new Date().getTime();
      var nd = scratchDoc(Math.max(W, 10), Math.max(H, 10));
      var path = null;
      try {
        var first = nd.layers[0], shifted = false;
        // added from the top down, so the first job ends up lowest
        for (var j = 0; j < live.length; j++) {
          var job = live[j], L = nd.layers.add();
          L.name = job.key; job.layer = L;
          var dup = job.item.duplicate(L, ElementPlacement.PLACEATBEGINNING);
          if (!shifted) {
            // the two documents count from different origins: the artboard is moved to match
            var g1 = job.item.geometricBounds, g2 = dup.geometricBounds, dx = g2[0] - g1[0], dy = g2[1] - g1[1];
            nd.artboards[0].artboardRect = [R[0] + dx, R[1] + dy, R[2] + dx, R[3] + dy];
            shifted = true;
            note('shape file offset ' + r(dx) + ', ' + r(dy));
          }
          try { dup.hidden = false; } catch (e1) {}
          try { dup.opacity = 100; } catch (e2) {}
          try { dup.blendingMode = BlendModes.NORMAL; } catch (e3) {}
          if (job.kind === 'mask') {
            // a clipping path has no paint of its own; as a matte it is solid white
            var parts = dup.typename === 'CompoundPathItem' ? dup.pathItems : [dup];
            for (var q = 0; q < parts.length; q++) {
              try { parts[q].clipping = false; } catch (e4) {}
              parts[q].filled = true; parts[q].fillColor = white(); parts[q].stroked = false;
            }
          }
        }
        try { if (!first.pageItems.length) first.remove(); } catch (e5) {}
        // CMYK, grey and spot colours are set as the RGB Illustrator shows them.
        // Left as they are, After Effects converts them itself and the colours drift.
        try { toRGB(nd); } catch (e7) { note('colour conversion: ' + e7); }
        // items whose blend mode was worked out above get the colours Illustrator shows
        var maps = {}, anyMap = false;
        for (var fj = 0; fj < live.length; fj++) {
          if (live[fj].kind === 'mask') continue;
          var fmap = {};
          if (fillMap(live[fj].o, fmap)) { maps[live[fj].key] = fmap; anyMap = true; }
        }
        if (anyMap) {
          var fps = nd.pathItems, nre = 0;
          for (var fp = 0; fp < fps.length; fp++) {
            try {
              var pp = fps[fp], m2 = maps[pp.layer.name];
              if (!m2 || pp.clipping || !pp.filled || pp.fillColor.typename !== 'RGBColor') continue;
              var to = nearFill(m2, pp.fillColor);
              if (!to) continue;
              var fc = new RGBColor(); fc.red = to[0]; fc.green = to[1]; fc.blue = to[2];
              pp.fillColor = fc; nre++;
            } catch (e9) {}
          }
          note('ink blend: ' + nre + ' paths recoloured');
        }
        var dir = new Folder(Folder.userData.fsName + '/LayerBoat');
        if (!dir.exists) dir.create();
        if (opts.forFigma) {
          // one group per shape, named by its key, in the artboard's own coordinates
          var sf = new File(dir.fsName + '/ai-shapes-' + started + '.svg');
          var se = new ExportOptionsSVG();
          se.embedRasterImages = true; se.embedAllFonts = false; se.fontType = SVGFontType.OUTLINEFONT;
          se.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;
          se.coordinatePrecision = 3; se.documentEncoding = SVGDocumentEncoding.UTF8;
          se.DTD = SVGDTDVersion.SVG1_1; se.includeFileInfo = false; se.preserveEditability = false;
          try { se.artboardRange = '1'; se.saveMultipleArtboards = false; } catch (eAr) {}
          nd.exportFile(sf, ExportType.SVG, se);
          sf.encoding = 'UTF-8';
          if (sf.open('r')) { SVG_TEXT = sf.read(); sf.close(); }
          try { sf.remove(); } catch (eRm) {}
          path = SVG_TEXT ? 'svg' : null;
        } else {
          var f = new File(dir.fsName + '/ai-shapes-' + started + '.ai');
          var so = new IllustratorSaveOptions();
          so.pdfCompatible = true; so.compressed = false; so.embedICCProfile = false; so.embedLinkedFiles = false;
          nd.saveAs(f, so);
          path = f.fsName;
        }
        note('shape file: ' + live.length + ' layers in ' + (new Date().getTime() - t0) + 'ms');
      } finally {
        try { nd.close(SaveOptions.DONOTSAVECHANGES); } catch (e6) {}
        // closing a document can bring another one forward; the artwork's comes back
        try { doc.activate(); } catch (e8) {}
      }
      return path;
    }
    // if the throwaway file cannot be made, every shape is read point by point instead
    function nativeFallback() {
      for (var i = 0; i < JOBS.length; i++) {
        var job = JOBS[i], o = job.o;
        delete o.native;
        if (job.kind === 'group') continue;
        var paths = job.item.typename === 'CompoundPathItem' ? job.item.pathItems : [job.item];
        o.paths = [];
        for (var p = 0; p < paths.length; p++) if (paths[p].pathPoints.length) o.paths.push(pathOf(paths[p], o.x, o.y));
      }
    }

    // ---------- items ----------
    // Scripts cannot read live effects such as blurs, feathers and shadows, but they
    // make the drawn area larger than the shape itself. Such items come in as images.
    function hasLiveEffect(item, style) {
      try {
        var g = item.geometricBounds, v = item.visibleBounds;
        var pad = (style && style.stroked ? style.strokeWidth : 0) * (style && style.strokeJoin && enumName(style.strokeJoin) === 'MITERENDJOIN' ? (style.strokeMiterLimit || 4) / 2 : 0.5) + 1;
        return g[0] - v[0] > pad || v[2] - g[2] > pad || v[1] - g[1] > pad || g[3] - v[3] > pad;
      } catch (e) { return false; }
    }
    // time spent per step, written to the log, to find what makes an export slow
    var PT = {};
    function tick(k, t0) { PT[k] = (PT[k] || 0) + (new Date().getTime() - t0); return new Date().getTime(); }
    function shapeOf(item, paths, style, kind) {
      var t0 = new Date().getTime();
      if (hasLiveEffect(item, style)) return rasterOf(item, 'Shapes with effects such as blurs and shadows come in as images.');
      t0 = tick('effectCheck', t0);
      var o = base(item, kind);
      t0 = tick('base', t0);
      SHAPE_ITEMS.push({ o: o, item: item });
      o.type = 'shape';
      o.kind = 'path';
      o.paths = [];
      var np = paths.length, fallbackName = kind === 'Compound Path' ? 'Compound shape' : 'Shape';
      if (NATIVE_ON) {
        o.native = addJob(item, o, 'shape');
        if (!ownName(item)) o.name = quickName(paths, style, fallbackName);
      } else {
        for (var i = 0; i < np; i++) { var pi = paths[i]; if (pi.pathPoints.length) o.paths.push(pathOf(pi, o.x, o.y)); }
        if (!ownName(item)) o.name = shapeName(o.paths, style, fallbackName);
      }
      t0 = tick('paths', t0);
      o.rule = style.evenodd ? 'EVENODD' : 'NONZERO';
      o.fills = [];
      if (style.filled) { var f = paintOf(style.fillColor, o.x, o.y); if (f) o.fills.push(f); }
      o.stroke = strokeOf(style, o.x, o.y);
      t0 = tick('paint', t0);
      var needsImage = (o.fills.length && o.fills[0].type === 'raster') || (o.stroke && o.stroke.raster);
      if (needsImage) return rasterOf(item, 'Pattern fills come in as images.');
      if (!o.paths.length && !o.native) return null;
      return o;
    }

    // ---------- blend modes in CMYK documents ----------
    // A CMYK document blends ink amounts, so a blend mode looks different there than
    // in After Effects, which blends red, green and blue. When a blended item is one
    // colour over one solid background, the colour Illustrator shows is worked out
    // here and the item comes in with that colour and a normal blend mode.
    var SHAPE_ITEMS = [];
    var INK_BLENDS = {
      MULTIPLY: function (b, s) { return b * s; },
      SCREEN: function (b, s) { return 1 - (1 - b) * (1 - s); },
      OVERLAY: function (b, s) { return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },
      HARD_LIGHT: function (b, s) { return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },
      SOFT_LIGHT: function (b, s) {
        if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
        var d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        return b + (2 * s - 1) * (d - b);
      },
      DARKEN: function (b, s) { return Math.min(b, s); },
      LIGHTEN: function (b, s) { return Math.max(b, s); },
      DIFFERENCE: function (b, s) { return Math.abs(b - s); },
      EXCLUSION: function (b, s) { return b + s - 2 * b * s; },
      COLOR_DODGE: function (b, s) { return b === 0 ? 0 : (s >= 1 ? 1 : Math.min(1, b / (1 - s))); },
      COLOR_BURN: function (b, s) { return b >= 1 ? 1 : (s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)); }
    };
    function inkOf(color) {
      var k = String([color[0], color[1], color[2]]);
      if (INK[k]) return INK[k];
      try {
        var v = app.convertSampleColor(ImageColorSpace.RGB, [color[0] * 255, color[1] * 255, color[2] * 255], ImageColorSpace.CMYK, ColorConvertPurpose.defaultpurpose);
        return [v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100];
      } catch (e) { LAST_INK_ERR = String(e); return null; }
    }
    var LAST_INK_ERR = '';
    // every solid colour o is painted with, or null when any part is something else
    function coloursOf(o, found) {
      if (o.type === 'mask') return found;
      if (o.opacity < 1 || o.blend !== 'NORMAL') return null;
      if (o.type === 'group') {
        for (var i = 0; i < o.children.length; i++) { found = coloursOf(o.children[i], found); if (!found) return null; }
        return found;
      }
      if (o.type !== 'shape' || o.stroke || !o.fills || o.fills.length !== 1) return null;
      var f = o.fills[0];
      if (f.type !== 'solid' || f.opacity < 1 || f.blend !== 'NORMAL' || f.color[3] < 1) return null;
      found[colourKeyOf(f.color)] = f.color;
      return found;
    }
    function colourKeyOf(c) { return Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255); }
    function boundsOf(o) {
      if (o.type === 'group' && o.clipId) for (var i = 0; i < o.children.length; i++) if (o.children[i].id === o.clipId) return boundsOf(o.children[i]);
      return [o.x, o.y, o.x + o.width, o.y + o.height];
    }
    function overlaps(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }
    function contains(a, b) { return a[0] <= b[0] + 0.5 && a[1] <= b[1] + 0.5 && a[2] >= b[2] - 0.5 && a[3] >= b[3] - 0.5; }
    // a plain, solid rectangle that covers the whole of b
    function solidCover(o, b) {
      if (o.type !== 'shape' || o.opacity < 1 || o.blend !== 'NORMAL' || o.stroke) return null;
      if (!o.fills || o.fills.length !== 1 || o.fills[0].type !== 'solid' || o.fills[0].color[3] < 1) return null;
      if (!contains(boundsOf(o), b)) return null;
      if (o.kind === 'rect') return o.fills[0].color;
      for (var i = 0; i < SHAPE_ITEMS.length; i++) {
        if (SHAPE_ITEMS[i].o !== o) continue;
        var it = SHAPE_ITEMS[i].item;
        try {
          if (it.typename !== 'PathItem' || it.pathPoints.length !== 4) return null;
          var pts = it.pathPoints;
          for (var p = 0; p < 4; p++) {
            var a = pts[p].anchor, l = pts[p].leftDirection, rd = pts[p].rightDirection, n = pts[(p + 1) % 4].anchor;
            if (Math.abs(l[0] - a[0]) + Math.abs(l[1] - a[1]) + Math.abs(rd[0] - a[0]) + Math.abs(rd[1] - a[1]) > 0.01) return null;
            if (Math.abs(n[0] - a[0]) > 0.01 && Math.abs(n[1] - a[1]) > 0.01) return null;
          }
          return o.fills[0].color;
        } catch (e) { return null; }
      }
      return null;
    }
    function setFill(o, map) {
      if (o.type === 'mask') return;
      if (o.type === 'group') { for (var i = 0; i < o.children.length; i++) setFill(o.children[i], map); return; }
      var k = colourKeyOf(o.fills[0].color), rgb = map[k];
      o.fills[0].color = rgb.concat([1]);
      o.__old = k;
      o.__fill = [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
    }
    function flattenOne(o, painted) {
      var mode = INK_BLENDS[o.blend];
      if (!mode) return false;
      var keepOp = o.opacity, keepBl = o.blend;
      o.opacity = 1; o.blend = 'NORMAL';
      var fgs = coloursOf(o, {});
      o.opacity = keepOp; o.blend = keepBl;
      if (!fgs) { note('ink blend skipped, ' + o.name + ': not all plain colours'); return false; }
      var b = boundsOf(o), bg = null;
      for (var i = painted.length - 1; i >= 0; i--) {
        if (!overlaps(boundsOf(painted[i]), b)) continue;
        bg = solidCover(painted[i], b);
        if (!bg) note('ink blend skipped, ' + o.name + ': ' + painted[i].name + ' underneath is not one plain colour');
        break;
      }
      if (!bg) return false;
      var bi = inkOf(bg);
      if (!bi) { note('ink blend skipped, ' + o.name + ': no ink values for the background ' + String(bg) + ' ' + LAST_INK_ERR); return false; }
      var map = {}, shown = [];
      for (var k in fgs) {
        if (!fgs.hasOwnProperty(k)) continue;
        var si = inkOf(fgs[k]);
        if (!si) { note('ink blend skipped, ' + o.name + ': no ink values for ' + k + ' ' + LAST_INK_ERR); return false; }
        var out = [];
        for (var c = 0; c < 4; c++) {
          // the ink amounts are blended as the light they leave, which is how Illustrator does it
          var res = 1 - mode(1 - bi[c], 1 - si[c]);
          out.push((bi[c] + (res - bi[c]) * o.opacity) * 100);
        }
        var v;
        try { v = app.convertSampleColor(ImageColorSpace.CMYK, out, ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose); } catch (e) { return false; }
        map[k] = rnd3([v[0] / 255, v[1] / 255, v[2] / 255]);
        shown.push(k + ' -> ' + Math.round(v[0]) + ',' + Math.round(v[1]) + ',' + Math.round(v[2]));
      }
      setFill(o, map);
      note('ink blend: ' + o.name + ' ' + o.blend + ' at ' + o.opacity + ': ' + shown.join(' / '));
      o.blend = 'NORMAL'; o.opacity = 1;
      return true;
    }
    // walks the artwork from the bottom up, keeping what has been painted so far
    function flattenInkBlends(list, painted) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o.blend && o.blend !== 'NORMAL' && flattenOne(o, painted)) { painted.push(o); continue; }
        if (o.type === 'group' && !o.combine && o.opacity >= 1 && o.blend === 'NORMAL') { flattenInkBlends(o.children, painted); continue; }
        painted.push(o);
      }
    }

    function sameStyle(a, b) {
      for (var k in a) {
        if (!a.hasOwnProperty(k) || k === 'start' || k === 'end') continue;
        if (String(a[k]) !== String(b[k])) return false;
      }
      return true;
    }
    function textOf(tf) {
      if (tf.kind === TextType.PATHTEXT) return rasterOf(tf, 'Text on a path comes in as an image.');
      var o = base(tf, 'Text');
      o.type = 'text';
      o.name = ownName(tf) || cleanText(tf.contents) || 'Text';
      var text = String(tf.contents).split(String.fromCharCode(3)).join(String.fromCharCode(13));
      o.characters = text;
      var segs = [], pos = 0, runs = tf.textRanges;
      for (var i = 0; i < runs.length; i++) {
        var run = runs[i], len = run.contents.length;
        if (!len) continue;
        var ca = run.characterAttributes, font = ca.textFont;
        var col = rgbOf(ca.fillColor);
        var seg = {
          start: pos, end: pos + len, fontFamily: font.family, fontStyle: font.style, fontSize: r(ca.size),
          color: col ? rnd3(col).concat([1]) : [0, 0, 0, 1], tracking: ca.tracking || 0,
          leading: ca.autoLeading ? null : r(ca.leading), textCase: enumName(ca.capitalization) === 'ALLCAPS' ? 'UPPER' : 'ORIGINAL',
          underline: !!ca.underline, strike: !!ca.strikeThrough
        };
        pos += len;
        // Illustrator often hands text over a character at a time, so matching neighbours are joined
        var prev = segs.length ? segs[segs.length - 1] : null;
        if (prev && sameStyle(prev, seg)) prev.end = seg.end; else segs.push(seg);
      }
      if (!segs.length) return null;
      var first = segs[0];
      for (var k in first) if (first.hasOwnProperty(k) && k !== 'start' && k !== 'end') o[k] = first[k];
      o.start = 0; o.end = text.length;
      o.segments = segs;
      var just = 'LEFT';
      try { just = enumName(tf.paragraphs[0].paragraphAttributes.justification); } catch (e) {}
      o.align = just === 'CENTER' ? 'CENTER' : (just === 'RIGHT' ? 'RIGHT' : (just.indexOf('JUSTIFY') !== -1 ? 'JUSTIFIED' : 'LEFT'));
      o.vAlign = 'TOP';
      o.stroke = null;
      o.decorations = [];
      var m = tf.matrix;
      var rot = -Math.atan2(m.mValueB, m.mValueA) * 180 / Math.PI;
      var sx = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB), sy = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
      if (tf.kind === TextType.POINTTEXT) {
        // point text sits on its baseline at the anchor, the same as in After Effects
        o.autoResize = 'WIDTH_AND_HEIGHT';
        o.anchorPoint = pt(tf.anchor);
        o.rotation = r(rot);
        o.scaleX = r(sx * 100); o.scaleY = r(sy * 100);
      } else {
        var tb = null;
        try { tb = tf.textPath.geometricBounds; } catch (eTp) {}
        if (!tb) tb = tf.geometricBounds;
        var tl = pt([tb[0], tb[1]]);
        o.autoResize = 'HEIGHT';
        o.x = tl[0]; o.y = tl[1]; o.width = r(tb[2] - tb[0]); o.height = r(tb[1] - tb[3]);
      }
      if (opts.forFigma) { var ink = textInkOf(tf); if (ink) o.ink = ink; }
      return o;
    }
    // where the letters are actually drawn, from an outlined copy in a throwaway document
    var inkDoc = null;
    function textInkOf(tf) {
      try {
        if (!inkDoc) { inkDoc = scratchDoc(100, 100); try { doc.activate(); } catch (eA) {} }
        var dup = tf.duplicate(inkDoc.layers[0], ElementPlacement.PLACEATBEGINNING);
        var outl = dup.createOutline();
        var gb = outl.geometricBounds;
        outl.remove();
        var tl = pt([gb[0], gb[1]]);
        return [tl[0], tl[1], r(gb[2] - gb[0]), r(gb[1] - gb[3])];
      } catch (e) { return null; }
    }

    function groupOf(g, kind) {
      var o = base(g, kind || 'Group');
      if (!ownName(g)) { var ft = firstText(g); o.name = ft ? ft + ' group' : (g.clipped ? 'Clip group' : 'Group'); }
      GROUP_ITEMS.push({ o: o, item: g });
      o.type = 'group';
      o.isFrame = false;
      o.clips = false;
      o.children = [];
      var items = [];
      for (var i = g.pageItems.length - 1; i >= 0; i--) items.push(g.pageItems[i]);
      if (g.clipped) {
        // Illustrator's clipping path becomes a mask under the rest
        for (var c = 0; c < items.length; c++) {
          var it = items[c], clip = false;
          try { clip = it.typename === 'PathItem' ? it.clipping : (it.typename === 'CompoundPathItem' && it.pathItems.length && it.pathItems[0].clipping); } catch (e) {}
          if (!clip) continue;
          var paths = it.typename === 'PathItem' ? [it] : it.pathItems;
          var m = base(it, 'Clip');
          m.type = 'mask'; m.kind = 'path'; m.paths = [];
          if (NATIVE_ON) m.native = addJob(it, m, 'mask');
          else for (var p = 0; p < paths.length; p++) m.paths.push(pathOf(paths[p], m.x, m.y));
          m.rule = 'NONZERO'; m.opacity = 1; m.blend = 'NORMAL';
          m.id = o.id + ':clip'; m.name = 'Clip';
          o.children.push(m);
          // everything in the group is matted to the clipping path
          o.clipId = m.id;
          items.splice(c, 1);
          break;
        }
      }
      for (var k = 0; k < items.length; k++) { var cnv = convert(items[k]); if (cnv) o.children.push(cnv); }
      if (!o.children.length) return null;
      if (o.opacity < 1 || o.blend !== 'NORMAL') o.precomp = true;
      return o;
    }

    // Anything After Effects shapes cannot draw is rendered by Illustrator as an image
    var scratch = null;
    var rasterLog = [];
    function rasterOf(item, why) {
      if (why) warnings[why] = true;
      rasterLog.push(item.typename + (why ? ': ' + why : ''));
      var vb = item.visibleBounds, tl = pt([vb[0], vb[1]]);
      var w = vb[2] - vb[0], h = vb[1] - vb[3];
      if (w < 0.5 || h < 0.5) return null;
      if (!scratch) {
        scratch = scratchDoc(Math.max(w, 10), Math.max(h, 10));
        // blur sizes are counted in raster effect pixels, so the scratch copy uses the same resolution
        try { scratch.rasterEffectSettings.resolution = doc.rasterEffectSettings.resolution; } catch (eRs) { note('raster settings ' + eRs); }
      }
      var dup = item.duplicate(scratch.layers[0], ElementPlacement.PLACEATBEGINNING);
      dup.hidden = false;
      // the layer in After Effects carries the opacity and blend mode, so the image is drawn without them
      try { dup.opacity = 100; } catch (eO) {}
      try { dup.blendingMode = BlendModes.NORMAL; } catch (eBm) {}
      scratch.artboards[0].artboardRect = dup.visibleBounds;
      var dir = new Folder(Folder.userData.fsName + '/LayerBoat');
      if (!dir.exists) dir.create();
      dir = new Folder(dir.fsName + '/ai-images');
      if (!dir.exists) dir.create();
      var f = new File(dir.fsName + '/ai-' + started + '-' + (images++) + '.png');
      // a capture at 144 ppi scales blurs and shadows along with the art, which a scaled export does not
      var captured = false;
      try {
        var co = new ImageCaptureOptions();
        co.resolution = 144; co.antiAliasing = true; co.transparency = true;
        scratch.imageCapture(f, dup.visibleBounds, co);
        captured = f.exists;
      } catch (eC) { note('capture failed ' + eC); }
      if (!captured) {
        var eo = new ExportOptionsPNG24();
        eo.antiAliasing = true; eo.transparency = true; eo.artBoardClipping = true;
        eo.horizontalScale = 200; eo.verticalScale = 200;
        scratch.exportFile(f, ExportType.PNG24, eo);
      }
      dup.remove();
      note('image ' + Math.round(w) + 'x' + Math.round(h));
      var o = base(item, 'Image');
      if (!ownName(item)) {
        var IMG = { MeshItem: 'Gradient mesh', SymbolItem: 'Symbol', PlacedItem: 'Placed image', RasterItem: 'Image', TextFrame: 'Text on a path', PluginItem: 'Effect', GraphItem: 'Graph' };
        o.name = IMG[item.typename] || 'Image';
        try { if (item.typename === 'TextFrame' && item.kind !== TextType.PATHTEXT) o.name = cleanText(item.contents) || 'Text'; } catch (eTn) {}
        try {
          if (item.typename === 'PathItem') o.name = shapeName([pathOf(item, 0, 0)], item, 'Shape') + ' with effect';
          else if (item.typename === 'CompoundPathItem') o.name = 'Compound shape with effect';
        } catch (eNm) {}
      }
      try { if (item.typename === 'SymbolItem' && !ownName(item)) o.name = item.symbol.name; } catch (eSy) {}
      o.x = tl[0]; o.y = tl[1]; o.width = r(w); o.height = r(h);
      o.type = 'shape'; o.kind = 'rect'; o.radius = 0; o.fills = []; o.stroke = null;
      o.image = { file: f.fsName, scale: 2, dx: 0, dy: 0 };
      if (opts.forFigma) {
        var key = 'img' + images;
        var data = base64Of(f);
        if (data) { IMAGES[key] = data; o.image.key = key; }
      }
      return o;
    }

    plog.open('a');
    plog.writeln('started, ' + doc.pageItems.length + ' items in the document');
    plog.close();
    // one item that cannot be read never stops the rest: it comes in as an image, or is left out
    function convert(item) {
      try { if (item.hidden) return null; } catch (e) {}
      note(item.typename + ' ' + ownName(item));
      try { return convertItem(item); } catch (err) {
        note('could not read: ' + err + ' (line ' + err.line + ')');
        try { return rasterOf(item, 'A few items LayerBoat could not read come in as images.'); } catch (err2) {
          warnings['A few items could not be brought in.'] = true;
          return null;
        }
      }
    }
    function convertItem(item) {
      switch (item.typename) {
        case 'PathItem':
          if (item.guides || item.clipping) return null;
          return shapeOf(item, [item], item, 'Path');
        case 'CompoundPathItem':
          var pis = item.pathItems;
          if (!pis.length) return rasterOf(item, 'Some compound shapes come in as images.');
          return shapeOf(item, pis, pis[0], 'Compound Path');
        case 'GroupItem':
          return groupOf(item);
        case 'TextFrame':
          return textOf(item);
        case 'RasterItem':
        case 'PlacedItem':
          return rasterOf(item, null);
        default:
          // symbols, meshes, live effects, graphs and the like
          return rasterOf(item, 'Symbols, meshes and live effects come in as images.');
      }
    }

    // ---------- what to send ----------
    function onArtboard(it) {
      try { var b = it.visibleBounds; return !(b[2] < R[0] || b[0] > R[2] || b[1] < R[3] || b[3] > R[1]); } catch (e) { return true; }
    }
    // a layer becomes a group: its own items, then its sublayers above them
    function layerGroup(layer, n) {
      if (!layer.visible) return null;
      var grp = { name: layer.name, id: 'ai:layer:' + n, opacity: r(layer.opacity / 100), blend: blendOf(layer),
        x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100, skew: 0, width: r(W), height: r(H), effects: [],
        type: 'group', isFrame: false, clips: false, children: [] };
      for (var i = layer.pageItems.length - 1; i >= 0; i--) {
        var it = layer.pageItems[i];
        if (!onArtboard(it)) continue;
        var c = convert(it);
        if (c) grp.children.push(c);
      }
      for (var s = layer.layers.length - 1; s >= 0; s--) {
        var sub = layerGroup(layer.layers[s], n + '.' + s);
        if (sub) grp.children.push(sub);
      }
      if (grp.opacity < 1 || grp.blend !== 'NORMAL') grp.precomp = true;
      return grp.children.length ? grp : null;
    }
    // Small vector groups such as icons, and groups drawn in a single colour, become one
    // shape layer with a shape group per piece. Bigger artwork keeps a layer per part to animate.
    function plainLeaf(o) {
      if (o.type !== 'shape' || o.image || o.kind !== 'path') return false;
      if (o.blend && o.blend !== 'NORMAL') return false;
      for (var i = 0; i < o.fills.length; i++) if (o.fills[i].type !== 'solid' && o.fills[i].type !== 'linear' && o.fills[i].type !== 'radial') return false;
      return true;
    }
    function leavesOf(g, out) {
      for (var i = 0; i < g.children.length; i++) {
        var c = g.children[i];
        if (c.type === 'group') { if (c.precomp || !leavesOf(c, out)) return null; }
        else if (plainLeaf(c)) out.push(c);
        else return null;
      }
      return out;
    }
    function colourKey(o) { var f = o.fills[0]; return f ? (f.type === 'solid' ? String(f.color) : f.type) : (o.stroke ? 'stroke' + String(o.stroke.paints[0].color) : 'none'); }
    function markMerges(list) {
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if (g.type !== 'group') continue;
        var leaves = leavesOf(g, []);
        var small = g.width * g.height <= 0.12 * W * H, oneColour = true;
        if (leaves) for (var k = 1; k < leaves.length; k++) if (colourKey(leaves[k]) !== colourKey(leaves[0])) { oneColour = false; break; }
        // many small pieces are usually text turned into outlines, or a pattern
        var tiny = false;
        if (leaves && leaves.length >= 12) {
          var hs = [];
          for (var hq = 0; hq < leaves.length; hq++) hs.push(leaves[hq].height);
          hs.sort(function (a, b) { return a - b; });
          tiny = hs[Math.floor(hs.length / 2)] < 0.05 * H;
          if (tiny && g.name === 'Group') g.name = 'Outlined text';
        }
        if (leaves && leaves.length >= 2 && (small || oneColour || tiny)) {
          g.combine = true;
          for (var m = 0; m < leaves.length; m++) leaves[m].mx = { x: r(leaves[m].x - g.x), y: r(leaves[m].y - g.y), rotation: 0, scaleX: 100, scaleY: 100, skew: 0 };
          // the whole group goes to After Effects as one layer, drawn by its own reader
          var gi = NATIVE_ON ? groupItemOf(g) : null;
          if (gi) {
            g.native = addJob(gi, g, 'group');
            for (var lv = 0; lv < leaves.length; lv++) if (leaves[lv].native && JOB_BY_KEY[leaves[lv].native]) JOB_BY_KEY[leaves[lv].native].skip = true;
          }
        } else markMerges(g.children);
      }
    }

    // Unnamed groups are named after what they hold and numbered, top of the artboard first
    var groupCount = 0;
    function kindsOf(g, out) {
      for (var i = 0; i < g.children.length; i++) {
        var c = g.children[i];
        if (c.type === 'group') kindsOf(c, out);
        else if (c.type === 'text') out.push('Text');
        else out.push(String(c.name).split(' ')[0]);
      }
      return out;
    }
    function nameGroups(list) {
      var groups = [];
      for (var i = 0; i < list.length; i++) if (list[i].type === 'group') groups.push(list[i]);
      groups.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      for (var k = 0; k < groups.length; k++) {
        var g = groups[k];
        if (g.name === 'Outlined text') { g.name = 'Outlined text ' + (++groupCount); }
        else if (g.name === 'Group' || g.name === 'Clip group') {
          var kinds = kindsOf(g, []), same = kinds.length > 1;
          for (var m = 1; m < kinds.length; m++) if (kinds[m] !== kinds[0]) { same = false; break; }
          var word = same && /^(Ellipse|Rectangle|Star|Line)$/.test(kinds[0]) ? kinds[0] + 's' : g.name;
          g.name = word + ' ' + (++groupCount);
        }
        if (!g.combine) nameGroups(g.children);
      }
    }

    var layers = [];
    var sel = doc.selection;
    if (sel && sel.length && sel.typename !== 'TextRange') {
      for (var t = sel.length - 1; t >= 0; t--) { var c1 = convert(sel[t]); if (c1) layers.push(c1); }
    } else {
      for (var L = doc.layers.length - 1; L >= 0; L--) { var g = layerGroup(doc.layers[L], String(L)); if (g) layers.push(g); }
      // with only one Illustrator layer, a parent for everything adds nothing
      if (layers.length === 1 && !layers[0].precomp) layers = layers[0].children;
      // Illustrator shows the artboard as white paper
      if (layers.length) layers.unshift({ name: 'Artboard', id: 'ai:artboard:' + abIndex, opacity: 1, blend: 'NORMAL', x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100, skew: 0,
        width: r(W), height: r(H), effects: [], type: 'shape', kind: 'rect', radius: 0, fills: [{ type: 'solid', color: [1, 1, 1, 1], opacity: 1, blend: 'NORMAL' }], stroke: null });
    }
    if (scratch) { scratch.close(SaveOptions.DONOTSAVECHANGES); try { doc.activate(); } catch (eAc) {} }
    if (inkDoc) { inkDoc.close(SaveOptions.DONOTSAVECHANGES); inkDoc = null; try { doc.activate(); } catch (eAi) {} }
    markMerges(layers);
    nameGroups(layers);
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) { try { flattenInkBlends(layers, []); } catch (eInk) { note('ink blend: ' + eInk); } }
    var nativeFile = null;
    if (NATIVE_ON && JOBS.length) {
      try { nativeFile = writeNative(); } catch (eNat) { note('shape file failed: ' + eNat + ' (line ' + eNat.line + ')'); nativeFile = null; }
      if (!nativeFile) nativeFallback();
    }
    var ptl = [];
    for (var ptk in PT) if (PT.hasOwnProperty(ptk)) ptl.push(ptk + '=' + PT[ptk] + 'ms');
    note('done | ' + ptl.join(' '));
    flushLog();
    var docName = DOC_NAME, dot = docName.lastIndexOf('.');
    if (dot > 0 && /^(ai|eps|pdf|svg|ait)$/i.test(docName.substring(dot + 1))) docName = docName.substring(0, dot);
    var payload = {
      bridge: 'figma-to-ae', version: 1, source: 'illustrator',
      name: docName + (AB_COUNT > 1 ? ' - ' + AB_NAME : ''),
      rootId: 'ai:' + DOC_PATH + ':' + abIndex,
      width: Math.round(W), height: Math.round(H), layers: layers, warnings: [], nativeFile: nativeFile,
      stats: { seconds: (new Date().getTime() - started) / 1000, images: rasterLog }
    };
    if (opts.forFigma) { payload.images = IMAGES; payload.svg = SVG_TEXT; payload.nativeFile = null; }
    for (var w2 in warnings) if (warnings.hasOwnProperty(w2)) payload.warnings.push(w2);
    var json = toJSON(payload);
    if (opts.dump) { try { var df = new File(opts.dump); df.encoding = 'UTF-8'; df.open('w'); df.write(json); df.close(); } catch (eD) {} }
    if (!layers.length) return finish('ERR Nothing to bring in. Select artwork, or put it on the active artboard.');
    if (opts.post) {
      var sent = post(json, opts.forFigma ? 'to-figma' : null);
      note('posted ' + json.length + ' chars: ' + sent);
      flushLog();
      if (sent !== true) return finish('ERR ' + sent);
      return finish('OK');
    }
    var out = new File(Folder.temp.fsName + '/bridge-from-illustrator.json');
    out.encoding = 'UTF-8';
    out.open('w'); out.write(json); out.close();
    return finish(out.fsName);
  } catch (err) {
    try { if (scratch) scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (e3) {}
    try { if (inkDoc) inkDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e5) {}
    try { flushLog(); } catch (e4) {}
    return finish('ERR ' + err + (err.line ? ' (line ' + err.line + ')' : ''));
  } finally {
    app.coordinateSystem = oldCoords;
    closeScratchDocs();
    try { doc.activate(); } catch (eF) {}
  }

  // Illustrator's scripting has no network, so the artwork is left in a file
  // that the live LayerBoat panel in After Effects watches for
  function post(body, name) {
    name = name || 'incoming-ai';
    try {
      var box = new Folder(Folder.userData.fsName + '/LayerBoat');
      if (!box.exists) box.create();
      var tmp = new File(box.fsName + '/' + name + '.part');
      tmp.encoding = 'UTF-8';
      if (!tmp.open('w')) return 'LayerBoat could not write its file.';
      tmp.write(body); tmp.close();
      var dest = new File(box.fsName + '/' + name + '.json');
      if (dest.exists) dest.remove();
      if (!tmp.rename(name + '.json')) return 'LayerBoat could not write its file.';
      return true;
    } catch (e) { return 'LayerBoat could not write its file: ' + e; }
  }

  // After Effects watches for this file, so it does not depend on BridgeTalk's reply arriving
  function finish(result) {
    try { $.gc(); } catch (eG2) {}
    var d = new File(Folder.temp.fsName + '/bridge-from-illustrator.done');
    d.encoding = 'UTF-8'; d.open('w'); d.write(result); d.close();
    if (opts.post && !opts.forFigma && result.indexOf('ERR') === 0) {
      // the panel shows this message instead of building anything
      try { post(toJSON({ bridge: 'figma-to-ae', source: 'illustrator', message: 'Illustrator: ' + result.substring(4), layers: [] })); } catch (eM) {}
    }
    if (opts.post && opts.returnTo) { try { BridgeTalk.bringToFront(opts.returnTo); } catch (eB) {} }
    return result;
  }
  // Illustrator's scripting has no JSON, so this writes it, as plain ASCII
  function toJSON(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') {
      // The backslash is built from its code: one written in this file does not always
      // reach Illustrator intact. The common characters are swapped with split and join,
      // which run at native speed, and the rare ones are found one by one.
      var BS = String.fromCharCode(92), F = String.fromCharCode;
      var esc = v.split(BS).join(BS + BS).split('"').join(BS + '"').split(F(10)).join(BS + 'n').split(F(13)).join(BS + 'r').split(F(9)).join(BS + 't');
      var re = toJSON.esc || (toJSON.esc = new RegExp('[^ -~]', 'g'));
      if (esc.search(re) === -1) return '"' + esc + '"';
      var o = [], from = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(esc)) !== null) {
        var c = m.index;
        if (c > from) o.push(esc.substring(from, c));
        o.push(BS + 'u' + ('0000' + esc.charCodeAt(c).toString(16)).slice(-4));
        from = c + 1;
      }
      if (esc.length > from) o.push(esc.substring(from));
      return '"' + o.join('') + '"';
    }
    if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(toJSON(v[i])); return '[' + a.join(',') + ']'; }
    var parts = [];
    for (var k in v) if (v.hasOwnProperty(k) && v[k] !== undefined && typeof v[k] !== 'function' && k.charAt(0) !== '_') parts.push(toJSON(k) + ':' + toJSON(v[k]));
    return '{' + parts.join(',') + '}';
  }
}

// Reads the first selected shape in Illustrator for "Update from Illustrator" in
// After Effects: its paths on the active artboard, and its fill, stroke and stroke
// width. The answer is left in the same inbox file the artwork goes through.
function LayerBoatAI_pick() {
  var msg = null, out = null;
  var oldCoords = null;
  try { oldCoords = app.coordinateSystem; } catch (eOC) {}
  try {
    if (!app.documents.length) msg = 'Illustrator: open a document and select a shape first.';
    else {
      var doc = app.activeDocument, sel = doc.selection;
      var item = null;
      if (sel && sel.length && sel.typename !== 'TextRange') item = sel[0];
      // a selected group gives its first shape
      while (item && item.typename === 'GroupItem' && item.pageItems.length) item = item.pageItems[0];
      if (!item || (item.typename !== 'PathItem' && item.typename !== 'CompoundPathItem')) msg = 'Illustrator: select a shape first.';
      else {
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var R = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect, X0 = R[0], Y0 = R[1];
        var paths = item.typename === 'CompoundPathItem' ? item.pathItems : [item];
        var style = item.typename === 'CompoundPathItem' && item.pathItems.length ? item.pathItems[0] : item;
        var list = [];
        for (var p = 0; p < paths.length; p++) {
          var pts = paths[p].pathPoints, v = [], ins = [], outs = [];
          for (var k = 0; k < pts.length; k++) {
            var pp = pts[k], a = pp.anchor, l = pp.leftDirection, rd = pp.rightDirection;
            v.push('[' + n(a[0] - X0) + ',' + n(Y0 - a[1]) + ']');
            ins.push('[' + n(l[0] - a[0]) + ',' + n(a[1] - l[1]) + ']');
            outs.push('[' + n(rd[0] - a[0]) + ',' + n(a[1] - rd[1]) + ']');
          }
          if (v.length) list.push('{"v":[' + v.join(',') + '],"i":[' + ins.join(',') + '],"o":[' + outs.join(',') + '],"closed":' + (paths[p].closed ? 'true' : 'false') + '}');
        }
        var fill = style.filled ? colour(style.fillColor) : null, stroke = style.stroked ? colour(style.strokeColor) : null;
        out = '{"bridge":"figma-to-ae","source":"illustrator","layers":[],"update":{"paths":[' + list.join(',') + '],"fill":' + (fill || 'null') +
          ',"stroke":' + (stroke || 'null') + ',"width":' + (style.stroked ? n(style.strokeWidth) : 'null') + '}}';
      }
    }
  } catch (e) { msg = 'Illustrator could not read the shape: ' + e; }
  finally { try { if (oldCoords !== null) app.coordinateSystem = oldCoords; } catch (eRC) {} }
  if (!out) out = '{"bridge":"figma-to-ae","source":"illustrator","layers":[],"message":"' + String(msg).split('"').join("'") + '"}';
  var box = new Folder(Folder.userData.fsName + '/LayerBoat');
  if (!box.exists) box.create();
  var tmp = new File(box.fsName + '/incoming-ai.part');
  tmp.encoding = 'UTF-8'; tmp.open('w'); tmp.write(out); tmp.close();
  var dest = new File(box.fsName + '/incoming-ai.json');
  if (dest.exists) dest.remove();
  tmp.rename('incoming-ai.json');
  return 'OK';

  function n(x) { return Math.round(x * 1000) / 1000; }
  // red, green, blue from 0 to 1, as Illustrator shows it, or null
  function colour(c) {
    var t = c.typename, v = null;
    if (t === 'RGBColor') v = [c.red / 255, c.green / 255, c.blue / 255];
    else if (t === 'GrayColor') { var g = 1 - c.gray / 100; v = [g, g, g]; }
    else if (t === 'CMYKColor') {
      try { var s = app.convertSampleColor(ImageColorSpace.CMYK, [c.cyan, c.magenta, c.yellow, c.black], ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose); v = [s[0] / 255, s[1] / 255, s[2] / 255]; } catch (e2) {}
    } else if (t === 'SpotColor') { var b = colour(c.spot.color); if (b) { b = b.slice(1, -1).split(','); var k2 = c.tint / 100; v = [1 - (1 - b[0]) * k2, 1 - (1 - b[1]) * k2, 1 - (1 - b[2]) * k2]; } }
    return v ? '[' + n(v[0]) + ',' + n(v[1]) + ',' + n(v[2]) + ']' : null;
  }
}

// Draws the selection, or everything on the active artboard, as one image for
// "Rasterize from Illustrator" in After Effects. It is drawn on its own in a
// throwaway document, so nothing behind it shows, at twice its size.
function LayerBoatAI_rasterize() {
  var msg = null, out = null, scratch = null;
  var oldCoords = null;
  try { oldCoords = app.coordinateSystem; } catch (eOC) {}
  try {
    if (!app.documents.length) msg = 'Illustrator: open a document first.';
    else {
      var doc = app.activeDocument;
      app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
      var R = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
      var items = [], sel = doc.selection, i;
      if (sel && sel.length && sel.typename !== 'TextRange') { for (i = 0; i < sel.length; i++) items.push(sel[i]); }
      else {
        for (i = 0; i < doc.pageItems.length; i++) {
          var it = doc.pageItems[i];
          if (it.parent.typename !== 'Layer' || it.hidden || it.layer.visible === false) continue;
          var b0 = it.visibleBounds;
          if (b0[2] > R[0] && b0[0] < R[2] && b0[1] > R[3] && b0[3] < R[1]) items.push(it);
        }
      }
      if (!items.length) msg = 'Illustrator: select something, or put artwork on the active artboard.';
      else {
        scratch = app.documents.add(DocumentColorSpace.RGB, Math.max(R[2] - R[0], 10), Math.max(R[1] - R[3], 10));
        try { scratch.rasterEffectSettings.resolution = doc.rasterEffectSettings.resolution; } catch (eRs) {}
        // copied bottom first, so the stacking stays the same
        for (i = items.length - 1; i >= 0; i--) items[i].duplicate(scratch.layers[0], ElementPlacement.PLACEATBEGINNING);
        var vb = null, k;
        for (k = 0; k < scratch.pageItems.length; k++) {
          var pi = scratch.pageItems[k];
          if (pi.parent.typename !== 'Layer') continue;
          var b = pi.visibleBounds;
          vb = vb ? [Math.min(vb[0], b[0]), Math.max(vb[1], b[1]), Math.max(vb[2], b[2]), Math.min(vb[3], b[3])] : [b[0], b[1], b[2], b[3]];
        }
        // the two documents count from different origins, so the place is measured on the original
        var ob = null;
        for (k = 0; k < items.length; k++) {
          var c = items[k].visibleBounds;
          ob = ob ? [Math.min(ob[0], c[0]), Math.max(ob[1], c[1]), Math.max(ob[2], c[2]), Math.min(ob[3], c[3])] : [c[0], c[1], c[2], c[3]];
        }
        var dir = new Folder(Folder.userData.fsName + '/LayerBoat/ai-images');
        if (!dir.exists) dir.create();
        var f = new File(dir.fsName + '/raster-' + new Date().getTime() + '.png');
        scratch.artboards[0].artboardRect = vb;
        var co = new ImageCaptureOptions();
        co.resolution = 144; co.antiAliasing = true; co.transparency = true;
        scratch.imageCapture(f, vb, co);
        var name = items.length === 1 && items[0].name ? items[0].name : (sel && sel.length ? 'Illustrator selection' : doc.artboards[doc.artboards.getActiveArtboardIndex()].name);
        name = String(name).split('"').join("'");
        var path = f.fsName.split(String.fromCharCode(92)).join('/');
        out = '{"bridge":"figma-to-ae","source":"illustrator","layers":[],"raster":{"file":"' + path.split('"').join('') + '","name":"' + name + '","x":' + r(ob[0] - R[0]) + ',"y":' + r(R[1] - ob[1]) +
          ',"width":' + r(ob[2] - ob[0]) + ',"height":' + r(ob[1] - ob[3]) + ',"artboard":[' + r(R[2] - R[0]) + ',' + r(R[1] - R[3]) + '],"artboardName":"' + String(doc.artboards[doc.artboards.getActiveArtboardIndex()].name).split('"').join("'") + '"}}';
      }
    }
  } catch (e) { msg = 'Illustrator could not draw the image: ' + e; }
  finally {
    try { if (scratch) scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {}
    try { if (oldCoords !== null) app.coordinateSystem = oldCoords; } catch (eRC) {}
  }
  if (!out) out = '{"bridge":"figma-to-ae","source":"illustrator","layers":[],"message":"' + String(msg).split('"').join("'") + '"}';
  var box = new Folder(Folder.userData.fsName + '/LayerBoat');
  if (!box.exists) box.create();
  var tmp = new File(box.fsName + '/incoming-ai.part');
  tmp.encoding = 'UTF-8'; tmp.open('w'); tmp.write(out); tmp.close();
  var dest = new File(box.fsName + '/incoming-ai.json');
  if (dest.exists) dest.remove();
  tmp.rename('incoming-ai.json');
  // After Effects asked for this, so it gets the screen back
  try { BridgeTalk.bringToFront('aftereffects'); } catch (eB) {}
  return 'OK';

  function r(x) { return Math.round(x * 1000) / 1000; }
}
