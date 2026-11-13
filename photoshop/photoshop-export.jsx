/* global ActionDescriptor, executeAction, Units, TypeUnits, DialogModes, stringIDToTypeID, charIDToTypeID, typeIDToStringID, ActionReference, executeActionGet, UnitValue, NewDocumentMode, DocumentFill, BlendMode, PNGSaveOptions, Extension, PathKind */
// LayerBoat for Photoshop: describes the open document the way the Figma plugin
// describes a frame, so After Effects builds it with the same builder.
// Text stays editable text, plain shapes stay shapes, groups stay groups and every
// other layer comes across as an image with its layer styles drawn in.
function LayerBoatPS_export(opts) {
  opts = opts || {};
  if (!app.documents.length) return 'ERR Open a Photoshop document first.';
  var doc = app.activeDocument;
  var started = new Date().getTime();
  var oldRuler = app.preferences.rulerUnits, oldType = app.preferences.typeUnits, oldDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.preferences.typeUnits = TypeUnits.PIXELS;
  app.displayDialogs = DialogModes.NO;
  var activeBefore = null;
  try { activeBefore = doc.activeLayer; } catch (eA) {}
  var notes = [], missingFonts = {};
  // time spent per step, to find what makes a send slow
  var PT = {};
  function tick(k, t0) { var t = new Date().getTime(); PT[k] = (PT[k] || 0) + (t - t0); return t; }
  var warnings = {}, scratch = null, imageCount = 0;
  var OX = 0, OY = 0;
  var F = String.fromCharCode;

  function S(s) { return stringIDToTypeID(s); }
  function C(s) { return charIDToTypeID(s); }
  function px(v) { if (typeof v === 'number') return v; try { return v.type === 'px' ? v.value : v.as('px'); } catch (e) { return Number(v); } }
  function r(n) { return Math.round(n * 1000) / 1000; }
  function warn(t) { warnings[t] = true; }

  var DOC_NAME = String(doc.name), dot = DOC_NAME.lastIndexOf('.');
  if (dot > 0) DOC_NAME = DOC_NAME.substring(0, dot);
  var DOC_PATH = '';
  try { DOC_PATH = doc.fullName.fsName; } catch (eP) { DOC_PATH = DOC_NAME; }
  var W = px(doc.width), H = px(doc.height);
  var imgDir = new Folder(opts.imageFolder || (Folder.userData.fsName + '/LayerBoat/Photoshop images'));

  // Photoshop's own description of a layer, for what its DOM does not show
  function descOf(L) {
    try { var ref = new ActionReference(); ref.putIdentifier(C('Lyr '), L.id); return executeActionGet(ref); } catch (e) { return null; }
  }
  function has(d, key) { try { return d && d.hasKey(S(key)); } catch (e) { return false; } }
  function flag(d, key) { try { return has(d, key) && d.getBoolean(S(key)); } catch (e) { return false; } }
  function effectsOn(d) {
    if (!has(d, 'layerEffects')) return false;
    try { if (has(d, 'layerFXVisible') && !d.getBoolean(S('layerFXVisible'))) return false; } catch (e) {}
    return true;
  }
  function boundsOf(L) {
    var b = L.bounds;
    return [px(b[0]), px(b[1]), px(b[2]), px(b[3])];
  }

  var BLENDS = { MULTIPLY: 'MULTIPLY', SCREEN: 'SCREEN', OVERLAY: 'OVERLAY', DARKEN: 'DARKEN', LIGHTEN: 'LIGHTEN',
    COLORDODGE: 'COLOR_DODGE', COLORBURN: 'COLOR_BURN', HARDLIGHT: 'HARD_LIGHT', SOFTLIGHT: 'SOFT_LIGHT',
    DIFFERENCE: 'DIFFERENCE', EXCLUSION: 'EXCLUSION', HUE: 'HUE', SATURATION: 'SATURATION', COLORBLEND: 'COLOR',
    LUMINOSITY: 'LUMINOSITY', LINEARBURN: 'LINEAR_BURN', LINEARDODGE: 'LINEAR_DODGE' };
  function blendOf(L) {
    try { var s = String(L.blendMode); s = s.substring(s.lastIndexOf('.') + 1); return BLENDS[s] || 'NORMAL'; } catch (e) { return 'NORMAL'; }
  }
  // Photoshop's own lookup by name is loose, and some fonts claim another font's
  // PostScript name, so the font whose family name starts that PostScript name wins
  var FONTS = {}, fontList = null;
  function squash(t) { return String(t).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function fits(f, ps) { var fam = squash(f.family); return fam.length > 0 && squash(ps).indexOf(fam) === 0; }
  function fontOf(ps) {
    ps = String(ps);
    if (FONTS.hasOwnProperty(ps)) return FONTS[ps];
    var hit = null;
    try { var g = app.fonts.getByName(ps); if (g && String(g.postScriptName) === ps && fits(g, ps)) hit = g; } catch (e) {}
    if (!hit) {
      try {
        if (!fontList) {
          fontList = {};
          for (var i = 0; i < app.fonts.length; i++) {
            var f = app.fonts[i], k = String(f.postScriptName);
            (fontList[k] = fontList[k] || []).push(f);
          }
        }
        var cands = fontList[ps] || [];
        for (var c = 0; c < cands.length && !hit; c++) if (fits(cands[c], ps)) hit = cands[c];
        if (!hit && cands.length) hit = cands[0];
      } catch (e2) {}
    }
    FONTS[ps] = hit ? { family: String(hit.family), style: String(hit.style) } : { family: ps, style: 'Regular' };
    return FONTS[ps];
  }
  function rgbOf(c) {
    try { return [r(c.rgb.red / 255), r(c.rgb.green / 255), r(c.rgb.blue / 255), 1]; } catch (e) { return [0, 0, 0, 1]; }
  }
  function amColor(cd) {
    try {
      if (cd.hasKey(C('Rd  '))) return [r(cd.getDouble(C('Rd  ')) / 255), r(cd.getDouble(C('Grn ')) / 255), r(cd.getDouble(C('Bl  ')) / 255), 1];
      if (cd.hasKey(C('Gry '))) { var g = 1 - cd.getDouble(C('Gry ')) / 100; return [r(g), r(g), r(g), 1]; }
    } catch (e) {}
    return null;
  }
  function base(L, kind, b) {
    b = b || boundsOf(L);
    return {
      name: String(L.name || kind), id: 'ps:' + L.id, opacity: r(L.opacity / 100), blend: blendOf(L),
      x: r(b[0] - OX), y: r(b[1] - OY), rotation: 0, scaleX: 100, scaleY: 100, skew: 0,
      width: r(b[2] - b[0]), height: r(b[3] - b[1]), effects: []
    };
  }

  // ---------- images ----------
  // Layers are copied one at a time into a throwaway document, cropped to their size
  // and saved as PNG, with their layer styles and masks drawn in.
  // Photoshop's quick PNG mode, without a colour profile: the fastest way it saves a PNG
  function savePng(f) {
    try {
      var d = new ActionDescriptor(), png = new ActionDescriptor();
      png.putEnumerated(S('method'), S('PNGMethod'), S('quick'));
      png.putEnumerated(S('PNGInterlaceType'), S('PNGInterlaceType'), S('PNGInterlaceNone'));
      png.putEnumerated(S('PNGFilter'), S('PNGFilter'), S('PNGFilterNone'));
      png.putInteger(S('compression'), 1);
      d.putObject(S('as'), S('PNGFormat'), png);
      d.putPath(S('in'), f);
      d.putBoolean(S('copy'), true);
      d.putBoolean(S('lowerCase'), true);
      d.putBoolean(S('embedProfiles'), false);
      executeAction(S('save'), d, DialogModes.NO);
      if (f.exists) return;
    } catch (e) {}
    scratch.saveAs(f, new PNGSaveOptions(), true, Extension.LOWERCASE);
  }
  function rasterOf(stack, name, keepLook) {
    var b = boundsOf(stack[0]);
    // the image stops at the edges of the canvas, as Photoshop shows it
    var cb = [Math.max(0, Math.floor(b[0])), Math.max(0, Math.floor(b[1])), Math.min(W, Math.ceil(b[2])), Math.min(H, Math.ceil(b[3]))];
    if (cb[2] - cb[0] < 1 || cb[3] - cb[1] < 1) return null;
    var t0 = new Date().getTime();
    // a document just the size of the image, so nothing needs cropping
    scratch = app.documents.add(UnitValue(cb[2] - cb[0], 'px'), UnitValue(cb[3] - cb[1], 'px'), doc.resolution, 'LayerBoat', NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
    t0 = tick('new', t0);
    app.activeDocument = doc;
    for (var i = 0; i < stack.length; i++) stack[i].duplicate(scratch, ElementPlacement.PLACEATBEGINNING);
    t0 = tick('duplicate', t0);
    app.activeDocument = scratch;
    // Photoshop does not keep a copy's place when the document is smaller, so each copy
    // is moved from wherever it landed to its own spot in the image
    for (var k = 0; k < stack.length; k++) {
      try {
        var Lk = scratch.layers[stack.length - 1 - k], sb = boundsOf(stack[k]), db = [0, 0, 0, 0];
        try { db = boundsOf(Lk); } catch (eDb) {}
        if (sb[2] - sb[0] < 1 || db[2] - db[0] < 1) continue;
        var dx = (sb[0] - cb[0]) - db[0], dy = (sb[1] - cb[1]) - db[1];
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) Lk.translate(UnitValue(dx, 'px'), UnitValue(dy, 'px'));
      } catch (eTr) { notes.push(String(stack[k].name) + ': could not place the copy: ' + eTr); }
    }
    if (!keepLook) {
      // opacity and blend mode are set on the layer in After Effects instead
      try { var top = scratch.layers[0]; top.opacity = 100; top.blendMode = BlendMode.NORMAL; } catch (eT) {}
    }
    t0 = tick('move', t0);
    if (!imgDir.exists) imgDir.create();
    var f = new File(imgDir.fsName + '/ps-' + started + '-' + (++imageCount) + '.png');
    savePng(f);
    t0 = tick('save', t0);
    scratch.close(SaveOptions.DONOTSAVECHANGES);
    scratch = null;
    app.activeDocument = doc;
    tick('close', t0);
    var o = base(stack[0], 'Image', cb);
    o.name = name;
    if (keepLook) { o.opacity = 1; o.blend = 'NORMAL'; }
    o.type = 'shape'; o.kind = 'rect'; o.radius = 0; o.fills = []; o.stroke = null;
    o.image = { file: f.fsName, scale: 1, dx: 0, dy: 0 };
    return o;
  }

  // ---------- text ----------
  var JUST = { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', LEFTJUSTIFIED: 'JUSTIFIED', CENTERJUSTIFIED: 'JUSTIFIED', RIGHTJUSTIFIED: 'JUSTIFIED', FULLYJUSTIFIED: 'JUSTIFIED' };
  function textOf(L, d) {
    var tT = new Date().getTime();
    var ti = L.textItem;
    var o = base(L, 'Text');
    o.type = 'text';
    var text = String(ti.contents).split(F(3)).join(F(13));
    o.characters = text;
    var tk = d.getObjectValue(S('textKey'));
    // rotation and scaling of the text box
    var xx = 1, xy = 0, yx = 0, yy = 1;
    try { var tf = tk.getObjectValue(S('transform')); xx = tf.getDouble(S('xx')); xy = tf.getDouble(S('xy')); yx = tf.getDouble(S('yx')); yy = tf.getDouble(S('yy')); } catch (eTf) {}
    var sx = Math.sqrt(xx * xx + xy * xy), sy = Math.sqrt(yx * yx + yy * yy);
    var font = fontOf(ti.font);
    var size = px(ti.size) * sx;
    o.fontFamily = font.family; o.fontStyle = font.style; o.fontSize = r(size);
    o.color = rgbOf(ti.color);
    try { o.tracking = ti.tracking || 0; } catch (eTr) { o.tracking = 0; }
    o.leading = null;
    try { if (!ti.useAutoLeading) o.leading = r(px(ti.leading) * sx); } catch (eL) {}
    o.textCase = 'ORIGINAL';
    try { if (String(ti.capitalization).indexOf('ALLCAPS') !== -1) o.textCase = 'UPPER'; } catch (eCp) {}
    o.underline = false; o.strike = false;
    var just = 'LEFT';
    try { just = String(ti.justification); just = just.substring(just.lastIndexOf('.') + 1); } catch (eJ) {}
    o.align = JUST[just] || 'LEFT';
    o.vAlign = 'TOP';
    o.stroke = null;
    o.decorations = [];
    o.opacity = r(L.opacity / 100 * L.fillOpacity / 100);
    o.start = 0; o.end = text.length;
    // each run of characters with its own font, size or colour
    var segs = [];
    try {
      var ranges = tk.getList(S('textStyleRange')), ref0 = null;
      for (var i = 0; i < ranges.count; i++) {
        var rg = ranges.getObjectValue(i), st = rg.getObjectValue(S('textStyle'));
        var seg = { start: rg.getInteger(S('from')), end: rg.getInteger(S('to')), fontFamily: o.fontFamily, fontStyle: o.fontStyle, fontSize: o.fontSize,
          color: o.color, tracking: o.tracking, leading: o.leading, textCase: o.textCase, underline: false, strike: false };
        if (seg.end > text.length) seg.end = text.length;
        if (seg.end <= seg.start) continue;
        // the family and style Photoshop actually draws with, which the PostScript name alone can get wrong
        try {
          if (st.hasKey(S('fontName')) && st.hasKey(S('fontStyleName'))) { seg.fontFamily = st.getString(S('fontName')); seg.fontStyle = st.getString(S('fontStyleName')); }
          if (st.hasKey(S('fontPostScriptName'))) seg.ps = st.getString(S('fontPostScriptName'));
          if (st.hasKey(S('fontAvailable')) && !st.getBoolean(S('fontAvailable'))) missingFonts[seg.fontFamily + ' ' + seg.fontStyle] = true;
          else { var f2 = fontOf(st.getString(S('fontPostScriptName'))); seg.fontFamily = f2.family; seg.fontStyle = f2.style; }
        } catch (eF) {}
        try {
          // sizes are scaled the same way as the first run, whatever unit Photoshop reports them in
          var amSize = st.getUnitDoubleValue(S('size'));
          if (ref0 === null) ref0 = amSize;
          if (ref0) seg.fontSize = r(o.fontSize * amSize / ref0);
        } catch (eS) {}
        try { var col = amColor(st.getObjectValue(S('color'))); if (col) seg.color = col; } catch (eCo) {}
        try { if (st.hasKey(S('tracking'))) seg.tracking = st.getInteger(S('tracking')); } catch (eTk) {}
        try { if (st.hasKey(S('underline'))) seg.underline = String(typeIDToStringID(st.getEnumerationValue(S('underline')))) !== 'underlineOff'; } catch (eU) {}
        try { if (st.hasKey(S('strikethrough'))) seg.strike = String(typeIDToStringID(st.getEnumerationValue(S('strikethrough')))) !== 'strikethroughOff'; } catch (eSt) {}
        segs.push(seg);
      }
    } catch (eR) {}
    if (!segs.length) segs.push({ start: 0, end: text.length, fontFamily: o.fontFamily, fontStyle: o.fontStyle, fontSize: o.fontSize, color: o.color,
      tracking: o.tracking, leading: o.leading, textCase: o.textCase, underline: false, strike: false });
    o.segments = segs;
    o.fontFamily = segs[0].fontFamily; o.fontStyle = segs[0].fontStyle; o.fontSize = segs[0].fontSize; o.color = segs[0].color;
    if (segs[0].ps) o.ps = segs[0].ps;
    var rot = Math.atan2(xy, xx) * 180 / Math.PI;
    var kind = 'POINTTEXT';
    try { kind = String(ti.kind); kind = kind.substring(kind.lastIndexOf('.') + 1); } catch (eK) {}
    if (kind === 'PARAGRAPHTEXT') {
      var pos = ti.position;
      o.autoResize = 'HEIGHT';
      o.x = r(px(pos[0]) - OX); o.y = r(px(pos[1]) - OY);
      // the box size comes back in points, whatever the units are set to
      var pt2px = doc.resolution / 72;
      o.width = r(px(ti.width) * pt2px * sx); o.height = r(px(ti.height) * pt2px * sy);
      o.rotation = r(rot);
    } else {
      // point text sits on its first baseline at the anchor, the same as in After Effects
      var p = ti.position;
      o.autoResize = 'WIDTH_AND_HEIGHT';
      o.anchorPoint = [r(px(p[0]) - OX), r(px(p[1]) - OY)];
      o.rotation = r(rot);
      o.scaleX = 100; o.scaleY = r(100 * sy / Math.max(0.0001, sx));
    }
    tick('text', tT);
    return o;
  }

  // ---------- shapes ----------
  // a shape layer with a plain colour fill and no stroke becomes an After Effects shape
  function shapeOf(L, d) {
    var col = null;
    try { col = amColor(d.getList(S('adjustment')).getObjectValue(0).getObjectValue(S('color'))); } catch (eC) {}
    if (!col) return null;
    try { if (has(d, 'AGMStrokeStyleInfo') && d.getObjectValue(S('AGMStrokeStyleInfo')).getBoolean(S('strokeEnabled'))) return null; } catch (eS) {}
    doc.activeLayer = L;
    var path = null;
    for (var i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].kind === PathKind.VECTORMASK) { path = doc.pathItems[i]; break; }
    if (!path) return null;
    var o = base(L, 'Shape');
    o.type = 'shape'; o.kind = 'path'; o.paths = [];
    var evenodd = false;
    for (var s = 0; s < path.subPathItems.length; s++) {
      var sp = path.subPathItems[s], op = String(sp.operation);
      if (op.indexOf('INTERSECT') !== -1) return null;
      if (s > 0 && (op.indexOf('SUBTRACT') !== -1 || op.indexOf('XOR') !== -1)) evenodd = true;
      var v = [], ins = [], outs = [], pts = sp.pathPoints;
      for (var k = 0; k < pts.length; k++) {
        var pp = pts[k], a = pp.anchor, lft = pp.leftDirection, rgt = pp.rightDirection;
        var ax = px(a[0]), ay = px(a[1]);
        v.push([r(ax - OX - o.x), r(ay - OY - o.y)]);
        // Photoshop's right handle leads into the point and its left handle leads out
        ins.push([r(px(rgt[0]) - ax), r(px(rgt[1]) - ay)]);
        outs.push([r(px(lft[0]) - ax), r(px(lft[1]) - ay)]);
      }
      if (v.length) o.paths.push({ v: v, i: ins, o: outs, closed: !!sp.closed });
    }
    if (!o.paths.length) return null;
    o.rule = evenodd ? 'EVENODD' : 'NONZERO';
    o.fills = [{ type: 'solid', color: col, opacity: 1, blend: 'NORMAL' }];
    o.stroke = null;
    o.opacity = r(L.opacity / 100 * L.fillOpacity / 100);
    return o;
  }

  // ---------- layers ----------
  var ADJUST = /BRIGHTNESSCONTRAST|CHANNELMIXER|COLORBALANCE|CURVES|EXPOSURE|GRADIENTMAP|HUESATURATION|INVERSION|LEVELS|PHOTOFILTER|POSTERIZE|SELECTIVECOLOR|THRESHOLD|VIBRANCE|BLACKANDWHITE|COLORLOOKUP/;
  function convert(L) {
    var d = descOf(L);
    if (L.typename === 'LayerSet') {
      if (flag(d, 'hasUserMask') || flag(d, 'hasVectorMask') || effectsOn(d)) {
        notes.push(String(L.name) + ': group drawn as an image (mask ' + flag(d, 'hasUserMask') + ', vector mask ' + flag(d, 'hasVectorMask') + ', styles ' + effectsOn(d) + ')');
        return rasterOf([L], String(L.name), false);
      }
      var g = base(L, 'Group');
      var bm = String(L.blendMode);
      g.blend = bm.indexOf('PASSTHROUGH') !== -1 ? 'NORMAL' : blendOf(L);
      g.type = 'group'; g.isFrame = false; g.clips = false;
      g.children = walk(L);
      if (!g.children.length) return null;
      if (g.opacity < 1 || g.blend !== 'NORMAL') g.precomp = true;
      return g;
    }
    var kind = String(L.kind);
    kind = kind.substring(kind.lastIndexOf('.') + 1);
    if (ADJUST.test(kind)) { warn('Adjustment layers are left out. Their effect is not carried across.'); return null; }
    var masked = flag(d, 'hasUserMask') || effectsOn(d);
    if (kind === 'TEXT') {
      if (!masked && has(d, 'textKey')) {
        try { return textOf(L, d); } catch (eT) {}
      }
      if (masked) warn('Text with layer styles or masks comes in as an image.');
    }
    if (kind === 'SOLIDFILL' && !masked && flag(d, 'hasVectorMask')) {
      try { var sh = shapeOf(L, d); if (sh) return sh; } catch (eSh) {}
    }
    return rasterOf([L], String(L.name), false);
  }
  // a layer's children, bottom first, the order After Effects stacks them in
  function walk(container) {
    var ls = container.layers, out = [];
    for (var i = ls.length - 1; i >= 0; i--) {
      var L = ls[i];
      try { if (!L.visible) continue; } catch (eV) {}
      var clipped = false;
      try { clipped = L.typename === 'ArtLayer' && L.grouped; } catch (eG) {}
      if (clipped) continue;
      // layers clipped to this one come across with it, as one image
      var stack = [L];
      for (var j = i - 1; j >= 0; j--) {
        var up = false;
        try { up = ls[j].typename === 'ArtLayer' && ls[j].grouped; } catch (eU) {}
        if (!up) break;
        try { if (ls[j].visible) stack.push(ls[j]); } catch (eV2) {}
      }
      var c = null;
      try {
        if (stack.length > 1) { c = rasterOf(stack, String(L.name), true); warn('Clipping masks come in as one image.'); }
        else c = convert(L);
      } catch (err) {
        notes.push(String(L.name) + ': ' + err + (err.line ? ' (line ' + err.line + ')' : ''));
        try { c = rasterOf([L], String(L.name), false); } catch (err2) { warn('A few layers could not be brought in.'); }
      }
      if (c) out.push(c);
    }
    return out;
  }

  function payloadFor(name, rootId, w, h, layers) {
    return { bridge: 'figma-to-ae', version: 1, source: 'photoshop', name: name, rootId: rootId,
      width: Math.round(w), height: Math.round(h), layers: layers, warnings: [] };
  }

  var result;
  try {
    // artboards each become their own comp
    var boards = [];
    for (var a = 0; a < doc.layers.length; a++) {
      var top = doc.layers[a];
      if (top.typename !== 'LayerSet') continue;
      var td = descOf(top);
      if (!flag(td, 'artboardEnabled')) continue;
      try { if (!top.visible) continue; } catch (eVis) {}
      var rect = td.getObjectValue(S('artboard')).getObjectValue(S('artboardRect'));
      // the artboard's own background colour, which Photoshop keeps outside the layers
      var bg = [1, 1, 1, 1];
      try {
        var ab = td.getObjectValue(S('artboard'));
        var bgType = ab.hasKey(S('artboardBackgroundType')) ? ab.getInteger(S('artboardBackgroundType')) : 1;
        if (bgType === 2) bg = [0, 0, 0, 1];
        else if (bgType === 3) bg = null;
        else if (bgType === 4) { var bc = amColor(ab.getObjectValue(S('color'))); if (bc) bg = bc; }
      } catch (eBg) {}
      boards.push({ layer: top, bg: bg, x: rect.getDouble(S('left')), y: rect.getDouble(S('top')), w: rect.getDouble(S('right')) - rect.getDouble(S('left')), h: rect.getDouble(S('bottom')) - rect.getDouble(S('top')) });
    }
    var payload;
    if (boards.length) {
      // left to right, then top to bottom
      boards.sort(function (p, q) { return Math.abs(p.y - q.y) > 1 ? p.y - q.y : p.x - q.x; });
      var subs = [];
      for (var bI = 0; bI < boards.length; bI++) {
        var bd = boards[bI];
        OX = bd.x; OY = bd.y;
        var kids = walk(bd.layer);
        if (kids.length && bd.bg) kids.unshift({ name: 'Artboard background', id: 'ps:bg:' + bd.layer.id, opacity: 1, blend: 'NORMAL', x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100, skew: 0,
          width: r(bd.w), height: r(bd.h), effects: [], type: 'shape', kind: 'rect', radius: 0, fills: [{ type: 'solid', color: bd.bg, opacity: 1, blend: 'NORMAL' }], stroke: null });
        if (kids.length) { var sub = payloadFor(String(bd.layer.name), 'ps:' + DOC_PATH + ':' + bd.layer.id, bd.w, bd.h, kids); sub.origin = [bd.x, bd.y]; subs.push(sub); }
      }
      if (subs.length === 1) payload = subs[0];
      else if (subs.length) { payload = payloadFor(subs.length + ' artboards', 'ps:' + DOC_PATH, W, H, []); payload.multi = subs; }
    } else {
      var all = walk(doc);
      if (all.length) payload = payloadFor(DOC_NAME, 'ps:' + DOC_PATH, W, H, all);
    }
    if (!payload) result = 'ERR Nothing to send. Show at least one layer.';
    else {
      var mf = [];
      for (var fm in missingFonts) if (missingFonts.hasOwnProperty(fm)) mf.push(fm);
      if (mf.length) warn('Photoshop cannot load ' + mf.join(', ') + ' on this computer, so After Effects uses another font. Reinstall the font to fix it.');
      for (var w in warnings) if (warnings.hasOwnProperty(w)) payload.warnings.push(w);
      payload.stats = { seconds: (new Date().getTime() - started) / 1000, images: imageCount, notes: notes, steps: PT };
      if (payload.multi) for (var m = 0; m < payload.multi.length; m++) payload.multi[m].warnings = payload.warnings;
      var json = toJSON(payload);
      if (opts.dump) { try { var df = new File(opts.dump); df.encoding = 'UTF-8'; df.open('w'); df.write(json); df.close(); } catch (eD) {} }
      result = opts.post ? (post(json) === true ? 'OK' : 'ERR LayerBoat could not write its file.') : json;
    }
  } catch (e) {
    result = 'ERR ' + e + (e.line ? ' (line ' + e.line + ')' : '');
  } finally {
    try { if (scratch) scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (eX) {}
    try { app.activeDocument = doc; } catch (eAD) {}
    try { if (activeBefore) doc.activeLayer = activeBefore; } catch (eAL) {}
    app.preferences.rulerUnits = oldRuler;
    app.preferences.typeUnits = oldType;
    app.displayDialogs = oldDialogs;
  }
  return result;

  // Photoshop's scripting has no network, so the artwork is left in a file that
  // the LayerBoat panel in After Effects watches for
  function post(body) {
    var box = new Folder(Folder.userData.fsName + '/LayerBoat');
    if (!box.exists) box.create();
    var tmp = new File(box.fsName + '/incoming-ai.part');
    tmp.encoding = 'UTF-8';
    if (!tmp.open('w')) return false;
    tmp.write(body); tmp.close();
    var dest = new File(box.fsName + '/incoming-ai.json');
    if (dest.exists) dest.remove();
    return tmp.rename('incoming-ai.json');
  }
  // Photoshop's scripting has no JSON, so this writes it, as plain ASCII
  function toJSON(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : '0';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') {
      var BS = F(92), o = [];
      for (var i = 0; i < v.length; i++) {
        var c = v.charCodeAt(i);
        if (c === 34) o.push(BS + '"');
        else if (c === 92) o.push(BS + BS);
        else if (c >= 32 && c < 127) o.push(v.charAt(i));
        else o.push(BS + 'u' + ('0000' + c.toString(16)).slice(-4));
      }
      return '"' + o.join('') + '"';
    }
    if (v instanceof Array) { var a = []; for (var k = 0; k < v.length; k++) a.push(toJSON(v[k])); return '[' + a.join(',') + ']'; }
    var parts = [];
    for (var key in v) if (v.hasOwnProperty(key) && v[key] !== undefined && typeof v[key] !== 'function') parts.push(toJSON(key) + ':' + toJSON(v[key]));
    return '{' + parts.join(',') + '}';
  }
}
