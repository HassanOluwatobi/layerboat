// LayerBoat: core builder. Loaded by the panel and by the test runner.
var LayerBoatCore = (function () {
  var VERSION = '1.7';
  var LOG_FILE = null;
  // an error as text; some After Effects errors cannot be added to a string directly
  function errText(x) {
    try { if (x && x.message !== undefined) return String(x.message) + (x.line ? ' (line ' + x.line + ')' : ''); } catch (e1) {}
    try { return String(x); } catch (e2) { return 'unknown error'; }
  }
  function log(m) {
    try {
      if (!LOG_FILE) return;
      LOG_FILE.open('a'); LOG_FILE.writeln(new Date().toTimeString().substr(0, 8) + ' ' + m); LOG_FILE.close();
    } catch (e) {}
  }
  function setLog(path) {
    LOG_FILE = path ? new File(path) : null;
    // keep the log small
    try { if (LOG_FILE && LOG_FILE.exists && LOG_FILE.length > 1000000) LOG_FILE.remove(); } catch (e) {}
  }

  // ---------- timing ----------
  var T = {};
  function now() { return new Date().getTime(); }
  function acc(k, t0) { T[k] = (T[k] || 0) + (now() - t0); }

  // ---------- small helpers ----------
  function isCompItem(it) { return it && (it instanceof CompItem); }

  // Read the clipboard through a temp file. Piping a large clipboard straight
  // into callSystem can hang macOS, so the shell writes it to disk first.
  function readClipboard() {
    var tmp = new File(Folder.temp.fsName + '/figma-bridge-clipboard.json');
    try { if (tmp.exists) tmp.remove(); } catch (e0) {}
    var os = $.os.toLowerCase();
    if (os.indexOf('mac') !== -1) {
      system.callSystem('/bin/sh -c "pbpaste > \'' + tmp.fsName + '\'"');
    } else {
      system.callSystem('powershell -NoProfile -Command "Get-Clipboard -Raw | Out-File -Encoding utf8 \'' + tmp.fsName + '\'"');
    }
    if (!tmp.exists) return '';
    tmp.encoding = 'UTF-8';
    tmp.open('r');
    var text = tmp.read().replace(/^\uFEFF/, '');
    tmp.close();
    try { tmp.remove(); } catch (e1) {}
    return text;
  }

  function scriptsCanUseSystem() {
    try {
      return app.preferences.getPrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY') === 1;
    } catch (e) { return true; }
  }

  // After Effects' JSON.parse is written in script and takes minutes on a big design.
  // A file Illustrator left in the user's own LayerBoat folder, and data the helper
  // has checked is plain JSON, are read with eval, in about a second. Anything else
  // (the clipboard) goes through JSON.parse.
  function parseData(text, trusted) {
    if (!text) return null;
    var start = text.indexOf('{');
    if (start < 0) return null;
    text = text.substring(start);
    var data;
    try {
      if (trusted) { try { data = eval('(' + text + ')'); } catch (eE) { data = (typeof JSON !== 'undefined' && JSON.parse) ? JSON.parse(text) : null; } }
      else if (typeof JSON !== 'undefined' && JSON.parse) data = JSON.parse(text);
      else return null;
    } catch (e) { log('could not read the design: ' + errText(e)); return null; }
    if (!data || data.bridge !== 'figma-to-ae') return null;
    return data;
  }

  function rgb(c) { return [c[0], c[1], c[2]]; }

  var BLEND = {
    MULTIPLY: 'MULTIPLY', SCREEN: 'SCREEN', OVERLAY: 'OVERLAY', DARKEN: 'DARKEN', LIGHTEN: 'LIGHTEN',
    COLOR_DODGE: 'COLOR_DODGE', COLOR_BURN: 'COLOR_BURN', HARD_LIGHT: 'HARD_LIGHT', SOFT_LIGHT: 'SOFT_LIGHT',
    DIFFERENCE: 'DIFFERENCE', EXCLUSION: 'EXCLUSION', HUE: 'HUE', SATURATION: 'SATURATION',
    COLOR: 'COLOR', LUMINOSITY: 'LUMINOSITY', LINEAR_BURN: 'LINEAR_BURN', LINEAR_DODGE: 'LINEAR_DODGE'
  };

  var notes = {};
  function note(t) { notes[t] = true; }

  // ---------- transforms ----------
  // Anchor points go to the middle of each layer, so layers turn and scale about
  // their centre. Position moves to match, so nothing shifts on screen and the
  // layers parented to it stay where they are.
  var NULL_SIZE = [];
  function centreAnchors(list) {
    var t0 = now(), seen = [];
    for (var i = 0; i < list.length; i++) {
      var L = list[i];
      try {
        var dup = false;
        for (var q = 0; q < seen.length; q++) if (seen[q] === L) { dup = true; break; }
        if (dup) continue;
        seen.push(L);
        var rect = null;
        if (L.nullLayer) {
          for (var n = 0; n < NULL_SIZE.length; n++) if (NULL_SIZE[n].layer === L) rect = { left: 0, top: 0, width: NULL_SIZE[n].w, height: NULL_SIZE[n].h };
        } else rect = L.sourceRectAtTime(0, false);
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
        var tr = L.property('ADBE Transform Group');
        var ap = tr.property('ADBE Anchor Point'), pos = tr.property('ADBE Position');
        if (ap.numKeys || pos.numKeys || ap.expressionEnabled || pos.expressionEnabled || pos.dimensionsSeparated) continue;
        var A = ap.value, P = pos.value, sc = tr.property('ADBE Scale').value, rot = tr.property('ADBE Rotate Z').value * Math.PI / 180;
        var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        var dx = (cx - A[0]) * sc[0] / 100, dy = (cy - A[1]) * sc[1] / 100;
        var c = Math.cos(rot), sn = Math.sin(rot);
        ap.setValue([cx, cy, A.length > 2 ? A[2] : 0].slice(0, A.length));
        var np = [P[0] + dx * c - dy * sn, P[1] + dx * sn + dy * c];
        if (P.length > 2) np.push(P[2]);
        pos.setValue(np);
      } catch (e) {}
    }
    acc('anchors', t0);
  }

  // ---------- shapes drawn by After Effects' own Illustrator reader ----------
  // LayerBoat for Illustrator leaves a throwaway .ai file with one layer per shape,
  // named by its key. It is imported, each layer becomes a shape layer through
  // Create Shapes from Vector Layer, and the builder copies them into place.
  var NATIVE = null, NATIVE_TRASH = [], NATIVE_FILE = null;
  function prepareNative(path) {
    var t0 = now();
    NATIVE = null; NATIVE_TRASH = []; NATIVE_FILE = new File(path);
    removeOldShapeFiles(NATIVE_FILE.fsName);
    if (!NATIVE_FILE.exists) { log('native: file missing ' + path); return; }
    var io = new ImportOptions(NATIVE_FILE);
    io.importAs = ImportAsType.COMP;
    var tc = app.project.importFile(io);
    NATIVE_TRASH.push(tc);
    NATIVE = {};
    for (var i = 1; i <= tc.numLayers; i++) {
      var L = tc.layer(i);
      NATIVE[L.name] = L;
      try { if (L.source) NATIVE_TRASH.push(L.source); } catch (e0) {}
    }
    try { var fold = tc.layer(1).source.parentFolder; if (fold && fold !== app.project.rootFolder) NATIVE_TRASH.push(fold); } catch (e1) {}
    acc('native', t0);
  }
  function cleanupNative() {
    // the imported footage goes first, then its comp and folder
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < NATIVE_TRASH.length; i++) {
        var it = NATIVE_TRASH[i];
        if (!it) continue;
        var kind = it instanceof FootageItem ? 0 : (it instanceof CompItem ? 1 : 2);
        if (kind !== pass) continue;
        try { it.remove(); NATIVE_TRASH[i] = null; } catch (e) { log('native cleanup: ' + errText(e)); }
      }
    }
    NATIVE_TRASH = []; NATIVE = null;
    // the file itself stays until the next send, so nothing still reading it loses it
    try {
      if (NATIVE_FILE && NATIVE_FILE.exists && HOME && Folder(HOME + '/dev/dumps').exists) {
        var keep = new File(HOME + '/dev/dumps/native-last.ai'); if (keep.exists) keep.remove(); NATIVE_FILE.copy(keep.fsName);
      }
    } catch (e2) {}
    NATIVE_FILE = null;
  }
  // shape files from earlier sends are cleared out after a while
  function removeOldShapeFiles(current) {
    try {
      var dir = new Folder(Folder.userData.fsName + '/LayerBoat');
      var old = dir.getFiles('ai-shapes-*.ai');
      // only files from earlier sessions: a newer send may already have left the next one
      var cutoff = new Date().getTime() - 10 * 60 * 1000;
      for (var i = 0; i < old.length; i++) {
        if (old[i].fsName === current) continue;
        try { if (old[i].modified && old[i].modified.getTime() < cutoff) old[i].remove(); } catch (e) {}
      }
    } catch (e2) {}
  }
  // The vector layer is copied into the comp being built, a light step, and turned
  // into a shape layer right there by Create Shapes from Vector Layer. Moving a big
  // finished shape layer between comps is what would be slow.
  var NATIVE_CMD = 0;
  function nativeLayer(comp, d) {
    var src = NATIVE && d.native ? NATIVE[d.native] : null;
    if (!src) return null;
    var t0 = now();
    if (!NATIVE_CMD) { try { NATIVE_CMD = app.findMenuCommandId('Create Shapes from Vector Layer'); } catch (e0) {} NATIVE_CMD = NATIVE_CMD || 3973; }
    var sel = comp.selectedLayers;
    for (var s = 0; s < sel.length; s++) sel[s].selected = false;
    src.comment = 'bridge-native-copy';
    src.copyToComp(comp);
    src.comment = '';
    var V = null;
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).comment === 'bridge-native-copy') { V = comp.layer(i); break; }
    if (!V) return null;
    V.comment = '';
    if (app.project.activeItem !== comp) { comp.openInViewer(); }
    var sel2 = comp.selectedLayers;
    for (var s2 = 0; s2 < sel2.length; s2++) sel2[s2].selected = false;
    V.selected = true;
    var at = V.index, made = null;
    // the command makes its own undo step, so LayerBoat's step is closed around it
    app.endUndoGroup();
    try { app.beginSuppressDialogs(); } catch (eS) {}
    try { app.executeCommand(NATIVE_CMD); } catch (eC) {}
    try { app.endSuppressDialogs(false); } catch (eE) {}
    app.beginUndoGroup('Paste from Figma');
    var cand = at > 1 ? comp.layer(at - 1) : null;
    if (cand && cand instanceof ShapeLayer && cand.name === V.name + ' Outlines') made = cand;
    if (!made) for (var q = 1; q <= comp.numLayers; q++) { var c = comp.layer(q); if (c instanceof ShapeLayer && c.name === V.name + ' Outlines') { made = c; break; } }
    try { V.remove(); } catch (eR) {}
    if (!made) { note('Some shapes could not be drawn.'); log('native: no outlines for ' + d.native); return null; }
    made.selected = false;
    made.name = d.name;
    if (d.opacity !== undefined && d.opacity < 1) made.property('ADBE Transform Group').property('ADBE Opacity').setValue(d.opacity * 100);
    acc('nativeLayer', t0);
    return made;
  }

  function placeLayer(layer, d, anchor) {
    var t0 = now();
    try { placeInner(layer, d, anchor); } finally { acc('transform', t0); }
  }

  function placeInner(layer, d, anchor) {
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue(anchor || [0, 0]);
    tr.property('ADBE Position').setValue([d.x, d.y]);
    if (d.rotation) tr.property('ADBE Rotate Z').setValue(d.rotation);
    if (Math.abs(d.scaleX - 100) > 0.001 || Math.abs(d.scaleY - 100) > 0.001) {
      tr.property('ADBE Scale').setValue([d.scaleX, d.scaleY]);
    }
    if (d.opacity !== undefined && d.opacity < 1) tr.property('ADBE Opacity').setValue(d.opacity * 100);
    if (d.blend && BLEND[d.blend]) {
      try { layer.blendingMode = BlendingMode[BLEND[d.blend]]; } catch (e) {}
    }
  }

  // ---------- shape contents ----------
  // the shape group being filled in; combined layers hold one group per piece
  var CUR_GROUP = 1;
  function contentsOf(layer) {
    return layer.property('ADBE Root Vectors Group').property(CUR_GROUP).property('ADBE Vectors Group');
  }

  function addGeometry(layer, d, getC) {
    var t0 = now();
    getC = getC || function () { return contentsOf(layer); };
    var p;
    if (d.kind === 'rect') {
      p = getC().addProperty('ADBE Vector Shape - Rect');
      p.property('ADBE Vector Rect Size').setValue([d.width, d.height]);
      p.property('ADBE Vector Rect Position').setValue([d.width / 2, d.height / 2]);
      if (d.radius) p.property('ADBE Vector Rect Roundness').setValue(d.radius);
    } else if (d.kind === 'ellipse') {
      p = getC().addProperty('ADBE Vector Shape - Ellipse');
      p.property('ADBE Vector Ellipse Size').setValue([d.width, d.height]);
      p.property('ADBE Vector Ellipse Position').setValue([d.width / 2, d.height / 2]);
    } else if (d.paths) {
      for (var i = 0; i < d.paths.length; i++) {
        var P = d.paths[i];
        if (!P.v || !P.v.length) continue;
        addPath(getC(), P.v, P.i, P.o, !!P.closed);
      }
    }
    acc('geometry', t0);
  }

  function addPath(container, v, inT, outT, closed) {
    var p = container.addProperty('ADBE Vector Shape - Group');
    var s = new Shape();
    s.vertices = v;
    s.inTangents = inT || zeros(v.length);
    s.outTangents = outT || zeros(v.length);
    s.closed = closed;
    p.property('ADBE Vector Shape').setValue(s);
    return p;
  }

  function zeros(n) { var z = []; for (var i = 0; i < n; i++) z.push([0, 0]); return z; }

  var CAP = { NONE: 1, ROUND: 2, SQUARE: 3, ARROW_LINES: 1, ARROW_EQUILATERAL: 1 };
  var JOIN = { MITER: 1, ROUND: 2, BEVEL: 3 };

  function addStroke(layer, st) {
    var t0 = now();
    try { addStrokeInner(layer, st); } finally { acc('stroke', t0); }
  }

  function addStrokeInner(layer, st) {
    for (var i = st.paints.length - 1; i >= 0; i--) {
      var paint = st.paints[i];
      var grad = paint.type === 'linear' || paint.type === 'radial';
      var s;
      if (grad && nativeGradients) {
        s = contentsOf(layer).addProperty('ADBE Vector Graphic - G-Stroke');
        s.property('ADBE Vector Grad Type').setValue(paint.type === 'radial' ? 2 : 1);
        s.property('ADBE Vector Grad Start Pt').setValue(paint.start);
        s.property('ADBE Vector Grad End Pt').setValue(paint.end);
      } else {
        s = contentsOf(layer).addProperty('ADBE Vector Graphic - Stroke');
        s.property('ADBE Vector Stroke Color').setValue(rgb(paint.type === 'solid' ? paint.color : paint.stops[0].color));
        if (grad) note('Some gradient strokes came in as a solid colour.');
      }
      s.property('ADBE Vector Stroke Opacity').setValue(paint.opacity * 100);
      s.property('ADBE Vector Stroke Width').setValue(st.weight);
      s.property('ADBE Vector Stroke Line Cap').setValue(CAP[st.cap] || 1);
      s.property('ADBE Vector Stroke Line Join').setValue(JOIN[st.join] || 1);
      try { s.property('ADBE Vector Stroke Miter Limit').setValue(st.miter); } catch (e) {}
      if (st.dash && st.dash.length) {
        var strokeIndex = s.propertyIndex;
        for (var k = 0; k < st.dash.length && k < 6; k++) {
          var dashes = contentsOf(layer).property(strokeIndex).property('ADBE Vector Stroke Dashes');
          var isGap = k % 2 === 1;
          var n = Math.floor(k / 2) + 1;
          var dp = dashes.addProperty(isGap ? 'ADBE Vector Stroke Gap ' + n : 'ADBE Vector Stroke Dash ' + n);
          dp.setValue(st.dash[k]);
        }
      }
      if (grad && nativeGradients) setGradientColors(contentsOf(layer).property(s.propertyIndex), paint.stops);
    }
  }

  // ---------- native gradient colours ----------
  // Scripts cannot set a shape gradient's colours directly, but an animation
  // preset can. A tiny preset that targets just this gradient is written and
  // applied. The file layout follows After Effects' RIFX preset format (header
  // values taken from Google's AEUX, Apache 2.0).
  var FFX_HEAD = '00000003000000570000000100000000';
  var FFX_BESO = '00000001000000010000000000006000001800000000000400010001078004383ff00000000000003ff000000000000000000000ffffffff';
  var FFX_TDB4 = 'db99000100070000ffffffff000060003f1a36e2eb1c432d3ff00000000000003ff00000000000003ff00000000000003ff00000000000000001000800000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  function hexBytes(h) { var o = ''; for (var i = 0; i < h.length; i += 2) o += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return o; }
  function be32(n) {
    if (n < 0) n += 4294967296;
    return String.fromCharCode(Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256);
  }
  function ffxChunk(id, data) { return id + be32(data.length) + data + (data.length % 2 ? '\x00' : ''); }
  function ffxList(type, kids) { return ffxChunk('LIST', type + kids); }
  function ffxPad(s, n) { while (s.length < n) s += '\x00'; return s; }
  function ffxStep(index, matchName) { return ffxList('tdsi', ffxChunk('tdix', be32(index)) + ffxChunk('tdmn', ffxPad(matchName, 40))); }
  function ffxFloat(v) { return '<float>' + (Math.round(v * 1e8) / 1e8) + '</float>'; }
  function gradientXml(stops) {
    var a = [], c = [], i;
    for (i = 0; i < stops.length; i++) {
      var st = stops[i], col = st.color, alpha = col[3] === undefined ? 1 : col[3];
      a.push('<prop.pair>\n<key>Stop-' + i + '</key>\n<prop.list>\n<prop.pair>\n<key>Stops Alpha</key>\n<array>\n<array.type><float/></array.type>\n' +
        ffxFloat(st.pos) + '\n' + ffxFloat(0.5) + '\n' + ffxFloat(alpha) + '\n</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n');
      c.push('<prop.pair>\n<key>Stop-' + i + '</key>\n<prop.list>\n<prop.pair>\n<key>Stops Color</key>\n<array>\n<array.type><float/></array.type>\n' +
        ffxFloat(st.pos) + '\n' + ffxFloat(0.5) + '\n' + ffxFloat(col[0]) + '\n' + ffxFloat(col[1]) + '\n' + ffxFloat(col[2]) + '\n<float>1</float>\n</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n');
    }
    var size = '<prop.pair>\n<key>Stops Size</key>\n<int type=\'unsigned\' size=\'32\'>' + stops.length + '</int>\n</prop.pair>\n';
    return "<?xml version='1.0'?>\n<prop.map version='4'>\n<prop.list>\n<prop.pair>\n<key>Gradient Color Data</key>\n<prop.list>\n" +
      '<prop.pair>\n<key>Alpha Stops</key>\n<prop.list>\n<prop.pair>\n<key>Stops List</key>\n<prop.list>\n' + a.join('') + '</prop.list>\n</prop.pair>\n' + size + '</prop.list>\n</prop.pair>\n' +
      '<prop.pair>\n<key>Color Stops</key>\n<prop.list>\n<prop.pair>\n<key>Stops List</key>\n<prop.list>\n' + c.join('') + '</prop.list>\n</prop.pair>\n' + size + '</prop.list>\n</prop.pair>\n' +
      '</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Gradient Colors</key>\n<string>1.0</string>\n</prop.pair>\n</prop.list>\n</prop.map>\n';
  }
  function gradientPreset(groupIndex, itemIndex, itemMatchName, stops) {
    var path = ffxList('tdsp', ffxChunk('tdot', be32(-1)) + ffxChunk('tdpl', be32(5)) +
      ffxStep(-1, 'ADBE Root Vectors Group') + ffxStep(groupIndex, 'ADBE Vector Group') + ffxStep(-1, 'ADBE Vectors Group') +
      ffxStep(itemIndex, itemMatchName) + ffxStep(-1, 'ADBE Vector Grad Colors'));
    var sentinel = ffxList('tdsp', ffxChunk('tdot', be32(-1)) + ffxChunk('tdpl', be32(1)) + ffxStep(-1, 'ADBE End of path sentinel'));
    var gc = ffxList('GCst', ffxList('tdbs', ffxChunk('tdsb', be32(1)) + ffxChunk('tdsn', 'Colors\x00') + ffxChunk('tdb4', hexBytes(FFX_TDB4)) + ffxChunk('cdat', be32(0))) +
      ffxList('GCky', ffxChunk('Utf8', gradientXml(stops))));
    var besc = ffxList('besc', ffxChunk('beso', hexBytes(FFX_BESO)) + path + ffxChunk('tdsn', 'Colors\x00') + sentinel + gc);
    return ffxChunk('RIFX', 'FaFX' + ffxChunk('head', hexBytes(FFX_HEAD)) + besc);
  }
  var nativeGradients = true;
  var gradientQueue = [];
  // Records a gradient fill or stroke whose colours are set once the comp is
  // open, since presets only apply to layers in the open comp.
  function setGradientColors(prop, stops) {
    if (!nativeGradients) return false;
    var layer = prop.propertyGroup(prop.propertyDepth);
    gradientQueue.push({ layer: layer, groupIndex: prop.propertyGroup(2).propertyIndex - 1, itemIndex: prop.propertyIndex - 1, matchName: prop.matchName, stops: stops });
    return true;
  }
  // Scripts cannot read gradient colours back, so the stops are kept in the
  // layer's comment, under its Figma tag, for sending back to Figma.
  function propKey(prop) {
    var k = [];
    for (var d = prop.propertyDepth; d > 0; d--) { k.unshift(prop.propertyIndex); prop = prop.parentProperty; if (!prop) break; }
    return k.join('.');
  }
  function gradientStore(layer) {
    var c = ''; try { c = layer.comment || ''; } catch (e) {}
    var cut = c.indexOf('\nbridge-grad:');
    var map = {};
    if (cut >= 0) { try { map = JSON.parse(c.substring(cut + 13)); } catch (e2) { map = {}; } c = c.substring(0, cut); }
    return { head: c, map: map };
  }
  function rememberGradient(layer, prop, stops) {
    try {
      var st = gradientStore(layer);
      st.map[propKey(prop)] = stops;
      layer.comment = st.head + '\nbridge-grad:' + JSON.stringify(st.map);
    } catch (e) { log('could not keep gradient colours: ' + errText(e)); }
  }
  function applyGradientQueue() {
    if (!gradientQueue.length) return;
    var t0 = now(), lastComp = null, lastProp = null;
    var used = [];
    for (var i = 0; i < gradientQueue.length; i++) {
      var job = gradientQueue[i];
      // a file of its own for each gradient: After Effects keeps presets it has read,
      // and a file rewritten within the same second can be taken for the old one
      var f = new File(Folder.temp.fsName + '/figma-bridge-gradient-' + now() + '-' + i + '.ffx');
      used.push(f);
      try {
        var comp = job.layer.containingComp;
        if (comp !== lastComp) {
          // a preset lands in the comp that is in front, so this one is brought there
          var viewer = comp.openInViewer();
          try { if (viewer) viewer.setActive(); } catch (eV) {}
          if (app.project.activeItem !== comp) log('gradient preset: ' + comp.name + ' is not the active comp');
          lastComp = comp;
        }
        f.encoding = 'BINARY';
        f.open('w'); f.write(gradientPreset(job.groupIndex, job.itemIndex, job.matchName, job.stops)); f.close();
        // nothing else may be selected, or the preset lands there too. A
        // property's selection is cleared first, since touching it selects its layer.
        if (lastProp) { try { lastProp.selected = false; } catch (eL) {} }
        for (var k = 1; k <= comp.numLayers; k++) { try { if (comp.layer(k).selected) comp.layer(k).selected = false; } catch (eD) {} }
        // the preset lands on the selected gradient property
        var prop = job.layer.property('ADBE Root Vectors Group').property(job.groupIndex + 1).property('ADBE Vectors Group').property(job.itemIndex + 1);
        prop.selected = true;
        job.layer.selected = true;
        job.layer.applyPreset(f);
        lastProp = prop;
        rememberGradient(job.layer, prop, job.stops);
        try { prop.selected = false; } catch (e2) {}
        job.layer.selected = false;
      } catch (e) { note('Some gradient colours could not be set.'); log('gradient preset failed: ' + errText(e)); }
    }
    gradientQueue = [];
    for (var u = 0; u < used.length; u++) { try { used[u].remove(); } catch (eU) {} }
    acc('gradPreset', t0);
  }

  function addFills(layer, d) {
    var t0 = now();
    var fills = d.fills || [];
    for (var i = fills.length - 1; i >= 0; i--) {
      var f = fills[i];
      if (f.type === 'solid') {
        var fp = contentsOf(layer).addProperty('ADBE Vector Graphic - Fill');
        fp.property('ADBE Vector Fill Color').setValue(rgb(f.color));
        fp.property('ADBE Vector Fill Opacity').setValue(f.opacity * 100);
        fp.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
      } else {
        var g = contentsOf(layer).addProperty('ADBE Vector Graphic - G-Fill');
        g.property('ADBE Vector Grad Type').setValue(f.type === 'radial' ? 2 : 1);
        g.property('ADBE Vector Grad Start Pt').setValue(f.start);
        g.property('ADBE Vector Grad End Pt').setValue(f.end);
        g.property('ADBE Vector Fill Opacity').setValue(f.opacity * 100);
        try { g.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1); } catch (e0) {}
        if (!setGradientColors(g, f.stops)) {
          // fall back to the first colour so the shape is never left grey
          var gi = g.propertyIndex;
          contentsOf(layer).property(gi).remove();
          var sf = contentsOf(layer).addProperty('ADBE Vector Graphic - Fill');
          sf.property('ADBE Vector Fill Color').setValue(rgb(f.stops[0].color));
          sf.property('ADBE Vector Fill Opacity').setValue(f.opacity * 100);
          sf.moveTo(gi);
          note('Some gradients came in as a solid colour.');
        }
      }
    }
    acc('fills', t0);
  }

  // ---------- angular, diamond and elliptical radial gradients ----------
  // After Effects shapes only draw circular radial and linear gradients. These
  // three are rebuilt from Figma's gradient matrix with native, editable
  // gradient fills, then clipped to the shape by a matte layer.
  var FANCY = { angular: 1, diamond: 1, radial2: 1 };
  function hasFancy(d) {
    var f = d.fills || [];
    for (var i = 0; i < f.length; i++) if (FANCY[f[i].type]) return true;
    return false;
  }
  // m = [a, b, c, d] with p - centre = [[a, b], [c, d]] u
  function svd2(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3];
    var E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
    var Q = Math.sqrt(E * E + H * H), R = Math.sqrt(F * F + G * G);
    var a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
    // m = rot(phi) . diag(s1, s2) . rot(theta)
    return { s1: Q + R, s2: Q - R, theta: (a2 - a1) / 2, phi: (a2 + a1) / 2 };
  }
  // the same matrix as a shape group's rotation, skew and scale
  function groupTransformOf(m) {
    var th = Math.atan2(m[2], m[0]), sx = Math.sqrt(m[0] * m[0] + m[2] * m[2]) || 1e-6;
    var co = Math.cos(th), si = Math.sin(th);
    var u01 = co * m[1] + si * m[3], sy = -si * m[1] + co * m[3];
    if (Math.abs(sy) < 1e-6) sy = 1e-6;
    return { rotation: th * 180 / Math.PI, scale: [sx * 100, sy * 100], skew: Math.atan(-u01 / sy) * 180 / Math.PI };
  }
  function inv2(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-9) det = det < 0 ? -1e-9 : 1e-9;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  }
  // how far the shape reaches in the gradient's own space
  function reachIn(d, f, mi) {
    var pts = [[0, 0], [d.width, 0], [d.width, d.height], [0, d.height]], far = 0;
    for (var i = 0; i < 4; i++) {
      var px = pts[i][0] - f.center[0], py = pts[i][1] - f.center[1];
      var qx = mi[0] * px + mi[1] * py, qy = mi[2] * px + mi[3] * py;
      far = Math.max(far, Math.abs(qx), Math.abs(qy), Math.sqrt(qx * qx + qy * qy));
    }
    return far;
  }
  function gradientGroup(L, name, center, tr, rectPos, rectSize, radial, start, end, f) {
    var root = L.property('ADBE Root Vectors Group');
    var g = root.addProperty('ADBE Vector Group');
    g.name = name;
    var t = g.property('ADBE Vector Transform Group');
    t.property('ADBE Vector Position').setValue(center);
    t.property('ADBE Vector Rotation').setValue(tr.rotation);
    t.property('ADBE Vector Scale').setValue(tr.scale);
    if (Math.abs(tr.skew) > 0.001) t.property('ADBE Vector Skew').setValue(Math.max(-85, Math.min(85, tr.skew)));
    var items = g.property('ADBE Vectors Group');
    var r = items.addProperty('ADBE Vector Shape - Rect');
    r.property('ADBE Vector Rect Size').setValue(rectSize);
    r.property('ADBE Vector Rect Position').setValue(rectPos);
    var gf = items.addProperty('ADBE Vector Graphic - G-Fill');
    gf.property('ADBE Vector Grad Type').setValue(radial ? 2 : 1);
    gf.property('ADBE Vector Grad Start Pt').setValue(start);
    gf.property('ADBE Vector Grad End Pt').setValue(end);
    if (!setGradientColors(gf, f.stops)) {
      gf.remove();
      var sf = items.addProperty('ADBE Vector Graphic - Fill');
      sf.property('ADBE Vector Fill Color').setValue(rgb(f.stops[0].color));
      note('Some gradients came in as a solid colour.');
    }
  }
  // u in Figma's gradient space is drawn at 100 units per gradient unit
  var GU = 100;
  function fancyFillLayers(comp, d, f, baseName) {
    var matte = newShapeLayer(comp, d, baseName);
    var mf = contentsOf(matte).addProperty('ADBE Vector Graphic - Fill');
    mf.property('ADBE Vector Fill Color').setValue([1, 1, 1]);
    mf.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
    var stops = f.stops.length > 1 ? f.stops : [f.stops[0], { pos: 1, color: f.stops[0].color }];
    var ff = { center: f.center, m: f.m, stops: stops };
    var L;
    var label = f.type === 'angular' ? 'angular' : (f.type === 'diamond' ? 'diamond' : 'radial');
    if (f.type === 'radial2') {
      var mm = [f.m[0] / GU, f.m[1] / GU, f.m[2] / GU, f.m[3] / GU];
      var tr = groupTransformOf(mm);
      var far = reachIn(d, f, inv2(mm)) * 1.05 + 10;
      L = comp.layers.addShape();
      L.name = baseName + ' ' + label + ' gradient';
      gradientGroup(L, 'Radial', f.center, tr, [0, 0], [2 * far, 2 * far], true, [0, 0], [GU / 2, 0], ff);
      placeLayer(L, plain(d, f.opacity), [0, 0]);
    } else {
      L = precompGradientLayer(comp, d, ff, baseName, label);
      placeLayer(matte, plain(d, 1), [0, 0]);
      // the gradient sits in the shape's own space, so it follows the shape
      try { L.setParentWithJump(matte); } catch (eP) { L.parent = matte; }
      if (f.opacity < 1) L.property('ADBE Transform Group').property('ADBE Opacity').setValue(f.opacity * 100);
    }
    if (f.type === 'radial2') placeLayer(matte, plain(d, 1), [0, 0]);
    matte.moveBefore(L);
    try { L.setTrackMatte(matte, TrackMatteType.ALPHA); } catch (eM) { log('gradient matte failed: ' + errText(eM)); }
    setFillBlend(L, f.blend);
    return { layer: L, matte: matte };
  }
  // Angular and diamond gradients are drawn in a small comp of their own.
  // Figma's gradient matrix is split into a turn, a stretch and a second turn.
  // The stretch and the outer turn go on the comp's layer. Inside, a straight
  // native gradient is turned into the right pattern by built-in effects:
  // Polar Coordinates wraps it round for angular, two Mirrors fold it into
  // the four sides of a diamond. Both keep the gradient editable.
  function precompGradientLayer(comp, d, f, baseName, kind) {
    var s = svd2(f.m);
    var lam = (Math.abs(s.s1) + Math.abs(s.s2)) / 2 || 1;
    var k1 = s.s1 / lam, k2 = s.s2 / lam;
    if (Math.abs(k2) < 1e-4) k2 = k2 < 0 ? -1e-4 : 1e-4;
    // layer space q = lam . rot(theta) . u, measured from the gradient centre
    var cp = Math.cos(s.phi), sp = Math.sin(s.phi), far = 0;
    var pts = [[0, 0], [d.width, 0], [d.width, d.height], [0, d.height]];
    for (var i = 0; i < 4; i++) {
      var px = pts[i][0] - f.center[0], py = pts[i][1] - f.center[1];
      var rx = (cp * px + sp * py) / k1, ry = (-sp * px + cp * py) / k2;
      far = Math.max(far, Math.sqrt(rx * rx + ry * ry));
    }
    // angular is drawn at twice the size so its seam stays crisp
    var SS = kind === 'angular' ? 2 : 1;
    var D = Math.min(8000, Math.ceil((2 * far + 16) * SS));
    var h = D / 2, th = s.theta, thDeg = th * 180 / Math.PI;
    var pc = app.project.items.addComp(baseName + ' ' + kind + ' gradient', D, D, comp.pixelAspect, comp.duration, comp.frameRate);
    try { pc.parentFolder = precompBin(); } catch (eB) {}
    var src = pc.layers.addShape();
    src.name = 'Gradient';
    // tagged as LayerBoat's own, so updating the comp later rebuilds it instead of keeping it
    src.comment = 'figma:gradient-source';
    var str = src.property('ADBE Transform Group');
    str.property('ADBE Anchor Point').setValue([0, 0]);
    str.property('ADBE Position').setValue([0, 0]);
    var L;
    if (kind === 'angular') {
      // reversed, since Polar Coordinates wraps a straight gradient anticlockwise from the top
      gradientGroup(src, 'Angular', [0, 0], { rotation: 0, scale: [100, 100], skew: 0 }, [h, h], [D, D], false, [D, h], [0, h], f);
      L = comp.layers.add(pc);
      var fx = L.property('ADBE Effect Parade');
      var turn = thDeg - 270;
      var shift = ((-turn / 360) % 1 + 1) % 1 * D;
      var off = fx.addProperty('ADBE Offset');
      off.property(1).setValue([h + shift, h]);
      var pol = fx.addProperty('ADBE Polar Coordinates');
      pol.property(1).setValue(1);
      pol.property(2).setValue(1);
    } else {
      // one quarter of the diamond, folded across both of its axes
      var ex = (Math.cos(th) - Math.sin(th)) * 0.25 * lam * SS, ey = (Math.sin(th) + Math.cos(th)) * 0.25 * lam * SS;
      gradientGroup(src, 'Diamond', [0, 0], { rotation: 0, scale: [100, 100], skew: 0 }, [h, h], [D, D], false, [h, h], [h + ex, h + ey], f);
      L = comp.layers.add(pc);
      var fx2 = L.property('ADBE Effect Parade');
      var m1 = fx2.addProperty('ADBE Mirror');
      m1.property(1).setValue([h, h]); m1.property(2).setValue(thDeg + 180);
      var m2 = fx2.addProperty('ADBE Mirror');
      m2.property(1).setValue([h, h]); m2.property(2).setValue(thDeg + 270);
    }
    L.name = baseName + ' ' + kind + ' gradient';
    var tr = L.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([h, h]);
    tr.property('ADBE Position').setValue(f.center);
    tr.property('ADBE Rotate Z').setValue(s.phi * 180 / Math.PI);
    tr.property('ADBE Scale').setValue([k1 * 100 / SS, k2 * 100 / SS]);
    return L;
  }

  function newShapeLayer(comp, d, name, noGeometry) {
    var t0 = now();
    var layer = comp.layers.addShape();
    layer.name = name || d.name;
    var grp = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    grp.name = layer.name;
    acc('newLayer', t0);
    if (!noGeometry) addGeometry(layer, d);
    return layer;
  }

  function setFillBlend(L, blend) {
    if (blend && BLEND[blend]) { try { L.blendingMode = BlendingMode[BLEND[blend]]; } catch (e) {} }
  }
  function blendedFills(d) {
    var f = d.fills || [];
    for (var i = 0; i < f.length; i++) if (f[i].blend && f[i].blend !== 'NORMAL' && f[i].blend !== 'PASS_THROUGH') return true;
    return false;
  }
  function hasGradient(d) {
    var f = d.fills || [];
    for (var i = 0; i < f.length; i++) if (f[i].type !== 'solid') return true;
    return false;
  }

  // After Effects does not let scripts set shape-layer gradient colours, so a
  // gradient fill is drawn white and coloured by Gradient Ramp. Ramp takes two
  // colours, so a gradient with more stops becomes one layer per colour pair.
  // Each upper layer is cut to its own band with Merge Paths, and the layers
  // below show through everywhere else.
  function addRamp(layer, start, c0, end, c1, radial) {
    var t0 = now();
    var ramp = layer.property('ADBE Effect Parade').addProperty('ADBE Ramp');
    // On shape layers Gradient Ramp reads its points in comp space, so convert
    // with toComp. The expression also keeps the gradient attached when the
    // layer or its parent moves.
    ramp.property(1).setValue(start);
    ramp.property(1).expression = 'toComp([' + start[0] + ',' + start[1] + '])';
    ramp.property(2).setValue(clampColor(c0));
    ramp.property(3).setValue(end);
    ramp.property(3).expression = 'toComp([' + end[0] + ',' + end[1] + '])';
    ramp.property(4).setValue(clampColor(c1));
    ramp.property(5).setValue(radial ? 2 : 1);
    acc('ramp', t0);
  }

  function clampColor(c) {
    return [Math.max(0, Math.min(1, c[0])), Math.max(0, Math.min(1, c[1])), Math.max(0, Math.min(1, c[2]))];
  }

  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

  // returns the list of {layer, alpha} for one gradient fill
  function gradientLayers(comp, d, f, baseName) {
    var stops = f.stops;
    if (stops.length < 2) stops = [stops[0], stops[0]];
    var radial = f.type === 'radial';
    var out = [];
    var dx = f.end[0] - f.start[0], dy = f.end[1] - f.start[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    for (var k = 0; k < stops.length - 1; k++) {
      var a = stops[k], b = stops[k + 1];
      if (k > 0 && Math.abs(b.pos - a.pos) < 0.0001) continue;
      var name = baseName + (stops.length > 2 ? ' g' + (k + 1) : '');
      var L;
      if (k === 0) {
        L = newShapeLayer(comp, d, name);
      } else {
        L = newShapeLayer(comp, d, name, true);
        cutToBand(L, d, f, a.pos, ux, uy, len, radial);
      }
      var fp = contentsOf(L).addProperty('ADBE Vector Graphic - Fill');
      fp.property('ADBE Vector Fill Color').setValue([1, 1, 1]);
      if (k === 0) fp.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
      if (!radial) {
        addRamp(L, lerp(f.start, f.end, a.pos), a.color, lerp(f.start, f.end, b.pos), b.color, false);
      } else {
        // radial ramp always starts at the centre, so extend the colour pair inwards
        var span = (b.pos - a.pos) || 1;
        var c0 = [a.color[0] - (b.color[0] - a.color[0]) * a.pos / span,
                  a.color[1] - (b.color[1] - a.color[1]) * a.pos / span,
                  a.color[2] - (b.color[2] - a.color[2]) * a.pos / span];
        addRamp(L, f.start, k === 0 ? a.color : c0, lerp(f.start, f.end, b.pos), b.color, true);
      }
      var aa = alphaOf(a.color), ab = alphaOf(b.color);
      if (Math.abs(aa - ab) < 0.004) { out.push({ layer: L, alpha: (aa + ab) / 2 }); continue; }
      // Colours fade in or out: a grey ramp of the same shape, used as a luma
      // matte, carries the changing opacity.
      var M = newShapeLayer(comp, d, name + ' fade');
      makeHelper(M);
      var mf = contentsOf(M).addProperty('ADBE Vector Graphic - Fill');
      mf.property('ADBE Vector Fill Color').setValue([1, 1, 1]);
      mf.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
      if (!radial) addRamp(M, lerp(f.start, f.end, a.pos), [aa, aa, aa], lerp(f.start, f.end, b.pos), [ab, ab, ab], false);
      else {
        var sp2 = (b.pos - a.pos) || 1, a0 = k === 0 ? aa : aa - (ab - aa) * a.pos / sp2;
        addRamp(M, f.start, [a0, a0, a0], lerp(f.start, f.end, b.pos), [ab, ab, ab], true);
      }
      out.push({ layer: L, alpha: 1, fade: M });
    }
    return out;
  }

  function alphaOf(c) { return c[3] === undefined ? 1 : c[3]; }

  // shape geometry, intersected with the region past this stop
  function cutToBand(L, d, f, pos, ux, uy, len, radial) {
    var t0 = now();
    var outer = contentsOf(L);
    var sub = outer.addProperty('ADBE Vector Group');
    sub.name = 'Shape';
    var subIndex = sub.propertyIndex;
    var getSub = function () { return contentsOf(L).property(subIndex).property('ADBE Vectors Group'); };
    addGeometry(L, d, getSub);
    var count = d.kind === 'path' && d.paths ? d.paths.length : 1;
    if (count > 1) {
      var mm = getSub().addProperty('ADBE Vector Filter - Merge');
      mm.property('ADBE Vector Merge Type').setValue(d.rule === 'EVENODD' ? 5 : 2);
    }
    var big = 20000;
    var p = lerp(f.start, f.end, pos);
    if (!radial) {
      var nx = -uy, ny = ux;
      addPath(contentsOf(L), [
        [p[0] + nx * big, p[1] + ny * big],
        [p[0] - nx * big, p[1] - ny * big],
        [p[0] - nx * big + ux * big, p[1] - ny * big + uy * big],
        [p[0] + nx * big + ux * big, p[1] + ny * big + uy * big]
      ], null, null, true);
      contentsOf(L).addProperty('ADBE Vector Filter - Merge').property('ADBE Vector Merge Type').setValue(4);
    } else {
      var rad = pos * len;
      var el = contentsOf(L).addProperty('ADBE Vector Shape - Ellipse');
      el.property('ADBE Vector Ellipse Size').setValue([rad * 2, rad * 2]);
      el.property('ADBE Vector Ellipse Position').setValue(f.start);
      contentsOf(L).addProperty('ADBE Vector Filter - Merge').property('ADBE Vector Merge Type').setValue(3);
    }
    acc('gradientCut', t0);
  }

  function simpleStroke(st) {
    return st && !st.sides && (st.align === 'CENTER' || !st.align) && st.paints.length && (nativeGradients || st.paints[0].type === 'solid');
  }

  function isClosed(d) {
    if (d.kind === 'rect' || d.kind === 'ellipse') return true;
    if (!d.paths) return false;
    for (var i = 0; i < d.paths.length; i++) if (!d.paths[i].closed) return false;
    return true;
  }

  function hasEffect(effects, type) {
    for (var i = 0; effects && i < effects.length; i++) if (effects[i].type === type) return true;
    return false;
  }

  function withoutBgBlur(effects) {
    var out = [];
    for (var i = 0; effects && i < effects.length; i++) if (effects[i].type !== 'bgBlur') out.push(effects[i]);
    return out;
  }

  // Builds one Figma shape and returns its layers, bottom to top. A shape that
  // needs several layers (gradients, aligned strokes, images) and also has
  // shadows, opacity or a blend mode is precomposed, so those apply to the
  // shape as a whole, the way Figma does it.
  function buildShape(comp, d) {
    var before = [];
    if (hasEffect(d.effects, 'bgBlur')) before = buildBackgroundBlur(comp, d);
    var parts = [];
    if (d.image) { var img = buildImage(comp, d, d.image); if (img) parts.push(img); }
    var fills = d.fills || [];
    var gradOK = nativeGradients || !hasGradient(d);
    var fancy = hasFancy(d);
    var combined = !fancy && gradOK && !blendedFills(d) && (!d.stroke || simpleStroke(d.stroke)) && (fills.length || d.stroke);
    // an inside or outside stroke: one layer with a stroke group above a fill group
    var twoGroups = !combined && !fancy && gradOK && !blendedFills(d) && d.stroke && !d.stroke.sides && isClosed(d) &&
      (nativeGradients || d.stroke.paints[0].type === 'solid');
    if (combined) {
      var one = newShapeLayer(comp, d);
      if (d.stroke) addStroke(one, d.stroke);
      addFills(one, d);
      placeLayer(one, plain(d, 1), [0, 0]);
      parts.push(one);
    } else if (twoGroups) {
      var two = newShapeLayer(comp, d, d.name, true);
      var root = two.property('ADBE Root Vectors Group');
      root.property(1).name = 'Stroke';
      addGeometry(two, d);
      var st = d.stroke;
      if (st.align && st.align !== 'CENTER') {
        var off = contentsOf(two).addProperty('ADBE Vector Filter - Offset');
        off.property('ADBE Vector Offset Amount').setValue((st.align === 'OUTSIDE' ? 1 : -1) * st.weight / 2);
        try { off.property('ADBE Vector Offset Line Join').setValue(JOIN[st.join] || 1); } catch (eJ) {}
        try { off.property('ADBE Vector Offset Miter Limit').setValue(st.miter || 4); } catch (eM) {}
      }
      addStroke(two, st);
      if (fills.length) {
        var fg = root.addProperty('ADBE Vector Group');
        fg.name = 'Fill';
        CUR_GROUP = fg.propertyIndex;
        try { addGeometry(two, d); addFills(two, d); } finally { CUR_GROUP = 1; }
      }
      placeLayer(two, plain(d, 1), [0, 0]);
      parts.push(two);
    } else {
      for (var i = 0; i < fills.length; i++) {
        var f = fills[i];
        var baseName = d.name + (fills.length > 1 ? ' fill ' + (i + 1) : '');
        var made;
        if (FANCY[f.type]) {
          var fm = fancyFillLayers(comp, d, f, baseName);
          parts.push(fm.matte);
          parts.push(fm.layer);
          continue;
        }
        if (f.type === 'solid') {
          var L = newShapeLayer(comp, d, baseName);
          var fp = contentsOf(L).addProperty('ADBE Vector Graphic - Fill');
          fp.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
          fp.property('ADBE Vector Fill Color').setValue(rgb(f.color));
          made = [{ layer: L, alpha: 1 }];
        } else {
          made = gradientLayers(comp, d, f, baseName);
        }
        for (var m = 0; m < made.length; m++) {
          placeLayer(made[m].layer, plain(d, f.opacity * made[m].alpha), [0, 0]);
          setFillBlend(made[m].layer, f.blend);
          if (made[m].fade) {
            placeLayer(made[m].fade, plain(d, 1), [0, 0]);
            made[m].fade.moveBefore(made[m].layer);
            try { made[m].layer.setTrackMatte(made[m].fade, TrackMatteType.LUMA); } catch (eM) { log('fade matte failed: ' + errText(eM)); }
            parts.push(made[m].fade);
          }
          parts.push(made[m].layer);
        }
      }
      if (d.stroke) parts.push(buildStrokeLayer(comp, d));
    }
    if (d.strokeImage) { var si = buildImage(comp, d, d.strokeImage); if (si) parts.push(si); }
    if (d.strokeOutline) {
      // a stroke with arrowheads, as the filled outline Figma draws
      var od = {}; for (var dk in d) if (d.hasOwnProperty(dk)) od[dk] = d[dk];
      od.kind = 'path'; od.paths = d.strokeOutline.paths; od.rule = d.strokeOutline.rule; od.stroke = null;
      var oL = newShapeLayer(comp, od, d.name + (parts.length ? ' stroke' : ''));
      var ofp = contentsOf(oL).addProperty('ADBE Vector Graphic - Fill');
      ofp.property('ADBE Vector Fill Color').setValue(rgb(d.strokeOutline.color));
      ofp.property('ADBE Vector Fill Opacity').setValue((d.strokeOutline.opacity === undefined ? 1 : d.strokeOutline.opacity) * 100);
      ofp.property('ADBE Vector Fill Rule').setValue(d.strokeOutline.rule === 'EVENODD' ? 2 : 1);
      placeLayer(oL, plain(d, 1), [0, 0]);
      parts.push(oL);
    }
    if (!parts.length) return before;
    if (d.skew) for (var sk = 0; sk < parts.length; sk++) applySkew(parts[sk], d.skew);

    var effects = withoutBgBlur(d.effects);
    var opacity = d.opacity === undefined ? 1 : d.opacity;
    var blend = d.blend && BLEND[d.blend];
    if (parts.length === 1) {
      scaleOpacity(parts[0], opacity);
      return before.concat([finishLayer(parts[0], d, effects)]);
    }
    if (effects.length || opacity < 1 || blend) {
      var top = precomposeLayers(comp, parts, d.name);
      scaleOpacity(top, opacity);
      return before.concat([finishLayer(top, d, effects)]);
    }
    return before.concat(parts);
  }

  // Layers cannot skew in After Effects, but shape groups can. A skew left
  // over from Figma's transform goes on each group, inside the layer's own
  // rotation and scale, which is the order Figma applies them in.
  function applySkew(L, skew) {
    try {
      var root = L.property('ADBE Root Vectors Group');
      if (!root) { note('Skew is kept on shapes only.'); return; }
      for (var i = 1; i <= root.numProperties; i++) {
        var g = root.property(i);
        if (g.matchName === 'ADBE Vector Group') g.property('ADBE Vector Transform Group').property('ADBE Vector Skew').setValue(-skew);
      }
    } catch (e) { note('Skew is kept on shapes only.'); }
  }

  function scaleOpacity(L, k) {
    if (k >= 1) return;
    var op = L.property('ADBE Transform Group').property('ADBE Opacity');
    op.setValue(op.value * k);
  }

  function plain(d, opacity) {
    return { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY, opacity: opacity, blend: null };
  }

  var GENERIC_NAME = /^(Vector|Rectangle|Ellipse|Line|Polygon|Star|Union|Subtract|Intersect|Exclude|Group|Frame|Container|Shape|Path|Icon)( \d+)?$/i;

  function combinedPieces(d, out) {
    var kids = d.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].type === 'group') combinedPieces(kids[i], out);
      else if (kids[i].type === 'shape') out.push(kids[i]);
    }
    return out;
  }
  function buildCombined(comp, d) {
    var t0 = now();
    var L = comp.layers.addShape();
    L.name = d.name;
    var root = L.property('ADBE Root Vectors Group');
    var pieces = combinedPieces(d, []);
    // in a shape layer the first group draws on top, so add from the top down
    for (var i = pieces.length - 1; i >= 0; i--) {
      var it = pieces[i], mx = it.mx || { x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100 };
      var grp = root.addProperty('ADBE Vector Group');
      grp.name = it.name;
      CUR_GROUP = grp.propertyIndex;
      try {
        addGeometry(L, it);
        if (it.stroke) addStroke(L, it.stroke);
        addFills(L, it);
        var tg = root.property(CUR_GROUP).property('ADBE Vector Transform Group');
        tg.property('ADBE Vector Position').setValue([mx.x, mx.y]);
        if (mx.rotation) tg.property('ADBE Vector Rotation').setValue(mx.rotation);
        if (Math.abs(mx.scaleX - 100) > 0.001 || Math.abs(mx.scaleY - 100) > 0.001) tg.property('ADBE Vector Scale').setValue([mx.scaleX, mx.scaleY]);
        if (it.opacity !== undefined && it.opacity < 1) tg.property('ADBE Vector Group Opacity').setValue(it.opacity * 100);
        if (mx.skew) tg.property('ADBE Vector Skew').setValue(-mx.skew);
      } finally { CUR_GROUP = 1; }
    }
    placeLayer(L, { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY, opacity: d.opacity, blend: d.blend }, [0, 0]);
    addEffects(L, withoutBgBlur(d.effects));
    acc('combined', t0);
    return L;
  }

  function finishLayer(L, d, effects) {
    if (d.blend && BLEND[d.blend]) { try { L.blendingMode = BlendingMode[BLEND[d.blend]]; } catch (e) {} }
    addEffects(L, effects);
    return L;
  }

  // Precompose layers that sit in root coordinates. The precomp is the same
  // size as the comp, so nothing moves.
  function precomposeLayers(comp, layers, name) {
    var t0 = now();
    var idx = [];
    for (var i = 0; i < layers.length; i++) idx.push(layers[i].index);
    idx.sort(function (a, b) { return a - b; });
    var pc = comp.layers.precompose(idx, name, true);
    pc.parentFolder = precompBin();
    try { pc.comment = ''; } catch (eC) {} // precompose copies the comp's Figma tag
    var L = comp.layer(idx[0]);
    L.name = name;
    acc('precomp', t0);
    return L;
  }

  var _precompBin = null;
  function precompBin() {
    try { if (_precompBin && _precompBin.name) return _precompBin; } catch (e) {}
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof FolderItem && it.name === 'Figma Precomps') return (_precompBin = it);
    }
    return (_precompBin = app.project.items.addFolder('Figma Precomps'));
  }

  // ---------- strokes ----------
  function strokeColor(st) {
    var p = st.paints[0];
    return { color: p.type === 'solid' ? p.color : p.stops[0].color, opacity: p.opacity };
  }

  function buildStrokeLayer(comp, d) {
    var st = d.stroke;
    var L = newShapeLayer(comp, d, d.name + ' stroke', true);
    if (st.sides && d.kind !== 'ellipse') {
      // a border with a different width per side, drawn as one bar per side
      var w = d.width, h = d.height, s = st.sides;
      var k = st.align === 'INSIDE' ? 0 : (st.align === 'OUTSIDE' ? 1 : 0.5);
      var bars = [];
      if (s.top) bars.push([-s.left * k, -s.top * k, w + s.right * k, s.top * (1 - k)]);
      if (s.bottom) bars.push([-s.left * k, h - s.bottom * (1 - k), w + s.right * k, h + s.bottom * k]);
      if (s.left) bars.push([-s.left * k, -s.top * k, s.left * (1 - k), h + s.bottom * k]);
      if (s.right) bars.push([w - s.right * (1 - k), -s.top * k, w + s.right * k, h + s.bottom * k]);
      for (var i = 0; i < bars.length; i++) {
        var b = bars[i];
        addPath(contentsOf(L), [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], null, null, true);
      }
      if (bars.length > 1) contentsOf(L).addProperty('ADBE Vector Filter - Merge').property('ADBE Vector Merge Type').setValue(2);
      var sc = strokeColor(st);
      var fp = contentsOf(L).addProperty('ADBE Vector Graphic - Fill');
      fp.property('ADBE Vector Fill Color').setValue(rgb(sc.color));
      fp.property('ADBE Vector Fill Opacity').setValue(sc.opacity * 100);
    } else {
      addGeometry(L, d);
      if (st.align && st.align !== 'CENTER' && isClosed(d)) {
        // inside and outside strokes: move the outline by half the width
        var off = contentsOf(L).addProperty('ADBE Vector Filter - Offset');
        off.property('ADBE Vector Offset Amount').setValue((st.align === 'OUTSIDE' ? 1 : -1) * st.weight / 2);
        try { off.property('ADBE Vector Offset Line Join').setValue(JOIN[st.join] || 1); } catch (e) {}
        try { off.property('ADBE Vector Offset Miter Limit').setValue(st.miter || 4); } catch (e2) {}
      }
      addStroke(L, st);
    }
    placeLayer(L, plain(d, 1), [0, 0]);
    return L;
  }

  // ---------- background blur ----------
  // An adjustment layer with Gaussian Blur, cut to the shape by a track
  // matte, blurs whatever sits behind the shape.
  function buildBackgroundBlur(comp, d) {
    var radius = 0;
    for (var i = 0; i < d.effects.length; i++) if (d.effects[i].type === 'bgBlur') radius = d.effects[i].radius;
    var m = buildMask(comp, d);
    m.name = d.name + ' (blur area)';
    // Figma blurs only what sits inside the shape's bounds, repeating the edge
    // pixels. An adjustment layer the size of the shape does the same.
    var adj, sw = Math.round(d.width * Math.abs((d.scaleX || 100) / 100)), sh = Math.round(d.height * Math.abs((d.scaleY || 100) / 100));
    if (!d.rotation && sw >= 1 && sh >= 1) {
      adj = comp.layers.addSolid([1, 1, 1], d.name + ' background blur', sw, sh, 1);
      adj.property('ADBE Transform Group').property('ADBE Position').setValue([d.x + (d.scaleX < 0 ? -sw : sw) / 2, d.y + (d.scaleY < 0 ? -sh : sh) / 2]);
    } else adj = comp.layers.addSolid([1, 1, 1], d.name + ' background blur', comp.width, comp.height, 1);
    adj.adjustmentLayer = true;
    makeHelper(adj);
    adj.label = 0;
    var fx = adj.property('ADBE Effect Parade').addProperty(BLUR_EFFECT);
    fx.property(1).setValue(blurAmount(radius));
    try { fx.property(3).setValue(1); } catch (e) {}
    adj.moveAfter(m);
    try { adj.setTrackMatte(m, TrackMatteType.ALPHA); } catch (e2) { note('A background blur could not be masked.'); }
    return [adj, m];
  }

  // Figma blurs in sRGB, like Fast Blur. Gaussian Blur blurs in linear light,
  // which turns red next to blue pink. Measured against Figma renders, a
  // Figma radius equals the same Fast Blur blurriness.
  var BLUR_EFFECT = 'ADBE Fast Blur';
  function blurAmount(radius) { return radius; }
  // Figma shadow radius to Drop Shadow softness, measured against Figma renders
  function shadowSoftness(radius) { return radius * 1.7; }

  function blurOnly(effects) {
    var out = [];
    for (var i = 0; effects && i < effects.length; i++) if (effects[i].type === 'blur') out.push(effects[i]);
    return out;
  }

  var lumaMattes = [];
  // Text that a Figma component property controls goes into the comp's
  // Essential Graphics, named after the property, so it can be edited there.
  var egpQueue = [];
  function applyEgpQueue(mainComp) {
    var seen = {};
    for (var i = 0; i < egpQueue.length; i++) {
      var q = egpQueue[i];
      if (!q.layer) continue;
      var key = q.name, n = 2;
      while (seen[key]) key = q.name + ' ' + (n++);
      seen[key] = true;
      try {
        var target = q.comp;
        q.layer.property('ADBE Text Properties').property('ADBE Text Document').addToMotionGraphicsTemplateAs(target, key);
      } catch (e) { log('essential graphics failed: ' + errText(e)); }
    }
    egpQueue = [];
  }
  function buildMask(comp, d) {
    if (d.luma) {
      // drawn as designed; its brightness decides what shows through
      var parts = buildShape(comp, d);
      var Lm = parts.length > 1 ? precomposeLayers(comp, parts, d.name + ' (mask)') : parts[0];
      if (Lm) {
        Lm.name = d.name + ' (mask)';
        Lm.enabled = false;
        Lm.label = 0;
        makeHelper(Lm);
        lumaMattes.push(Lm);
        return Lm;
      }
    }
    var layer = newShapeLayer(comp, d, d.name + ' (mask)');
    var fp = contentsOf(layer).addProperty('ADBE Vector Graphic - Fill');
    fp.property('ADBE Vector Fill Color').setValue([1, 1, 1]);
    fp.property('ADBE Vector Fill Rule').setValue(d.rule === 'EVENODD' ? 2 : 1);
    placeLayer(layer, { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY }, [0, 0]);
    layer.enabled = false;
    layer.label = 0;
    makeHelper(layer);
    return layer;
  }

  // Clips, fades and blur areas are working parts, not artwork. They are made
  // shy, and the comp hides shy layers, so the timeline shows only the design.
  var helperComps = [];
  function makeHelper(L) {
    try { L.shy = true; } catch (e) {}
    try { var c = L.containingComp; for (var i = 0; i < helperComps.length; i++) if (helperComps[i] === c) return; helperComps.push(c); } catch (e2) {}
  }
  function hideHelpers() {
    for (var i = 0; i < helperComps.length; i++) { try { helperComps[i].hideShyLayers = true; } catch (e) {} }
    helperComps = [];
  }

  // ---------- images ----------
  // Figma image fills arrive as 2x PNGs in base64. They are saved next to the
  // project (or in Application Support when the project is unsaved), imported
  // once, and reused when the same image appears again.
  var imageCache = {};

  function assetFolder() {
    var f;
    if (app.project.file) f = new Folder(app.project.file.parent.fsName + '/Figma Assets');
    else f = new Folder(Folder.userData.fsName + '/LayerBoat Assets');
    if (!f.exists) f.create();
    return f;
  }

  function hashString(str) {
    var h1 = 5381, h2 = 52711, step = Math.max(1, Math.floor(str.length / 4000));
    for (var i = 0; i < str.length; i += step) {
      var c = str.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) | 0;
      h2 = ((h2 << 5) + h2 + c) | 0;
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + str.length.toString(16);
  }

  function writePng(b64) {
    var folder = assetFolder();
    var name = 'figma-' + hashString(b64) + '.png';
    var png = new File(folder.fsName + '/' + name);
    if (png.exists) return png;
    var tmp = new File(Folder.temp.fsName + '/figma-bridge-image.b64');
    tmp.encoding = 'BINARY';
    tmp.open('w'); tmp.write(b64); tmp.close();
    if ($.os.toLowerCase().indexOf('mac') !== -1) {
      system.callSystem('/usr/bin/base64 -D -i "' + tmp.fsName + '" -o "' + png.fsName + '"');
    } else {
      // decoded here on Windows, so no console window flashes up
      png.encoding = 'BINARY';
      png.open('w'); png.write(fromBase64(b64)); png.close();
    }
    try { tmp.remove(); } catch (e) {}
    return png;
  }

  function imageFootage(b64) {
    var key = hashString(b64);
    var cached = imageCache[key];
    try { if (cached && cached.name) return cached; } catch (e0) {}
    var file = writePng(b64);
    if (!file.exists) return null;
    var item = app.project.importFile(new ImportOptions(file));
    item.parentFolder = imagesBin();
    imageCache[key] = item;
    return item;
  }

  // an image another app left on disk is moved next to the project's other images
  function fileFootage(path) {
    var cached = imageCache['file:' + path];
    try { if (cached && cached.name) return cached; } catch (e0) {}
    var src = new File(path);
    if (!src.exists) return null;
    var dest = new File(assetFolder().fsName + '/' + src.name);
    if (!dest.exists) { src.copy(dest.fsName); }
    try { src.remove(); } catch (e1) {}
    if (!dest.exists) return null;
    var item = app.project.importFile(new ImportOptions(dest));
    item.parentFolder = imagesBin();
    imageCache['file:' + path] = item;
    return item;
  }

  function imagesBin() {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof FolderItem && it.name === 'Figma Images') return it;
    }
    return app.project.items.addFolder('Figma Images');
  }

  function buildImage(comp, d, src) {
    var t0 = now();
    var item = src.file ? fileFootage(src.file) : imageFootage(src.png);
    acc('images', t0);
    if (!item) { note('Some images could not be imported.'); return null; }
    var L = comp.layers.add(item);
    // a layer that is only an image keeps its own name
    var onlyImage = src === d.image && !(d.fills && d.fills.length) && !d.stroke;
    L.name = onlyImage ? d.name : d.name + (src === d.strokeImage ? ' stroke' : ' image');
    var sc = src.scale || 1;
    // the PNG's top-left sits at (dx, dy) in the layer's own space
    placeLayer(L, { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX / sc, scaleY: d.scaleY / sc, opacity: 1, blend: null },
      [-(src.dx || 0) * sc, -(src.dy || 0) * sc]);
    if (src === d.image) setFillBlend(L, d.imageBlend);
    return L;
  }

  // ---------- text ----------
  var fontMemo = {};
  function fontPostScriptName(family, style) {
    var key = family + '|' + style;
    if (fontMemo.hasOwnProperty(key)) return fontMemo[key];
    var t0 = now();
    fontMemo[key] = lookupFont(family, style);
    acc('txt:font', t0);
    return fontMemo[key];
  }
  function lookupFont(family, style) {
    try {
      if (app.fonts && app.fonts.getFontsByFamilyNameAndStyleName) {
        var found = app.fonts.getFontsByFamilyNameAndStyleName(family, style);
        if (found && found.length) return found[0].postScriptName;
      }
    } catch (e) {}
    return family.replace(/\s+/g, '') + '-' + style.replace(/\s+/g, '');
  }

  // Characters the font does not have (the naira sign, keyboard symbols and
  // so on) are drawn by Figma with a system font. After Effects draws nothing.
  // Each such character is tested once per font in a scratch comp, and a font
  // that has it is picked, keeping the weight where it can.
  var glyphComp = null, glyphLayer = null, glyphCache = {}, styleCache = {};
  var FALLBACK_FAMILIES = ['SF Pro Text', 'SF Pro', 'Helvetica Neue', 'Arial Unicode MS', 'Lucida Grande', 'Apple Symbols', 'Menlo'];
  function ensureGlyphComp() {
    if (!glyphComp) {
      glyphComp = app.project.items.addComp('LayerBoat glyph test', 400, 400, 1, 1, 30);
      glyphLayer = glyphComp.layers.addText('x');
    }
  }
  function hasGlyph(psName, ch) {
    var key = psName + '|' + ch;
    if (glyphCache.hasOwnProperty(key)) return glyphCache[key];
    var ok = true;
    try {
      ensureGlyphComp();
      var prop = glyphLayer.property('ADBE Text Properties').property('ADBE Text Document');
      var td = prop.value;
      td.text = ch; td.font = psName; td.fontSize = 100;
      prop.setValue(td);
      ok = prop.value.font === psName && glyphLayer.sourceRectAtTime(0, false).width > 0.5;
    } catch (e) { ok = true; }
    glyphCache[key] = ok;
    return ok;
  }
  function styleOf(psName) {
    if (styleCache.hasOwnProperty(psName)) return styleCache[psName];
    var st = 'Regular';
    try { var f = app.fonts.getFontsByPostScriptName(psName); if (f && f.length) st = f[0].styleName; } catch (e) {}
    styleCache[psName] = st;
    return st;
  }
  function fallbackFont(psName, ch) {
    var style = styleOf(psName), styles = [style];
    if (/semi|demi|medium/i.test(style)) styles.push('Medium', 'Semibold', 'Bold');
    else if (/bold|black|heavy/i.test(style)) styles.push('Bold', 'Semibold');
    styles.push('Regular');
    for (var f = 0; f < FALLBACK_FAMILIES.length; f++) {
      for (var s = 0; s < styles.length; s++) {
        var cand = null;
        try { var found = app.fonts.getFontsByFamilyNameAndStyleName(FALLBACK_FAMILIES[f], styles[s]); if (found && found.length) cand = found[0].postScriptName; } catch (e) {}
        if (cand && hasGlyph(cand, ch)) return cand;
      }
    }
    return null;
  }
  function glyphTestSet(text, psName, size) {
    ensureGlyphComp();
    var prop = glyphLayer.property('ADBE Text Properties').property('ADBE Text Document');
    var td = prop.value;
    td.text = text; td.font = psName; td.fontSize = size; td.tracking = 0;
    prop.setValue(td);
    return glyphLayer.sourceRectAtTime(0, false).width;
  }
  // advance width of ch in a font, from the ink width of x?x minus xx
  var advanceCache = {};
  function aeAdvance(psName, size, ch) {
    var key = psName + '|' + size + '|' + ch;
    if (advanceCache.hasOwnProperty(key)) return advanceCache[key];
    var w = null;
    try { hasGlyph(psName, ch); w = glyphTestSet('x' + ch + 'x', psName, size) - glyphTestSet('xx', psName, size); } catch (e) {}
    advanceCache[key] = w;
    return w;
  }
  // Figma's family, style and size for character i of the built text
  function figmaStyleAt(d, i) {
    var segs = (d.layout && d.align !== 'JUSTIFIED') ? d.layout.segments : d.segments;
    if (segs) for (var k = 0; k < segs.length; k++) if (i >= segs[k].start && i < segs[k].end) return segs[k];
    return d;
  }
  function glyphFallback(prop, d) {
    var td = prop.value, text = td.text;
    if (typeof td.characterRange !== 'function') return;
    // single lines are fitted to Figma's ink afterwards, so their spaces need no fix
    var fixSpaces = !!(d.glyphWidths && text.indexOf(' ') >= 0 && !(d.layout && d.layout.lines === 1 && d.layout.inkX));
    if (!/[^\x00-\x7f]/.test(text) && !fixSpaces) return;
    var changed = false;
    try {
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === ' ') {
          if (!fixSpaces) continue;
          // match Figma's space width
          var sst = figmaStyleAt(d, i), skey = sst.fontFamily + '|' + sst.fontStyle + '|' + sst.fontSize + '| ';
          var swant = d.glyphWidths && d.glyphWidths[skey];
          if (!swant) continue;
          var scr = td.characterRange(i, i + 1), shave = aeAdvance(scr.font, sst.fontSize, ' ');
          if (shave === null || Math.abs(swant - shave) < 0.05) continue;
          scr.tracking = Math.round((sst.tracking || 0) + (swant - shave) / sst.fontSize * 1000);
          (d._charTracking = d._charTracking || {})[i] = { tracking: scr.tracking, size: sst.fontSize };
          changed = true;
          continue;
        }
        if (ch.charCodeAt(0) < 128 || /\s/.test(ch)) continue;
        var cr = td.characterRange(i, i + 1), ps = cr.font;
        if (hasGlyph(ps, ch)) continue;
        var fb = fallbackFont(ps, ch);
        if (!fb) continue;
        cr.font = fb; changed = true;
        // keep the following characters where Figma has them
        var st = figmaStyleAt(d, i), key = st.fontFamily + '|' + st.fontStyle + '|' + st.fontSize + '|' + ch;
        var want = d.glyphWidths && d.glyphWidths[key], have = aeAdvance(fb, st.fontSize, ch);
        if (want && have !== null) {
          cr.tracking = Math.round((st.tracking || 0) + (want - have) / st.fontSize * 1000);
          (d._charTracking = d._charTracking || {})[i] = { tracking: cr.tracking, size: st.fontSize };
        }
      }
      if (changed) prop.setValue(td);
    } catch (e2) { log('glyph fallback failed: ' + errText(e2)); }
  }
  function removeGlyphComp() {
    if (glyphComp) { try { glyphComp.remove(); } catch (e) {} }
    glyphComp = null; glyphLayer = null;
  }

  // Per-run styling needs After Effects 2024.3 or later (characterRange).
  function applyRuns(prop, segments, leading) {
    var td = prop.value;
    if (typeof td.characterRange !== 'function') { note('Text with mixed styles needs After Effects 2024.3 or newer.'); return; }
    try {
      var text = td.text;
      for (var i = 0; i < segments.length; i++) {
        var g = segments[i];
        var end = Math.min(g.end, text.length);
        if (end <= g.start) continue;
        var cr = td.characterRange(g.start, end);
        cr.font = fontPostScriptName(g.fontFamily, g.fontStyle);
        cr.fontSize = g.fontSize;
        cr.fillColor = rgb(g.color);
        cr.tracking = Math.round(g.tracking || 0);
        if (leading) { try { cr.autoLeading = false; cr.leading = leading; } catch (e1) {} }
        if (g.textCase === 'UPPER') { try { cr.allCaps = true; } catch (e2) {} }
        if (g.underline) { try { cr.underline = true; } catch (e3) {} }
        if (g.strike) { try { cr.strikethrough = true; } catch (e4) {} }
      }
      prop.setValue(td);
    } catch (e) { note('Some mixed text styles could not be applied.'); log('runs failed: ' + errText(e)); }
  }

  var JUST = { LEFT: 'LEFT_JUSTIFY', CENTER: 'CENTER_JUSTIFY', RIGHT: 'RIGHT_JUSTIFY', JUSTIFIED: 'FULL_JUSTIFY_LASTLINE_LEFT' };

  function firstLineEnd(t) {
    var i = t.search(/\r|\n/);
    return i < 0 ? t.length : i;
  }

  // Adding text layers gets slow in a busy project. Duplicating a plain text
  // layer is quicker, so one hidden template is made per comp and copied.
  var textTemplates = [];
  function newPointText(comp, text) {
    var tpl = null;
    for (var i = 0; i < textTemplates.length; i++) if (textTemplates[i].comp === comp) tpl = textTemplates[i].layer;
    if (!tpl) {
      tpl = comp.layers.addText(text);
      textTemplates.push({ comp: comp, layer: tpl });
      tpl = tpl.duplicate();
      tpl.moveToBeginning();
      return tpl;
    }
    var L = tpl.duplicate();
    L.moveToBeginning();
    return L;
  }
  var styledTemplates = [];
  // Styled text layers are also kept in a small comp in the Figma Precomps
  // bin, so later sends (and updates) reuse styles instead of setting them.
  function styleStore(create) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.comment === 'figma-bridge:styles') return it;
    }
    if (!create) return null;
    var c = app.project.items.addComp('LayerBoat text styles', 100, 100, 1, 1, 30);
    c.comment = 'figma-bridge:styles';
    try { c.parentFolder = precompBin(); } catch (e) {}
    return c;
  }
  function styledTemplate(comp, key) {
    for (var i = 0; i < styledTemplates.length; i++) if (styledTemplates[i].comp === comp && styledTemplates[i].key === key) return styledTemplates[i].layer;
    var store = styleStore(false);
    if (store && store !== comp) {
      for (var j = 1; j <= store.numLayers; j++) {
        if (store.layer(j).comment === key) {
          // a style saved while its font was missing is dropped rather than reused
          var kp = key.split('|');
          try {
            var sf = store.layer(j).property('ADBE Text Properties').property('ADBE Text Document').value.font;
            if (sf !== fontPostScriptName(kp[0], kp[1])) { store.layer(j).remove(); return null; }
          } catch (eF) { return null; }
          try {
            store.layer(j).copyToComp(comp);
            // the copy lands above whatever is selected, so find it by its key
            var t = null;
            for (var k = 1; k <= comp.numLayers && !t; k++) if (comp.layer(k).comment === key) t = comp.layer(k);
            if (!t || !t.property('ADBE Text Properties')) return null;
            t.comment = '';
            t.moveToBeginning();
            styledTemplates.push({ comp: comp, key: key, layer: t });
            return t;
          } catch (e) { return null; }
        }
      }
    }
    return null;
  }
  function keepStyledTemplate(comp, key, layer) {
    // only styles whose font really applied are worth keeping
    var kp = key.split('|');
    try { if (layer.property('ADBE Text Properties').property('ADBE Text Document').value.font !== fontPostScriptName(kp[0], kp[1])) return; } catch (eF) { return; }
    var t = layer.duplicate();
    t.name = 'LayerBoat style template';
    t.comment = '';
    styledTemplates.push({ comp: comp, key: key, layer: t });
    try {
      var store = styleStore(true);
      if (store !== comp && store.numLayers < 400) {
        // marked first, since the copy lands above whatever is selected in the store
        t.comment = key;
        t.copyToComp(store);
        t.comment = '';
        for (var k = 1; k <= store.numLayers; k++) {
          var s0 = store.layer(k);
          if (s0.comment === key) { s0.parent = null; break; }
        }
      }
    } catch (e) {}
  }
  function removeTextTemplates() {
    for (var j = 0; j < styledTemplates.length; j++) { try { styledTemplates[j].layer.remove(); } catch (e0) {} }
    styledTemplates = [];
    for (var i = 0; i < textTemplates.length; i++) { try { textTemplates[i].layer.remove(); } catch (e) {} }
    textTemplates = [];
    removeGlyphComp();
  }

  function buildText(comp, d) {
    var lay = d.layout;
    var justified = d.align === 'JUSTIFIED';
    var useLayout = lay && !justified;
    var isBox = useLayout ? false : (d.autoResize === 'NONE' || d.autoResize === 'HEIGHT' || d.autoResize === 'TRUNCATE');
    var text = useLayout ? lay.text : d.characters.replace(/\r\n|\n/g, '\r');
    var segments = useLayout ? lay.segments : d.segments;
    var tA = now();
    var leading = useLayout && lay.lines > 1 && lay.step ? lay.step : d.leading;
    // Every text property After Effects sets costs time, so a styled layer is
    // kept for each text style and copied, which leaves only the words to set.
    var styleKey = isBox ? null : [d.fontFamily, d.fontStyle, d.fontSize, (d.color || []).join(','), d.tracking || 0, leading || 0, d.align,
      useLayout ? '' : d.textCase, d.underline, d.strike, d.stroke ? JSON.stringify(d.stroke) : ''].join('|');
    var styled = styleKey ? styledTemplate(comp, styleKey) : null;
    var layer = isBox ? comp.layers.addBoxText([Math.max(1, d.width + 2), Math.max(1, d.height + d.fontSize)], text)
                      : (styled ? styled.duplicate() : newPointText(comp, text));
    if (styled) layer.moveToBeginning();
    layer.name = d.name;
    acc('txt:add', tA);
    var prop = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var tR = now();
    var td = prop.value;
    acc('txt:read1', tR); tR = now();
    if (styled) {
      var tW = now();
      try { prop.setValue(text); } catch (eW) { td.text = text; prop.setValue(td); }
      acc('txt:styled', tW);
    } else {
    // New text picks up whatever the Character panel holds. resetCharStyle is
    // very slow (seconds per layer), so the settings that matter are cleared
    // one by one instead.
    var clear = { fauxBold: false, fauxItalic: false, allCaps: false, smallCaps: false, superscript: false, subscript: false,
      baselineShift: 0, tsume: 0, underline: false, strikethrough: false,
      firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 0 };
    for (var ck in clear) if (clear.hasOwnProperty(ck)) { try { if (td[ck] !== clear[ck]) td[ck] = clear[ck]; } catch (e) {} }
    // Figma always applies the font's own kerning
    try { if (td.autoKernType !== AutoKernType.METRIC_KERN) td.autoKernType = AutoKernType.METRIC_KERN; } catch (eK) {}
    acc('txt:reset', tR);
    td.text = text;
    td.font = fontPostScriptName(d.fontFamily, d.fontStyle);
    td.fontSize = d.fontSize;
    td.applyFill = true;
    td.fillColor = rgb(d.color);
    td.tracking = Math.round(d.tracking || 0);
    if (leading) { try { td.autoLeading = false; td.leading = leading; } catch (e2) {} }
    if (JUST[d.align]) td.justification = ParagraphJustification[JUST[d.align]];
    if (d.textCase === 'UPPER' && !useLayout) { try { td.allCaps = true; } catch (e3) {} }
    if (d.underline) { try { td.underline = true; } catch (e5) {} }
    if (d.strike) { try { td.strikethrough = true; } catch (e6) {} }
    if (d.stroke && d.stroke.paints.length) {
      var sc = strokeColor(d.stroke);
      td.applyStroke = true;
      td.strokeColor = rgb(sc.color);
      // After Effects text strokes are centred; inside and outside strokes use
      // twice the width with the fill drawn over or under the stroke.
      // Outside: double width drawn under the fill, so only the outer half shows.
      // Centre and inside: drawn over the fill at the Figma width.
      td.strokeWidth = d.stroke.weight * (d.stroke.align === 'OUTSIDE' ? 2 : 1);
      td.strokeOverFill = d.stroke.align !== 'OUTSIDE';
    } else td.applyStroke = false;
    var tS = now();
    prop.setValue(td);
    acc('txt:set', tS);
    if (styleKey) keepStyledTemplate(comp, styleKey, layer);
    }
    tS = now();
    if (segments && segments.length > 1) applyRuns(prop, segments, leading);
    acc('txt:runs', tS); tS = now();
    glyphFallback(prop, d);
    td = prop.value;
    acc('txt:read2', tS);
    if (td.font !== fontPostScriptName(d.fontFamily, d.fontStyle)) note('Some fonts were missing in After Effects: ' + d.fontFamily + ' ' + d.fontStyle + '.');

    // Line the first baseline up with Figma's. With Figma's own layout the
    // baseline is exact; otherwise it is estimated from the font size.
    var baseline;
    if (useLayout) baseline = lay.baseline;
    else {
      var lineH = d.leading || d.fontSize * 1.21;
      baseline = (lineH - d.fontSize * 1.21) / 2 + d.fontSize * 0.969;
    }
    var inkLeft = fitLineInk(layer, prop, d, lay, useLayout, isBox, segments);
    fitParagraph(prop, d, lay, useLayout, isBox, segments);
    var firstBase = 0, left = 0, anchor;
    var tB = now();
    try { var bl = td.baselineLocs; if (bl && bl.length >= 2) firstBase = bl[1]; } catch (e4) {}
    acc('txt:baseline', tB);
    if (isBox) {
      try { left = td.boxTextPos[0]; } catch (e7) { left = layer.sourceRectAtTime(0, false).left; }
      anchor = [left, firstBase - baseline];
    } else if (d.anchorPoint) {
      // Illustrator point text: its anchor is the first baseline at the alignment point, as in After Effects
      anchor = [0, firstBase];
    } else {
      var ax = d.align === 'CENTER' ? -d.width / 2 : (d.align === 'RIGHT' ? -d.width : 0);
      // with Figma's ink bounds known, line the ink up exactly instead
      if (inkLeft !== null) ax = inkLeft - lay.inkX[0];
      anchor = [ax, firstBase - baseline];
    }
    var tP = now();
    var opacity = (d.opacity === undefined ? 1 : d.opacity) * (d.color[3] < 1 ? d.color[3] : 1);
    var at = d.anchorPoint || [d.x, d.y];
    placeLayer(layer, { x: at[0], y: at[1], rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY, opacity: opacity, blend: d.blend }, anchor);
    if (d.gradient) {
      // gradient text: Gradient Ramp colours the glyphs only
      var g = d.gradient, a = g.stops[0], b = g.stops[g.stops.length - 1];
      // Figma's text-box origin sits at the layer's anchor point
      addRamp(layer, [anchor[0] + g.start[0], anchor[1] + g.start[1]], a.color,
        [anchor[0] + g.end[0], anchor[1] + g.end[1]], b.color, g.type === 'radial');
    }
    addEffects(layer, withoutBgBlur(d.effects));
    acc('txt:place', tP);
    return layer;
  }

  // A single line of text is fitted to the ink bounds Figma drew: the spacing
  // is evened out so the width matches, and the left ink edge is returned so
  // the caller can place it. Returns null when there is nothing to fit.
  function fitLineInk(layer, prop, d, lay, useLayout, isBox, segments) {
    if (!useLayout || isBox || !lay.inkX || lay.lines !== 1) return null;
    var t0 = now();
    try {
      var td = prop.value, n = td.text.length;
      // Figma's ink bounds leave out the text stroke, so measure without it
      var stroked = false;
      try { stroked = td.applyStroke; } catch (eS) {}
      if (stroked) { td.applyStroke = false; prop.setValue(td); td = prop.value; }
      var rect = layer.sourceRectAtTime(0, false);
      var want = lay.inkX[1] - lay.inkX[0], have = rect.width;
      if (n > 1 && Math.abs(want - have) > 0.1 && Math.abs(want - have) < want * 0.08) {
        var gap = (want - have) / (n - 1);
        var segs = segments && segments.length ? segments : [{ start: 0, end: n, fontSize: d.fontSize, tracking: d.tracking }];
        var fixes = d._charTracking || {};
        if (typeof td.characterRange !== 'function') td.tracking = Math.round(td.tracking + gap / d.fontSize * 1000);
        else {
          if (segs.length === 1) td.tracking = Math.round((segs[0].tracking || 0) + gap / segs[0].fontSize * 1000);
          else for (var k = 0; k < segs.length; k++) {
            var a = Math.max(0, segs[k].start), b = Math.min(n, segs[k].end);
            if (b > a) td.characterRange(a, b).tracking = Math.round((segs[k].tracking || 0) + gap / segs[k].fontSize * 1000);
          }
          // characters with their own spacing fix keep it, shifted the same way
          for (var fi in fixes) if (fixes.hasOwnProperty(fi)) {
            var ci = parseInt(fi, 10), fs = fixes[fi].size;
            if (ci < n) td.characterRange(ci, ci + 1).tracking = Math.round(fixes[fi].tracking + gap / fs * 1000);
          }
        }
        prop.setValue(td);
        rect = layer.sourceRectAtTime(0, false);
      }
      if (stroked) { td = prop.value; td.applyStroke = true; prop.setValue(td); }
      acc('txt:fit', t0);
      return rect.left;
    } catch (e) { log('ink fit failed: ' + errText(e)); acc('txt:fit', t0); return null; }
  }

  // Lines of a paragraph are each fitted to the ink width Figma drew for
  // them. Each line is measured on its own in the scratch comp.
  function fitParagraph(prop, d, lay, useLayout, isBox, segments) {
    if (!useLayout || isBox || !lay.lineInk || lay.lines < 2) return;
    if (segments && segments.length > 1) return;
    var t0 = now();
    try {
      var td = prop.value, text = td.text;
      if (typeof td.characterRange !== 'function') return;
      ensureGlyphComp();
      var gp = glyphLayer.property('ADBE Text Properties').property('ADBE Text Document');
      var gd = prop.value;
      try { gd.applyStroke = false; } catch (eS) {}
      gp.setValue(gd);
      var changed = false, base = Math.round(d.tracking || 0), size = d.fontSize;
      for (var i = 0; i < lay.lineInk.length; i++) {
        var li = lay.lineInk[i];
        var line = text.substring(li.start, li.end).replace(/\s+$/, '');
        if (line.length < 2) continue;
        gp.setValue(line);
        var have = glyphLayer.sourceRectAtTime(0, false).width, want = li.ink[1] - li.ink[0];
        if (Math.abs(want - have) <= 0.1 || Math.abs(want - have) > want * 0.08) continue;
        td.characterRange(li.start, li.start + line.length).tracking = Math.round(base + (want - have) / (line.length - 1) / size * 1000);
        changed = true;
      }
      if (changed) prop.setValue(td);
    } catch (e) { log('paragraph fit failed: ' + errText(e)); }
    acc('txt:para', t0);
  }

  // underline and strikethrough bars, in the text box's own coordinates
  function buildDecorations(comp, d) {
    var L = comp.layers.addShape();
    L.name = d.name + ' underline';
    var root = L.property('ADBE Root Vectors Group');
    for (var i = 0; i < d.decorations.length; i++) {
      var b = d.decorations[i];
      var g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
      var gi = g.propertyIndex;
      var c = function () { return L.property('ADBE Root Vectors Group').property(gi).property('ADBE Vectors Group'); };
      addPath(c(), [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], null, null, true);
      var fp = c().addProperty('ADBE Vector Graphic - Fill');
      fp.property('ADBE Vector Fill Color').setValue(rgb(b.color));
      fp.property('ADBE Vector Fill Opacity').setValue((b.color[3] === undefined ? 1 : b.color[3]) * 100);
    }
    placeLayer(L, { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY, opacity: d.opacity, blend: d.blend }, [0, 0]);
    return L;
  }

  // ---------- effects ----------
  function addEffects(layer, effects) {
    if (!effects || !effects.length) return;
    var t0 = now();
    try { addEffectsInner(layer, effects); } finally { acc('effects', t0); }
  }

  function addEffectsInner(layer, effects) {
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      try {
        if (e.type === 'dropShadow' && !e.spread) {
          var ds = layer.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
          ds.property(1).setValue(rgb(e.color));
          ds.property(2).setValue(e.color[3] * 255);
          var ang = Math.atan2(e.offset[0], -e.offset[1]) * 180 / Math.PI;
          if (ang < 0) ang += 360;
          ds.property(3).setValue(ang);
          ds.property(4).setValue(Math.sqrt(e.offset[0] * e.offset[0] + e.offset[1] * e.offset[1]));
          ds.property(5).setValue(shadowSoftness(e.radius));
        } else if (e.type === 'dropShadow' || e.type === 'innerShadow') {
          styleQueue.push({ layer: layer, effect: e });
        } else if (e.type === 'blur') {
          var b = layer.property('ADBE Effect Parade').addProperty(BLUR_EFFECT);
          b.property(1).setValue(blurAmount(e.radius));
          try { b.property(3).setValue(0); } catch (e3) {} // let the blur spread past the edges, as in Figma
        }
      } catch (err) { note('An effect on ' + layer.name + ' could not be added.'); log('effect failed ' + errText(err)); }
    }
  }

  // Inner shadows, and shadows with spread, need After Effects layer styles.
  // A layer style can only be added to a selected layer in the open comp, so
  // they are applied in one pass after the build.
  var styleQueue = [];
  var STYLE_CMD = { dropShadow: 9000, innerShadow: 9001 };

  function applyStyleQueue() {
    if (!styleQueue.length) return;
    var t0 = now();
    var lastComp = null;
    for (var i = 0; i < styleQueue.length; i++) {
      var job = styleQueue[i], L = job.layer, e = job.effect;
      try {
        var comp = L.containingComp;
        if (comp !== lastComp) { comp.openInViewer(); lastComp = comp; }
        // nothing else may be selected, or the preset lands there too
        for (var k = 1; k <= comp.numLayers; k++) { try { if (comp.layer(k).selected) comp.layer(k).selected = false; } catch (eD) {} }
        L.selected = true;
        var key = e.type === 'innerShadow' ? 'innerShadow' : 'dropShadow';
        app.executeCommand(STYLE_CMD[key]);
        var g = L.property('ADBE Layer Styles').property(key + '/enabled');
        if (!g) { note('Some shadows could not be added.'); log('no style group ' + key); continue; }
        var spread = Math.max(0, e.spread || 0), size = e.radius + spread;
        setStyle(g, key + '/mode2', 1);
        setStyle(g, key + '/color', rgb(e.color));
        setStyle(g, key + '/opacity', e.color[3] * 100);
        setStyle(g, key + '/useGlobalAngle', 0);
        setStyle(g, key + '/localLightingAngle', Math.atan2(e.offset[1], -e.offset[0]) * 180 / Math.PI);
        setStyle(g, key + '/distance', Math.sqrt(e.offset[0] * e.offset[0] + e.offset[1] * e.offset[1]));
        setStyle(g, key + '/chokeMatte', size ? spread / size * 100 : 0);
        setStyle(g, key + '/blur', size);
        L.selected = false;
      } catch (err) { note('Some shadows could not be added.'); log('style failed ' + errText(err)); }
    }
    styleQueue = [];
    acc('styles', t0);
  }

  function setStyle(group, name, value) {
    try { group.property(name).setValue(value); } catch (e) { log('style prop ' + name + ' failed: ' + errText(e)); }
  }

  // ---------- tree ----------
  function applyMatte(layer, matteLayer) {
    if (!matteLayer || matteLayer === layer) return;
    // A layer that already uses a matte of its own (a gradient fade) passes the
    // clipping on to that matte layer instead.
    try {
      if (layer.hasTrackMatte && layer.trackMatteLayer && layer.trackMatteLayer !== matteLayer) {
        applyMatte(layer.trackMatteLayer, matteLayer);
        return;
      }
    } catch (e0) {}
    var t0 = now();
    var luma = false;
    for (var lm = 0; lm < lumaMattes.length; lm++) if (lumaMattes[lm] === matteLayer) luma = true;
    try { layer.setTrackMatte(matteLayer, luma ? TrackMatteType.LUMA : TrackMatteType.ALPHA); }
    catch (e) { note('Some clipping could not be applied.'); log('matte failed on ' + layer.name + ': ' + errText(e)); }
    acc('matte', t0);
  }

  function setParent(layer, p) {
    if (!p) return;
    var t0 = now();
    layer.parent = p;
    acc('parent', t0);
  }

  // each top-level piece of the design gets its own label colour, shared by
  // all of its layers, so related layers are easy to spot in the timeline
  var LABELS = [9, 10, 11, 12, 13, 14, 15, 16, 2, 3, 4, 5, 6, 7, 8];
  var labelNext = 0;
  function buildTree(comp, list, parentNull, opts, created, inherited, byId) {
    for (var i = 0; i < list.length; i++) {
      var ti = now();
      var startN = created.length;
      try { buildItem(comp, list[i], parentNull, opts, created, inherited, byId); }
      catch (e) {
        note('Some layers could not be built.');
        log('layer failed: ' + list[i].name + ' (' + list[i].type + '): ' + errText(e));
      }
      if (list[i].type !== 'group') acc('item:' + list[i].type, ti);
      // tag each layer with the Figma layer it came from, so a later send can
      // find it again and keep its animation
      var n = 0;
      for (var tg = startN; tg < created.length; tg++) {
        try { if (!created[tg].comment) created[tg].comment = 'figma:' + list[i].id + ':' + (n++); } catch (eT) {}
      }
      if (!parentNull && created.length > startN) {
        var lab = LABELS[labelNext++ % LABELS.length];
        for (var k = startN; k < created.length; k++) { try { if (!created[k].shy) created[k].label = lab; } catch (eL) {} }
      }
    }
  }

  // one Figma layer; returns early where the old loop used continue
  function buildItem(comp, d, parentNull, opts, created, inherited, byId) {
    {
      if (d.type === 'mask') {
        var m = d.native ? nativeLayer(comp, d) : null;
        if (m) { m.name = d.name + ' (mask)'; m.enabled = false; m.label = 0; makeHelper(m); }
        else m = buildMask(comp, d);
        setParent(m, parentNull);
        byId[d.id] = m;
        var outer = byId[d.matte || inherited];
        if (outer) applyMatte(m, outer);
        created.push(m);
        return;
      }
      if (d.type === 'group' && d.combine && opts.combine !== false) {
        // an icon or other all-vector group: one shape layer, one shape group per piece
        var CL = (d.native && nativeLayer(comp, d)) || buildCombined(comp, d);
        setParent(CL, parentNull);
        applyMatte(CL, byId[d.matte || inherited]);
        created.push(CL);
        return;
      }
      if (d.type === 'group' && d.precomp) {
        // built in its own precomp so opacity, blur, shadows and blend modes
        // apply to the group as a whole, as in Figma
        if (hasEffect(d.effects, 'bgBlur') && d.kind) {
          var under = buildBackgroundBlur(comp, d);
          for (var u = 0; u < under.length; u++) { setParent(under[u], parentNull); created.push(under[u]); }
        }
        var tp = now();
        var sub = app.project.items.addComp(d.name, comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
        sub.parentFolder = precompBin();
        acc('precomp', tp);
        buildTree(sub, d.children || [], null, opts, [], d.clipId || null, {});
        var P = comp.layers.add(sub);
        P.name = d.name;
        if (d.opacity !== undefined && d.opacity < 1) P.property('ADBE Transform Group').property('ADBE Opacity').setValue(d.opacity * 100);
        finishLayer(P, d, withoutBgBlur(d.effects));
        setParent(P, parentNull);
        applyMatte(P, byId[d.matte || inherited]);
        created.push(P);
        return;
      }
      if (d.type === 'group') {
        var nul = null;
        var kids = d.children || [];
        // A frame with a fill: its background layer is the parent of
        // everything inside, so no separate null is needed.
        var bgAt = -1;
        for (var bi = 0; bi < kids.length; bi++) if (kids[bi].type === 'shape' && kids[bi].id === d.id + ':bg') bgAt = bi;
        if (opts.nulls && bgAt >= 0 && !(d.effects && d.effects.length)) {
          var bgd = kids[bgAt];
          var bgBuilt = buildShape(comp, bgd);
          if (bgBuilt.length) {
            nul = bgBuilt[bgBuilt.length - 1];
            nul.name = d.name;
            var bgMatte = byId[bgd.matte || d.matte || inherited];
            for (var bb = 0; bb < bgBuilt.length; bb++) {
              setParent(bgBuilt[bb], parentNull);
              applyMatte(bgBuilt[bb], bgMatte);
              created.push(bgBuilt[bb]);
            }
            kids = kids.slice(0, bgAt).concat(kids.slice(bgAt + 1));
          }
        }
        // A wrapper around a single layer (common with auto layout) adds
        // nothing to animate, so the layer goes straight to the outer parent.
        var solo = null, soloCount = 0;
        for (var si = 0; si < kids.length; si++) if (kids[si].type !== 'mask') { soloCount++; solo = kids[si]; }
        if (!nul && soloCount === 1 && !(d.effects && d.effects.length)) {
          if (GENERIC_NAME.test(solo.name) && !GENERIC_NAME.test(d.name)) solo.name = d.name;
          buildTree(comp, kids, parentNull, opts, created, d.clipId || d.matte || inherited, byId);
          return;
        }
        if (opts.nulls && !nul) {
          var tn = now();
          nul = comp.layers.addNull();
          nul.name = d.name;
          nul.label = 0;
          placeLayer(nul, { x: d.x, y: d.y, rotation: d.rotation, scaleX: d.scaleX, scaleY: d.scaleY }, [0, 0]);
          nul.enabled = false;
          setParent(nul, parentNull);
          created.push(nul);
          NULL_SIZE.push({ layer: nul, w: d.width || 0, h: d.height || 0 });
          acc('nulls', tn);
        }
        if (d.effects && d.effects.length) {
          // a frame's shadow without a fill falls back to its children
          for (var e = 0; e < kids.length; e++) kids[e].effects = (kids[e].effects || []).concat(d.effects);
        }
        var inner = d.clipId || d.matte || inherited;
        buildTree(comp, kids, nul || parentNull, opts, created, inner, byId);
        return;
      }
      var built = [];
      if (d.type === 'text' && d.propName) egpQueue.push({ comp: comp, name: d.propName, d: d });
      if (d.type === 'shape') {
        var NL = d.native ? nativeLayer(comp, d) : null;
        built = NL ? [finishLayer(NL, d, withoutBgBlur(d.effects))] : buildShape(comp, d);
      }
      else if (d.type === 'text') {
        var tT = now();
        built = [buildText(comp, d)];
        if (d.propName && egpQueue.length && egpQueue[egpQueue.length - 1].d === d) egpQueue[egpQueue.length - 1].layer = built[0];
        acc('txt:total', tT); tT = now();
        if (d.decorations && d.decorations.length) built.push(buildDecorations(comp, d));
        acc('txt:deco', tT);
      }
      var matte = byId[d.matte || inherited];
      for (var b = 0; b < built.length; b++) {
        setParent(built[b], parentNull);
        applyMatte(built[b], matte);
        created.push(built[b]);
      }
    }
  }

  function run(opts, done) {
    log('run start');
    if (!scriptsCanUseSystem()) {
      alert('Turn on: After Effects > Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network". Then try again.');
      return;
    }
    var raw = readClipboard();
    log('clipboard chars: ' + (raw ? raw.length : 'none'));
    var data = parseData(raw);
    if (!data) {
      alert('Nothing from Figma on the clipboard. In Figma, run the plugin and click Copy first.');
      return;
    }
    deferBuild(data, opts, done);
  }

  // Building from a button click is very slow in After Effects. The same work
  // run as a scheduled task is many times faster, so hand it off.
  function deferBuild(data, opts, done) {
    var G = $.global;
    G.__figmaBridgeJob = { data: data, opts: opts, done: done };
    G.__figmaBridgeRunJob = function () {
      var job = G.__figmaBridgeJob;
      G.__figmaBridgeJob = null;
      if (!job) return;
      build(job.data, job.opts);
      if (job.done) job.done();
    };
    app.scheduleTask('$.global.__figmaBridgeRunJob()', 10, false);
  }

  function build(data, opts) {
    // several Figma frames sent together: one comp each
    if (data && data.multi && data.multi.length) {
      var each = {}, made = [];
      for (var ok in opts) if (opts.hasOwnProperty(ok)) each[ok] = opts[ok];
      each.intoActive = false;
      for (var mi = 0; mi < data.multi.length; mi++) {
        try { build(data.multi[mi], each); made.push(data.multi[mi].name); } catch (eM) { log('frame failed: ' + errText(eM)); }
      }
      LayerBoatCore.lastStatus = 'Built ' + made.length + ' comps: ' + made.join(', ') + '.';
      return;
    }
    notes = {};
    T = {};
    NULL_SIZE = [];
    var tStart = now();
    log('build: ' + data.name);
    // developer copy of the last payload, only where the dev folder exists
    if (HOME && Folder(HOME + '/dev/dumps').exists) { try { var lf = new File(HOME + '/dev/dumps/last.json'); lf.encoding = 'UTF-8'; lf.open('w'); lf.write(JSON.stringify(data)); lf.close(); } catch (eL) { log('dump failed ' + errText(eL)); } } else log('no dump folder ' + HOME);
    // After Effects' own Illustrator reader runs first, outside the undo step
    var activeBefore = app.project.activeItem;
    if (data.nativeFile) { try { prepareNative(data.nativeFile); } catch (eN) { log('native failed: ' + errText(eN)); note('Some shapes could not be read.'); } }
    app.beginUndoGroup('Paste from Figma');
    try {
      var comp = activeBefore;
      var updating = null;
      var compTag = data.rootId ? 'figma:' + data.rootId : null;
      if (compTag && opts.update !== false) updating = findTaggedComp(compTag);
      if (updating) {
        comp = updating;
        try { comp.width = data.width; comp.height = data.height; } catch (eS) {}
      } else if (!opts.intoActive || !isCompItem(comp)) {
        comp = app.project.items.addComp(data.name || 'Figma', data.width, data.height, 1, 10, 30);
        if (compTag) comp.comment = compTag;
      }
      var before = updating ? snapshot(comp) : null;
      var created = [];
      styleQueue = [];
      gradientQueue = [];
      helperComps = [];
      lumaMattes = [];
      egpQueue = [];
      labelNext = 0;
      var tt = now();
      try { buildTree(comp, data.layers, null, opts, created, null, {}); } finally { cleanupNative(); }
      removeTextTemplates();
      acc('TREE', tt); tt = now();
      applyStyleQueue();
      applyGradientQueue();
      applyEgpQueue(comp);
      acc('STYLEPASS', tt); tt = now();
      // after the gradient presets, which need the layers as they were made, and
      // before your animation is carried over, which is measured from the centre
      if (opts.centerAnchors !== false) centreAnchors(created);
      if (before) reconcile(comp, before);
      hideHelpers();
      // nothing stays selected, so a later Send to Figma sends the whole comp
      var leftSel = comp.selectedLayers;
      for (var ls = 0; ls < leftSel.length; ls++) leftSel[ls].selected = false;
      // the built comp ends up open and selected, not a gradient comp opened on the way
      try { var selItems = app.project.selection; for (var si = 0; si < selItems.length; si++) selItems[si].selected = false; comp.selected = true; } catch (eSel) {}
      var viewer = comp.openInViewer();
      try { if (viewer) viewer.setActive(); } catch (eV) {}
      // After Effects can still bring a gradient comp forward afterwards, so the built comp is opened once more
      try { $.global.__figmaBridgeShow = comp; app.scheduleTask('try { var c = $.global.__figmaBridgeShow; if (c) { var v = c.openInViewer(); if (v) v.setActive(); } } catch (e) {}', 300, false); } catch (eT) {}
      acc('VIEWER', tt);
      var secs = ((now() - tStart) / 1000).toFixed(1);
      var parts = [];
      for (var k in T) if (T.hasOwnProperty(k)) parts.push(k + '=' + (T[k] / 1000).toFixed(1) + 's');
      log('built ' + created.length + ' layers in ' + secs + 's | ' + parts.join(' '));
      var msg = [];
      for (var n in notes) if (notes.hasOwnProperty(n)) msg.push(n);
      if (data.source === 'illustrator' && data.warnings) for (var wi = 0; wi < data.warnings.length; wi++) msg.push(data.warnings[wi]);
      // Illustrator's scripting slows down the longer it runs; a restart brings it back
      if (data.source === 'illustrator' && data.stats && data.stats.seconds > 20) msg.push('Illustrator took ' + Math.round(data.stats.seconds) + ' seconds. Its scripting slows down over a long session, so restarting Illustrator makes the next send faster.');
      LayerBoatCore.lastStatus = (before ? 'Updated ' : 'Built ') + created.length + ' layers in ' + secs + 's.' + (msg.length ? ' ' + msg.join(' ') : '');
    } catch (err) {
      log('ERROR ' + errText(err));
      alert('Paste failed: ' + errText(err));
    }
    removeTextTemplates();
    app.endUndoGroup();
  }



  // ---------- updating a comp that was sent before ----------
  // Sending the same Figma frame again rebuilds its layers in the same comp.
  // Animation on the old layers (keyframes, expressions, effects you added,
  // timing, markers) moves to the matching new layers, layers you added
  // yourself stay where they were, and the old Figma layers are removed.
  function findTaggedComp(tag) {
    var found = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (!(it instanceof CompItem) || it.comment !== tag) continue;
      var inBin = false;
      try { inBin = it.parentFolder && it.parentFolder.name === 'Figma Precomps'; } catch (e) {}
      if (inBin) { try { it.comment = ''; } catch (e2) {} continue; }
      if (!found || it.id > found.id) found = it;
    }
    return found;
  }
  function tagOf(L) { var c = ''; try { c = L.comment || ''; } catch (e) {} c = c.split('\n')[0]; return c.indexOf('figma:') === 0 ? c : null; }
  function snapshot(comp) {
    var tagged = [], mine = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i), t = tagOf(L);
      if (t) tagged.push({ layer: L, tag: t });
      else {
        var above = null;
        for (var j = i - 1; j >= 1; j--) { var a = tagOf(comp.layer(j)); if (a) { above = a; break; } }
        var below = null;
        for (var k = i + 1; k <= comp.numLayers; k++) { var b = tagOf(comp.layer(k)); if (b) { below = b; break; } }
        var pt = null; try { pt = L.parent ? tagOf(L.parent) : null; } catch (eP) {}
        mine.push({ layer: L, above: above, below: below, parentTag: pt });
      }
    }
    return { tagged: tagged, mine: mine };
  }
  function reconcile(comp, before) {
    var t0 = now();
    var i;
    // the new layers carry the same tags; old ones were captured before the build
    var fresh = {};
    for (i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i), t = tagOf(L);
      if (!t) continue;
      var old = false;
      for (var j = 0; j < before.tagged.length; j++) if (before.tagged[j].layer === L) { old = true; break; }
      if (!old && !fresh[t]) fresh[t] = L;
    }
    var oldSources = [];
    for (i = 0; i < before.tagged.length; i++) {
      var o = before.tagged[i], nL = fresh[o.tag];
      if (nL) {
        try { transferAnimation(o.layer, nL); } catch (eX) { log('animation transfer failed ' + o.tag + ': ' + errText(eX)); }
        try { if (o.layer.source instanceof CompItem && nL.source instanceof CompItem) reconcileComps(o.layer.source, nL.source); } catch (eR) {}
      }
      // layers you parented to a Figma layer follow its replacement
      for (var c = 1; c <= comp.numLayers; c++) {
        var ch = comp.layer(c);
        try { if (ch.parent === o.layer && !tagOf(ch)) ch.parent = nL || null; } catch (eC) {}
      }
      try { if (o.layer.source instanceof CompItem) oldSources.push(o.layer.source); } catch (eS) {}
    }
    for (i = 0; i < before.tagged.length; i++) { try { before.tagged[i].layer.remove(); } catch (eD) {} }
    // your own layers go back next to the same Figma layers as before
    for (i = 0; i < before.mine.length; i++) {
      var m = before.mine[i];
      try {
        if (m.above && fresh[m.above]) m.layer.moveAfter(fresh[m.above]);
        else if (m.below && fresh[m.below]) m.layer.moveBefore(fresh[m.below]);
      } catch (eM) {}
    }
    removeUnusedComps(oldSources);
    acc('update', t0);
  }
  // precomps: match their inner layers the same way
  function reconcileComps(oldComp, newComp) {
    var oldByTag = {}, i;
    for (i = 1; i <= oldComp.numLayers; i++) { var t = tagOf(oldComp.layer(i)); if (t) oldByTag[t] = oldComp.layer(i); }
    for (i = 1; i <= newComp.numLayers; i++) {
      var nL = newComp.layer(i), tn = tagOf(nL);
      if (tn && oldByTag[tn]) {
        try { transferAnimation(oldByTag[tn], nL); } catch (e) {}
        try { if (oldByTag[tn].source instanceof CompItem && nL.source instanceof CompItem) reconcileComps(oldByTag[tn].source, nL.source); } catch (e2) {}
      }
    }
    // your own layers inside the precomp are copied across
    for (i = oldComp.numLayers; i >= 1; i--) {
      var L = oldComp.layer(i);
      if (!tagOf(L)) { try { L.copyToComp(newComp); } catch (e3) {} }
    }
  }
  function removeUnusedComps(list) {
    for (var i = 0; i < list.length; i++) {
      try {
        var c = list[i];
        if (c.usedIn.length) continue;
        var inner = [];
        for (var k = 1; k <= c.numLayers; k++) if (c.layer(k).source instanceof CompItem) inner.push(c.layer(k).source);
        c.remove();
        removeUnusedComps(inner);
      } catch (e) {}
    }
  }
  // Copies what the animator did to a layer onto its rebuilt version.
  function transferAnimation(from, to) {
    try { to.startTime = from.startTime; to.inPoint = from.inPoint; to.outPoint = from.outPoint; } catch (e0) {}
    try { if (from.stretch !== 100) to.stretch = from.stretch; } catch (e1) {}
    try { to.motionBlur = from.motionBlur; } catch (e2) {}
    // visibility carries over only between ordinary layers: LayerBoat hides its own nulls
    // and mattes, and a group that was a null can come back as a drawn layer
    try {
      var helper = function (L) { return L.nullLayer || L.isTrackMatte || L.shy; };
      if (!helper(from) && !helper(to)) to.enabled = from.enabled;
      to.solo = from.solo; to.locked = false;
    } catch (e3) {}
    try { if (from.threeDLayer && !to.threeDLayer) to.threeDLayer = true; } catch (e4) {}
    copyAnimated(from, to);
    // effects you added (ones LayerBoat did not make) are recreated with their settings
    try {
      var fx = from.property('ADBE Effect Parade'), tfx = to.property('ADBE Effect Parade');
      var ours = {};
      for (var k = 1; k <= tfx.numProperties; k++) ours[tfx.property(k).matchName] = (ours[tfx.property(k).matchName] || 0) + 1;
      for (var i = 1; i <= fx.numProperties; i++) {
        var e = fx.property(i), mn = e.matchName;
        if (ours[mn]) { ours[mn]--; continue; }
        var ne = tfx.addProperty(mn);
        ne.name = e.name;
        copyAll(e, ne);
      }
    } catch (e5) {}
    // markers
    try {
      var mk = from.property('ADBE Marker'), tm = to.property('ADBE Marker');
      for (var m = 1; m <= mk.numKeys; m++) tm.setValueAtTime(mk.keyTime(m), mk.keyValue(m));
    } catch (e6) {}
  }
  // properties that are keyframed or driven by an expression
  function copyAnimated(fromGroup, toGroup) {
    for (var i = 1; i <= fromGroup.numProperties; i++) {
      var p = fromGroup.property(i);
      if (p.matchName === 'ADBE Effect Parade' || p.matchName === 'ADBE Marker' || p.matchName === 'ADBE Layer Styles') continue;
      var q = null;
      try { q = toGroup.property(p.matchName); } catch (e) {}
      if (!q) { try { if (toGroup.numProperties >= i && toGroup.property(i).matchName === p.matchName) q = toGroup.property(i); } catch (e2) {} }
      if (!q) continue;
      if (p.propertyType === PropertyType.PROPERTY) {
        if (p.numKeys > 0 || (p.expressionEnabled && p.expression)) copyProperty(p, q);
      } else copyAnimated(p, q);
    }
  }
  function copyAll(fromGroup, toGroup) {
    for (var i = 1; i <= fromGroup.numProperties; i++) {
      var p = fromGroup.property(i), q = null;
      try { q = toGroup.property(i); } catch (e) {}
      if (!q) continue;
      if (p.propertyType === PropertyType.PROPERTY) copyProperty(p, q, true);
      else copyAll(p, q);
    }
  }
  function copyProperty(p, q, includeStatic) {
    try {
      if (p.numKeys > 0) {
        for (var k = 1; k <= p.numKeys; k++) {
          q.setValueAtTime(p.keyTime(k), p.keyValue(k));
          var idx = q.nearestKeyIndex(p.keyTime(k));
          try { q.setInterpolationTypeAtKey(idx, p.keyInInterpolationType(k), p.keyOutInterpolationType(k)); } catch (e1) {}
          try { q.setTemporalEaseAtKey(idx, p.keyInTemporalEase(k), p.keyOutTemporalEase(k)); } catch (e2) {}
          try { if (p.isSpatial) q.setSpatialTangentsAtKey(idx, p.keyInSpatialTangent(k), p.keyOutSpatialTangent(k)); } catch (e3) {}
        }
      } else if (includeStatic && q.canSetExpression !== undefined) {
        try { q.setValue(p.value); } catch (e4) {}
      }
      if (p.expression) { q.expression = p.expression; q.expressionEnabled = p.expressionEnabled; }
    } catch (e) {}
  }

  // ---------- After Effects to Figma ----------
  // The selected layers of the open comp (or all of them) are described as
  // plain shapes, text, images and frames, and posted to the relay for the
  // Figma plugin to draw.
  function httpPost(path, body) {
    var s = new Socket();
    s.timeout = 5;
    s.encoding = 'BINARY';
    if (!s.open('127.0.0.1:' + PORT, 'BINARY')) return null;
    s.write('POST ' + path + ' HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: ' + body.length + '\r\n\r\n');
    for (var i = 0; i < body.length; i += 1048576) s.write(body.substr(i, 1048576));
    var parts = [], guard = 0;
    while (!s.eof && guard < 100000) { var c = s.read(65536); if (c) parts.push(c); else guard += 1000; guard++; }
    s.close();
    var resp = parts.join('');
    var cut = resp.indexOf('\r\n\r\n');
    if (cut < 0) return null;
    return { status: parseInt(resp.substring(0, resp.indexOf('\r\n')).split(' ')[1], 10), body: resp.substring(cut + 4) };
  }
  // non-ASCII is escaped so the JSON travels as plain bytes
  function asciiJSON(o) {
    return JSON.stringify(o).replace(/[\u007f-￿]/g, function (ch) { return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4); });
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // every pair of base64 letters, so each 3 bytes take two lookups
  var B64PAIRS = null;
  function base64Of(bin) {
    if (!B64PAIRS) { B64PAIRS = []; for (var p = 0; p < 4096; p++) B64PAIRS.push(B64.charAt(p >> 6) + B64.charAt(p & 63)); }
    var out = [], part = [], i, P = B64PAIRS;
    for (i = 0; i + 2 < bin.length; i += 3) {
      var n = (bin.charCodeAt(i) << 16) | (bin.charCodeAt(i + 1) << 8) | bin.charCodeAt(i + 2);
      part.push(P[n >> 12] + P[n & 4095]);
      if (part.length === 8192) { out.push(part.join('')); part = []; }
    }
    out.push(part.join(''));
    var rest = bin.length - i;
    if (rest === 1) { var a = bin.charCodeAt(i) << 16; out.push(B64.charAt(a >> 18 & 63) + B64.charAt(a >> 12 & 63) + '=='); }
    else if (rest === 2) { var b = (bin.charCodeAt(i) << 16) | (bin.charCodeAt(i + 1) << 8); out.push(B64.charAt(b >> 18 & 63) + B64.charAt(b >> 12 & 63) + B64.charAt(b >> 6 & 63) + '='); }
    return out.join('');
  }

  // A file as base64. On a Mac the system's own encoder does it in a blink.
  function base64OfFile(file) {
    if ($.os.toLowerCase().indexOf('mac') !== -1) {
      try {
        var tmp = new File(Folder.temp.fsName + '/layerboat-b64-' + new Date().getTime() + '.txt');
        system.callSystem('/usr/bin/base64 -i "' + file.fsName + '" -o "' + tmp.fsName + '"');
        if (tmp.exists && tmp.length > 0) {
          tmp.encoding = 'BINARY'; tmp.open('r'); var t = tmp.read(); tmp.close();
          try { tmp.remove(); } catch (eR) {}
          t = t.split('\n').join('').split('\r').join('');
          if (t.length) return t;
        }
      } catch (e) { log('system base64 failed: ' + errText(e)); }
    }
    file.encoding = 'BINARY';
    if (!file.open('r')) return null;
    var bin = file.read(); file.close();
    return base64Of(bin);
  }

  // 2D affine matrices as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
  function mMul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  function mT(x, y) { return [1, 0, 0, 1, x, y]; }
  function mR(deg) { var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; }
  function mS(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }
  function mApply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
  function mVec(m, v) { return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]]; }
  function val(group, name, fallback) { try { var p = group.property(name); return p ? p.valueAtTime(0, false) : fallback; } catch (e) { return fallback; } }

  // layer space to comp space, following parents
  function layerMatrix(L) {
    var tr = L.property('ADBE Transform Group');
    var pos = val(tr, 'ADBE Position', [0, 0]), anc = val(tr, 'ADBE Anchor Point', [0, 0]), sc = val(tr, 'ADBE Scale', [100, 100]);
    var rot = val(tr, 'ADBE Rotate Z', 0);
    var m = mMul(mMul(mMul(mT(pos[0], pos[1]), mR(rot)), mS(sc[0] / 100, sc[1] / 100)), mT(-anc[0], -anc[1]));
    return L.parent ? mMul(layerMatrix(L.parent), m) : m;
  }
  function groupMatrix(g) {
    var tr = g.property('ADBE Vector Transform Group');
    if (!tr) return [1, 0, 0, 1, 0, 0];
    var pos = val(tr, 'ADBE Vector Position', [0, 0]), anc = val(tr, 'ADBE Vector Anchor', [0, 0]), sc = val(tr, 'ADBE Vector Scale', [100, 100]);
    var rot = val(tr, 'ADBE Vector Rotation', 0), sk = val(tr, 'ADBE Vector Skew', 0), ax = val(tr, 'ADBE Vector Skew Axis', 0);
    var skew = mMul(mMul(mR(ax), [1, 0, -Math.tan(sk * Math.PI / 180), 1, 0, 0]), mR(-ax));
    return mMul(mMul(mMul(mMul(mT(pos[0], pos[1]), mR(rot)), skew), mS(sc[0] / 100, sc[1] / 100)), mT(-anc[0], -anc[1]));
  }
  function fmt(n) { return Math.round(n * 100) / 100; }
  // a closed or open bezier path as SVG path data, through matrix m
  function pathData(verts, ins, outs, closed, m) {
    var d = [], n = verts.length;
    if (!n) return '';
    var p0 = mApply(m, verts[0]);
    d.push('M ' + fmt(p0[0]) + ' ' + fmt(p0[1]));
    var segs = closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var a = verts[i], b = verts[(i + 1) % n];
      var c1 = mApply(m, [a[0] + outs[i][0], a[1] + outs[i][1]]), c2 = mApply(m, [b[0] + ins[(i + 1) % n][0], b[1] + ins[(i + 1) % n][1]]), e = mApply(m, b);
      d.push('C ' + fmt(c1[0]) + ' ' + fmt(c1[1]) + ' ' + fmt(c2[0]) + ' ' + fmt(c2[1]) + ' ' + fmt(e[0]) + ' ' + fmt(e[1]));
    }
    if (closed) d.push('Z');
    return d.join(' ');
  }
  var K = 0.5523;
  function rectPath(size, pos, round, m) {
    var w = size[0] / 2, h = size[1] / 2, r = Math.min(round || 0, w, h), cx = pos[0], cy = pos[1];
    if (!r) return pathData([[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]], [[0, 0], [0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]], true, m);
    var k = r * K;
    var v = [[cx - w + r, cy - h], [cx + w - r, cy - h], [cx + w, cy - h + r], [cx + w, cy + h - r], [cx + w - r, cy + h], [cx - w + r, cy + h], [cx - w, cy + h - r], [cx - w, cy - h + r]];
    var ins = [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]];
    var outs = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]];
    return pathData(v, ins, outs, true, m);
  }
  function ellipsePath(size, pos, m) {
    var w = size[0] / 2, h = size[1] / 2, cx = pos[0], cy = pos[1];
    return pathData([[cx, cy - h], [cx + w, cy], [cx, cy + h], [cx - w, cy]], [[-w * K, 0], [0, -h * K], [w * K, 0], [0, h * K]], [[w * K, 0], [0, h * K], [-w * K, 0], [0, -h * K]], true, m);
  }
  // a star or polygon with sharp corners, as After Effects draws it: the first point at the top
  function starPath(p, m, warn) {
    var poly = val(p, 'ADBE Vector Star Type', 1) === 2, n = Math.max(3, Math.round(val(p, 'ADBE Vector Star Points', 5)));
    var c = val(p, 'ADBE Vector Star Position', [0, 0]), rot = val(p, 'ADBE Vector Star Rotation', 0) * Math.PI / 180;
    var ro = val(p, 'ADBE Vector Star Outer Radius', 100), ri = poly ? ro : val(p, 'ADBE Vector Star Inner Radius', 50);
    if (val(p, 'ADBE Vector Star Outer Roundess', 0) || (!poly && val(p, 'ADBE Vector Star Inner Roundess', 0))) warn['Rounded star and polygon corners come in sharp.'] = true;
    var count = poly ? n : n * 2, verts = [], zero = [];
    for (var i = 0; i < count; i++) {
      var r = poly || i % 2 === 0 ? ro : ri, a = rot - Math.PI / 2 + i * 2 * Math.PI / count;
      verts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      zero.push([0, 0]);
    }
    return pathData(verts, zero, zero, true, m);
  }
  function col255(c) { return [Math.max(0, Math.min(1, c[0])), Math.max(0, Math.min(1, c[1])), Math.max(0, Math.min(1, c[2]))]; }

  // the corners of a path, when it is a plain upright rectangle
  function pathBox(d) {
    var n = String(d).match(/-?[0-9.]+(e-?[0-9]+)?/g);
    if (!n || n.length < 4) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i + 1 < n.length; i += 2) { var x = +n[i], y = +n[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    var rect = true, e = 0.05, corners = {};
    for (i = 0; i + 1 < n.length && rect; i += 2) {
      var px = +n[i], py = +n[i + 1], cx = Math.abs(px - x0) <= e ? 'l' : (Math.abs(px - x1) <= e ? 'r' : ''), cy = Math.abs(py - y0) <= e ? 't' : (Math.abs(py - y1) <= e ? 'b' : '');
      if (!cx || !cy) rect = false; else corners[cx + cy] = true;
    }
    // all four corners must be there, so a triangle is not taken for a rectangle
    rect = rect && corners.lt && corners.rt && corners.lb && corners.rb && x1 > x0 && y1 > y0;
    return { x0: x0, y0: y0, x1: x1, y1: y1, rect: rect && /^M[^M]*$/.test(String(d).replace(/ Z$/, '')) };
  }
  // Merge Paths as a fill rule. Exact for add and merge, for exclude, for subtract
  // where the cut-outs sit inside the first path, and for intersect with a rectangle
  // that holds everything else.
  function mergePaths(paths, mode) {
    if (paths.length < 2) return { paths: paths, evenodd: false, exact: true };
    if (mode === 1 || mode === 2) return { paths: paths, evenodd: false, exact: true };
    if (mode === 5) return { paths: paths, evenodd: true, exact: true };
    var boxes = [], i;
    for (i = 0; i < paths.length; i++) boxes.push(pathBox(paths[i]));
    function inside(a, b) { return a && b && a.x0 >= b.x0 - 0.5 && a.y0 >= b.y0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y1 <= b.y1 + 0.5; }
    if (mode === 3) {
      var ok = true;
      for (i = 1; i < paths.length; i++) if (!inside(boxes[i], boxes[0])) ok = false;
      return { paths: paths, evenodd: true, exact: ok };
    }
    if (mode === 4) {
      // a rectangle intersected with artwork is a clip: the artwork is kept as it is
      var shapes = [], rects = [];
      for (i = 0; i < paths.length; i++) (boxes[i] && boxes[i].rect ? rects : shapes).push(i);
      if (!rects.length) return { paths: paths, evenodd: false, exact: false };
      if (!shapes.length) {
        var r0 = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
        for (i = 0; i < rects.length; i++) { var bx = boxes[rects[i]]; r0 = { x0: Math.max(r0.x0, bx.x0), y0: Math.max(r0.y0, bx.y0), x1: Math.min(r0.x1, bx.x1), y1: Math.min(r0.y1, bx.y1) }; }
        if (r0.x1 <= r0.x0 || r0.y1 <= r0.y0) return { paths: [], evenodd: false, exact: true };
        return { paths: ['M ' + fmt(r0.x0) + ' ' + fmt(r0.y0) + ' L ' + fmt(r0.x1) + ' ' + fmt(r0.y0) + ' L ' + fmt(r0.x1) + ' ' + fmt(r0.y1) + ' L ' + fmt(r0.x0) + ' ' + fmt(r0.y1) + ' Z'], evenodd: false, exact: true };
      }
      var kept = [], held = true, cb = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
      for (i = 0; i < rects.length; i++) { var rb = boxes[rects[i]]; cb = { x0: Math.max(cb.x0, rb.x0), y0: Math.max(cb.y0, rb.y0), x1: Math.min(cb.x1, rb.x1), y1: Math.min(cb.y1, rb.y1) }; }
      for (i = 0; i < shapes.length; i++) {
        kept.push(paths[shapes[i]]);
        if (!inside(boxes[shapes[i]], cb)) held = false;
      }
      // artwork reaching past the rectangle is clipped to it where the clip can be drawn
      return { paths: kept, evenodd: false, exact: kept.length === 1, clip: held ? null : [cb.x0, cb.y0, cb.x1, cb.y1] };
    }
    return { paths: paths, evenodd: false, exact: false };
  }
  // Shape contents: paths collected so far are drawn by every fill and stroke
  // below them, as in After Effects.
  function shapeItems(group, m, opacity, out, warn, ctx, gname) {
    var paths = [], mergeRule = false, mergeClip = null;
    for (var i = 1; i <= group.numProperties; i++) {
      var p = group.property(i);
      if (!p.enabled) continue;
      var mn = p.matchName;
      if (mn === 'ADBE Vector Group') {
        var sub = p.property('ADBE Vectors Group');
        var gm = mMul(m, groupMatrix(p));
        var gop = opacity * (val(p.property('ADBE Vector Transform Group'), 'ADBE Vector Group Opacity', 100) / 100);
        var inner = shapeItems(sub, gm, gop, out, warn, ctx, p.name);
        paths = paths.concat(inner);
      } else if (mn === 'ADBE Vector Shape - Rect') {
        paths.push(rectPath(val(p, 'ADBE Vector Rect Size', [0, 0]), val(p, 'ADBE Vector Rect Position', [0, 0]), val(p, 'ADBE Vector Rect Roundness', 0), m));
      } else if (mn === 'ADBE Vector Shape - Star') {
        paths.push(starPath(p, m, warn));
      } else if (mn === 'ADBE Vector Shape - Ellipse') {
        paths.push(ellipsePath(val(p, 'ADBE Vector Ellipse Size', [0, 0]), val(p, 'ADBE Vector Ellipse Position', [0, 0]), m));
      } else if (mn === 'ADBE Vector Shape - Group') {
        var sh = val(p, 'ADBE Vector Shape', null);
        if (sh) paths.push(pathData(sh.vertices, sh.inTangents, sh.outTangents, sh.closed, m));
      } else if (mn === 'ADBE Vector Graphic - Fill' || mn === 'ADBE Vector Graphic - G-Fill') {
        if (!paths.length) continue;
        var item = { kind: 'vector', name: gname || 'Fill', paths: paths.slice(0), evenodd: mergeRule || val(p, 'ADBE Vector Fill Rule', 1) === 2, opacity: opacity };
        if (mergeClip) item.clip = mergeClip;
        if (mn === 'ADBE Vector Graphic - Fill') item.fill = col255(val(p, 'ADBE Vector Fill Color', [0.5, 0.5, 0.5]));
        else item.fillGradient = gradientOf(p, m, ctx, warn);
        item.fillOpacity = val(p, 'ADBE Vector Fill Opacity', 100) / 100;
        // a stroke drawn over a fill of the same path becomes one Figma layer, as Figma draws strokes over fills
        var top = out[0];
        if (top && top.kind === 'vector' && !top.fill && !top.fillGradient && (top.stroke || top.strokeGradient) && top.opacity === opacity && top.paths.join(' ') === item.paths.join(' ')) {
          top.fill = item.fill; top.fillGradient = item.fillGradient; top.fillOpacity = item.fillOpacity; top.evenodd = item.evenodd; top.name = item.name;
        } else out.unshift(item);
      } else if (mn === 'ADBE Vector Graphic - Stroke' || mn === 'ADBE Vector Graphic - G-Stroke') {
        if (!paths.length) continue;
        var sw = val(p, 'ADBE Vector Stroke Width', 1) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        var st = { kind: 'vector', name: gname || 'Stroke', paths: paths.slice(0), strokeWidth: sw, opacity: opacity };
        if (mergeClip) st.clip = mergeClip;
        if (mn === 'ADBE Vector Graphic - Stroke') st.stroke = col255(val(p, 'ADBE Vector Stroke Color', [0, 0, 0]));
        else st.strokeGradient = gradientOf(p, m, ctx, warn);
        st.strokeOpacity = val(p, 'ADBE Vector Stroke Opacity', 100) / 100;
        var cap = val(p, 'ADBE Vector Stroke Line Cap', 1), join = val(p, 'ADBE Vector Stroke Line Join', 1);
        st.cap = cap === 2 ? 'ROUND' : (cap === 3 ? 'SQUARE' : 'NONE');
        st.join = join === 2 ? 'ROUND' : (join === 3 ? 'BEVEL' : 'MITER');
        try {
          // every dash slot answers to scripts, added or not. Only added ones take
          // expressions, which is how they are told apart.
          var dg = p.property('ADBE Vector Stroke Dashes'), dl = [], dk = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
          var added = function (pr) { try { return !!(pr && pr.canSetExpression); } catch (eC) { return false; } };
          for (var q = 1; q <= 3 && dg; q++) {
            var dp = dg.property('ADBE Vector Stroke Dash ' + q), gp = dg.property('ADBE Vector Stroke Gap ' + q);
            if (!added(dp)) break;
            dl.push(dp.valueAtTime(0, false) * dk);
            dl.push(added(gp) ? gp.valueAtTime(0, false) * dk : dl[dl.length - 1]);
          }
          if (dl.length) st.dashes = dl;
        } catch (eD) {}
        out.unshift(st);
      } else if (mn === 'ADBE Vector Filter - Merge') {
        // Merge Paths turns the paths above it into one. The common cases are drawn
        // with a fill rule; an intersect with a plain rectangle is how clipping comes in
        var mg = mergePaths(paths, val(p, 'ADBE Vector Merge Type', 2));
        if (!mg.exact) warn['Path operations such as Merge Paths or Offset Paths are left out in Figma.'] = true;
        paths = mg.paths.length ? [mg.paths.join(' ')] : [];
        mergeRule = mg.evenodd;
        mergeClip = mg.clip || null;
      } else if (mn.indexOf('ADBE Vector Filter') === 0) {
        warn['Path operations such as Merge Paths or Offset Paths are left out in Figma.'] = true;
      }
    }
    return paths;
  }
  // gradient direction comes from the shape, colours from what LayerBoat kept
  function gradientOf(p, m, ctx, warn) {
    var stops = ctx.grads[propKey(p)];
    if (!stops) { warn['Gradients made in After Effects come into Figma grey, since scripts cannot read gradient colours.'] = true; stops = [{ pos: 0, color: [0.5, 0.5, 0.5, 1] }, { pos: 1, color: [0.5, 0.5, 0.5, 1] }]; }
    return { type: val(p, 'ADBE Vector Grad Type', 1) === 2 ? 'RADIAL' : 'LINEAR', start: mApply(m, val(p, 'ADBE Vector Grad Start Pt', [0, 0])), end: mApply(m, val(p, 'ADBE Vector Grad End Pt', [100, 0])), stops: stops };
  }

  // runs of differing font, size or colour, read on After Effects 2024.3 and newer
  function textRuns(td, k) {
    if (typeof td.characterRange !== 'function') return null;
    var runs = [], text = td.text, last = null;
    try {
      for (var i = 0; i < text.length; i++) {
        var cr = td.characterRange(i, i + 1);
        var fill = cr.applyFill ? col255(cr.fillColor) : null;
        var tr = 0; try { tr = cr.tracking; } catch (eT) {}
        var key = cr.font + '|' + cr.fontSize + '|' + (fill ? fill.join(',') : 'none') + '|' + tr;
        if (last && last.key === key) { last.end = i + 1; continue; }
        var fam = null, sty = null;
        try { var f = app.fonts.getFontsByPostScriptName(cr.font); if (f && f.length) { fam = f[0].familyName; sty = f[0].styleName; } } catch (e1) {}
        last = { key: key, start: i, end: i + 1, family: fam, style: sty, size: cr.fontSize * k, color: fill, tracking: tr };
        runs.push(last);
      }
    } catch (e) { return null; }
    // characters After Effects drew with a fallback font go back to the font around them, as Figma falls back on its own
    var isFallback = function (rn) { for (var q = 0; q < FALLBACK_FAMILIES.length; q++) if (rn.family === FALLBACK_FAMILIES[q]) return true; return false; };
    for (var r = 0; r < runs.length; r++) {
      if (!isFallback(runs[r])) continue;
      var nb = runs[r + 1] && !isFallback(runs[r + 1]) ? runs[r + 1] : (runs[r - 1] && !isFallback(runs[r - 1]) ? runs[r - 1] : null);
      if (nb) { runs[r].family = nb.family; runs[r].style = nb.style; }
    }
    if (runs.length < 2) return null;
    for (r = 0; r < runs.length; r++) delete runs[r].key;
    return runs;
  }
  // a Gradient Ramp on a text layer is how LayerBoat draws gradient text
  function rampOf(L) {
    var fx = L.property('ADBE Effect Parade');
    for (var i = 1; fx && i <= fx.numProperties; i++) {
      var e = fx.property(i);
      if (e.matchName !== 'ADBE Ramp' || !e.enabled) continue;
      var c0 = e.property(2).valueAtTime(0, false), c1 = e.property(4).valueAtTime(0, false);
      return { type: e.property(5).valueAtTime(0, false) === 2 ? 'RADIAL' : 'LINEAR', start: e.property(1).valueAtTime(0, false), end: e.property(3).valueAtTime(0, false),
        stops: [{ pos: 0, color: [c0[0], c0[1], c0[2], 1] }, { pos: 1, color: [c1[0], c1[1], c1[2], 1] }] };
    }
    return null;
  }
  // Draws a footage item (a Photoshop layer, a TIFF, a video frame) to a PNG through a
  // throwaway comp, and gives back the PNG as base64.
  function footageToPng(item) {
    var tmp = null, out = null;
    try {
      var w = Math.max(4, Math.round(item.width)), h = Math.max(4, Math.round(item.height));
      tmp = app.project.items.addComp('LayerBoat temp', w, h, 1, 1, 30);
      tmp.layers.add(item);
      var file = new File(Folder.temp.fsName + '/layerboat-footage-' + item.id + '-' + new Date().getTime() + '.png');
      if (typeof tmp.saveFrameToPng !== 'function') return null;
      tmp.saveFrameToPng(0, file);
      // the PNG is written in the background; wait until it is complete
      var last = -1;
      for (var i = 0; i < 80; i++) {
        if (file.exists && file.length > 0 && file.length === last) break;
        last = file.exists ? file.length : -1;
        $.sleep(100);
      }
      if (file.exists && file.length > 0) {
        out = base64OfFile(file);
        try { file.remove(); } catch (eR) {}
      }
    } catch (e) { log('footage to png failed: ' + errText(e)); out = null; }
    finally { try { if (tmp) tmp.remove(); } catch (eT) {} }
    return out;
  }
  function exportLayer(L, out, warn, images) {
    if (!L.enabled || L.guideLayer || L.nullLayer) return;
    try { if (L.isTrackMatte) return; } catch (e0) {}
    var m = layerMatrix(L);
    var op = val(L.property('ADBE Transform Group'), 'ADBE Opacity', 100) / 100;
    try { if (L.threeDLayer) warn['3D layers come in flat.'] = true; } catch (e3) {}
    if (L instanceof ShapeLayer) {
      var items = [];
      shapeItems(L.property('ADBE Root Vectors Group'), m, 1, items, warn, { grads: gradientStore(L).map }, null);
      if (items.length === 1) { items[0].name = L.name; items[0].opacity *= op; out.push(items[0]); }
      else if (items.length) out.push({ kind: 'group', name: L.name, opacity: op, children: items });
    } else if (L instanceof TextLayer) {
      var td = L.property('ADBE Text Properties').property('ADBE Text Document').valueAtTime(0, false);
      var r = L.sourceRectAtTime(0, false);
      var tl = mApply(m, [r.left, r.top]), ax = mVec(m, [1, 0]);
      var t = { kind: 'text', name: L.name, text: td.text, family: td.fontFamily, style: td.fontStyle, size: td.fontSize * Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1]),
        color: td.applyFill ? col255(td.fillColor) : null, tracking: td.tracking, leading: td.autoLeading ? 0 : td.leading,
        align: td.justification === ParagraphJustification.CENTER_JUSTIFY ? 'CENTER' : (td.justification === ParagraphJustification.RIGHT_JUSTIFY ? 'RIGHT' : 'LEFT'),
        x: tl[0], y: tl[1], width: r.width, rotation: Math.atan2(ax[1], ax[0]) * 180 / Math.PI, opacity: op, box: !!td.boxText };
      if (td.boxText) { try { t.boxWidth = td.boxTextSize[0] * Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1]); } catch (eB) {} }
      t.fillGradient = rampOf(L);
      t.runs = textRuns(td, t.size / Math.max(0.01, td.fontSize));
      if (t.runs) { t.family = t.runs[0].family || t.family; t.style = t.runs[0].style || t.style; }
      if (td.applyStroke) { t.stroke = col255(td.strokeColor); t.strokeWidth = td.strokeWidth * Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1]); }
      // for Illustrator, which makes the text itself: sizes in the layer's own space,
      // and the layer's matrix to place it
      t.m = m; t.k = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1]); t.fontSize = td.fontSize; t.layerLeading = td.autoLeading ? 0 : td.leading;
      if (td.boxText) { try { t.boxRect = [td.boxTextPos[0], td.boxTextPos[1], td.boxTextSize[0], td.boxTextSize[1]]; } catch (eBx) {} }
      // the font's PostScript name and where the first line sits
      t.ps = td.font;
      t.origin = mApply(m, [0, 0]);
      t.scaleY = Math.sqrt(Math.pow(mVec(m, [0, 1])[0], 2) + Math.pow(mVec(m, [0, 1])[1], 2)) / Math.max(0.0001, Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1]));
      try { var bl = td.baselineLocs; if (bl && bl.length >= 4) { t.lineStarts = []; for (var bi = 0; bi + 1 < bl.length; bi += 4) t.lineStarts.push(mApply(m, [bl[bi], bl[bi + 1]])); } } catch (eBl) {}
      if (t.runs) { try { for (var ri = 0; ri < t.runs.length; ri++) t.runs[ri].ps = td.characterRange(t.runs[ri].start, t.runs[ri].start + 1).font; } catch (ePs) {} }
      out.push(t);
    } else if (L.source instanceof CompItem) {
      var kids = [];
      exportComp(L.source, kids, warn, images);
      var o = mApply(m, [0, 0]), ux = mVec(m, [1, 0]);
      out.push({ kind: 'frame', name: L.name, x: o[0], y: o[1], width: L.source.width, height: L.source.height, rotation: Math.atan2(ux[1], ux[0]) * 180 / Math.PI,
        scale: Math.sqrt(ux[0] * ux[0] + ux[1] * ux[1]), opacity: op, children: kids });
    } else if (L.source && L.source.mainSource instanceof SolidSource) {
      if (L.adjustmentLayer) { warn['Adjustment layers are left out.'] = true; return; }
      var w = L.source.width, h = L.source.height;
      out.push({ kind: 'vector', name: L.name, paths: [rectPath([w, h], [w / 2, h / 2], 0, m)], fill: col255(L.source.mainSource.color), fillOpacity: 1, opacity: op });
    } else if (L.source && L.source.mainSource instanceof FileSource) {
      var f = L.source.mainSource.file, key;
      if (f && /\.(png|jpe?g|gif)$/i.test(f.name)) {
        key = f.fsName;
        if (!images[key]) images[key] = base64OfFile(f);
      } else {
        // Photoshop layers, TIFFs, vector files and video frames: After Effects draws
        // them to a PNG first, so they arrive as images
        key = 'footage-' + L.source.id + '.png';
        if (!images[key]) {
          var png = footageToPng(L.source);
          if (!png) { warn['Some footage could not be sent.'] = true; return; }
          images[key] = png;
        }
      }
      var o2 = mApply(m, [0, 0]), u2 = mVec(m, [1, 0]), v2 = mVec(m, [0, 1]);
      out.push({ kind: 'image', name: L.name, image: key, x: o2[0], y: o2[1], width: L.source.width * Math.sqrt(u2[0] * u2[0] + u2[1] * u2[1]),
        height: L.source.height * Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]), rotation: Math.atan2(u2[1], u2[0]) * 180 / Math.PI, opacity: op });
    }
    var fx = L.property('ADBE Effect Parade');
    for (var fi = 1; fx && fi <= fx.numProperties; fi++) if (fx.property(fi).enabled && !(fx.property(fi).matchName === 'ADBE Ramp' && L instanceof TextLayer)) { warn['Effects are left out in Figma.'] = true; break; }
  }
  // Layers parented to a null or to a frame's background come into Figma
  // grouped under it, so the Figma layer tree follows the After Effects one.
  function exportComp(comp, out, warn, images, only) {
    var n = comp.numLayers, items = {}, kids = {}, roots = [], i;
    for (i = n; i >= 1; i--) {
      var L = comp.layer(i);
      if (only && !only[L.index]) continue;
      items[i] = [];
      try { exportLayer(L, items[i], warn, images); } catch (e) { warn['Some layers could not be sent.'] = true; log('to figma failed on ' + L.name + ': ' + errText(e)); }
    }
    for (i = n; i >= 1; i--) {
      if (!items[i]) continue;
      var P = comp.layer(i).parent;
      while (P && !items[P.index]) P = P.parent;
      if (P) (kids[P.index] = kids[P.index] || []).push(i);
      else roots.push(i);
    }
    function emit(j, into) {
      if (!kids[j]) { for (var a = 0; a < items[j].length; a++) into.push(items[j][a]); return; }
      var members = kids[j].concat([j]).sort(function (x, y) { return y - x; }), ch = [];
      for (var m = 0; m < members.length; m++) {
        if (members[m] === j) { for (var b = 0; b < items[j].length; b++) ch.push(items[j][b]); } else emit(members[m], ch);
      }
      if (ch.length === 1) { into.push(ch[0]); return; }
      var L2 = comp.layer(j), name = L2.name.replace(/ background$/, '');
      if (ch.length) into.push({ kind: 'group', name: name, opacity: 1, children: ch });
    }
    for (i = 0; i < roots.length; i++) emit(roots[i], out);
  }
  function sendToFigma() {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return 'Open a comp first.';
    var only = selectionOnly(comp);
    var warn = {}, images = {}, layers = [];
    exportComp(comp, layers, warn, images, only);
    var payload = { bridge: 'ae-to-figma', version: 1, name: comp.name, width: comp.width, height: comp.height, background: null, layers: layers, warnings: [] };
    for (var w in warn) if (warn.hasOwnProperty(w)) payload.warnings.push(w);
    if (!relayRunning() && !startRelay()) return 'Could not start the LayerBoat relay.';
    var ping = httpGet('/ping?from=ae');
    // the images are base64, which needs no escaping, so they are joined in as they are
    // instead of going through After Effects' slow JSON.stringify
    var imgParts = [];
    for (var ik in images) if (images.hasOwnProperty(ik) && images[ik]) imgParts.push(asciiJSON(ik) + ':"' + images[ik] + '"');
    var body = asciiJSON(payload);
    body = body.substring(0, body.length - 1) + ',"images":{' + imgParts.join(',') + '}}';
    if (HOME && Folder(HOME + '/dev/dumps').exists) { try { var df = new File(HOME + '/dev/dumps/to-figma.json'); df.open('w'); df.write(body); df.close(); } catch (eD) {} }
    var r = httpPost('/send?to=figma', body);
    if (!r || r.status !== 200) return 'Could not reach the LayerBoat relay.';
    var waiting = ping && ping.body.indexOf('figma-connected') < 0;
    return 'Sent ' + layers.length + ' layers to Figma.' + (waiting ? ' Open the LayerBoat plugin in Figma to receive them.' : '');
  }

  // ---------- After Effects to Illustrator ----------
  // The comp is described the same way as for Figma, then written out as SVG,
  // which Illustrator opens with its own importer: layers stay separate, text stays
  // live, and every layer keeps its name.
  function selectionOnly(comp) {
    if (!comp.selectedLayers.length) return null;
    var only = {}, sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i++) {
      only[sel[i].index] = true;
      // a selected parent brings its children along
      for (var j = 1; j <= comp.numLayers; j++) { var q = comp.layer(j).parent; while (q) { if (q === sel[i]) { only[j] = true; break; } q = q.parent; } }
    }
    return only;
  }
  function xmlText(t) {
    return String(t).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
  }
  function svgNum(n) { return String(Math.round(n * 1000) / 1000); }
  function svgColor(c) {
    function h(v) { var x = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return x.length < 2 ? '0' + x : x; }
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }
  // Illustrator names each layer after its id, and changes spaces and the like on the
  // way. So every layer gets a short id, and its real name rides along in data-name.
  // The importer puts the real names back.
  function svgWriter() {
    var n = 0;
    var w = { defs: [], clip: 0, paint: 0, texts: {} };
    w.attrs = function (name) { n++; return ' id="bn' + n + '" data-name="' + xmlText(name || 'Layer') + '"'; };
    return w;
  }
  function svgPaint(w, g) {
    var id = 'paint' + (w.paint++), stops = '';
    for (var i = 0; i < g.stops.length; i++) {
      var st = g.stops[i], a = (st.color.length > 3 ? st.color[3] : 1);
      stops += '<stop offset="' + svgNum(st.pos) + '" stop-color="' + svgColor(st.color) + '"' + (a < 1 ? ' stop-opacity="' + svgNum(a) + '"' : '') + '/>';
    }
    if (g.type === 'RADIAL') {
      var dx = g.end[0] - g.start[0], dy = g.end[1] - g.start[1];
      w.defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + svgNum(g.start[0]) + '" cy="' + svgNum(g.start[1]) + '" r="' + svgNum(Math.max(0.01, Math.sqrt(dx * dx + dy * dy))) + '">' + stops + '</radialGradient>');
    } else {
      w.defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + svgNum(g.start[0]) + '" y1="' + svgNum(g.start[1]) + '" x2="' + svgNum(g.end[0]) + '" y2="' + svgNum(g.end[1]) + '">' + stops + '</linearGradient>');
    }
    return 'url(#' + id + ')';
  }
  function svgOpacity(o) { return o !== undefined && o < 0.999 ? ' opacity="' + svgNum(Math.max(0, o)) + '"' : ''; }
  function svgVector(w, it) {
    var a = w.attrs(it.name);
    if (it.fill) a += ' fill="' + svgColor(it.fill) + '"';
    else if (it.fillGradient) a += ' fill="' + svgPaint(w, it.fillGradient) + '"';
    else a += ' fill="none"';
    if ((it.fill || it.fillGradient) && it.fillOpacity !== undefined && it.fillOpacity < 0.999) a += ' fill-opacity="' + svgNum(it.fillOpacity) + '"';
    if (it.evenodd) a += ' fill-rule="evenodd"';
    if (it.stroke || it.strokeGradient) {
      a += ' stroke="' + (it.stroke ? svgColor(it.stroke) : svgPaint(w, it.strokeGradient)) + '" stroke-width="' + svgNum(it.strokeWidth || 1) + '"';
      if (it.strokeOpacity !== undefined && it.strokeOpacity < 0.999) a += ' stroke-opacity="' + svgNum(it.strokeOpacity) + '"';
      a += ' stroke-linecap="' + (it.cap === 'ROUND' ? 'round' : (it.cap === 'SQUARE' ? 'square' : 'butt')) + '"';
      a += ' stroke-linejoin="' + (it.join === 'ROUND' ? 'round' : (it.join === 'BEVEL' ? 'bevel' : 'miter')) + '"';
      if (it.dashes && it.dashes.length) { var ds = []; for (var d = 0; d < it.dashes.length; d++) ds.push(svgNum(it.dashes[d])); a += ' stroke-dasharray="' + ds.join(' ') + '"'; }
    }
    a += svgOpacity(it.opacity);
    var dd = [];
    for (var i = 0; i < it.paths.length; i++) if (it.paths[i]) dd.push(it.paths[i]);
    if (!dd.length) return '';
    var el = '<path' + a + ' d="' + dd.join(' ') + '"/>';
    if (!it.clip) return el;
    var cid = 'clip' + (w.clip++), c = it.clip;
    w.defs.push('<clipPath id="' + cid + '"><rect x="' + svgNum(c[0]) + '" y="' + svgNum(c[1]) + '" width="' + svgNum(c[2] - c[0]) + '" height="' + svgNum(c[3] - c[1]) + '"/></clipPath>');
    return '<g clip-path="url(#' + cid + ')">' + el + '</g>';
  }
  // Text is made by Illustrator itself, so it stays one editable text object with
  // its fonts, runs, alignment and paragraph box. The drawing holds a square in the
  // text layer's own space, which tells the importer where the text goes and how it
  // is turned and scaled. The text itself travels in a note beside the drawing.
  function svgText(w, t) {
    var k = t.k || 1, m = t.m;
    if (!m) { var rr = (t.rotation || 0) * Math.PI / 180, o = t.origin || [t.x, t.y]; m = [Math.cos(rr) * k, Math.sin(rr) * k, -Math.sin(rr) * k, Math.cos(rr) * k, o[0], o[1]]; }
    var text = String(t.text || ''), lines = [], cur = [], i;
    var base = { ps: t.ps || t.family, size: t.fontSize || (t.size / k), color: t.color, tracking: t.tracking || 0 };
    function runAt(ix) {
      if (!t.runs) return base;
      for (var q = 0; q < t.runs.length; q++) if (ix >= t.runs[q].start && ix < t.runs[q].end) {
        var rn = t.runs[q];
        return { ps: rn.ps || rn.family || base.ps, size: (rn.size || t.size) / k, color: rn.color || base.color, tracking: rn.tracking || 0 };
      }
      return base;
    }
    var last = null;
    for (i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '\r' || ch === '\n' || ch === '\u0003') { lines.push(cur); cur = []; last = null; continue; }
      var st = runAt(i);
      var sk = st.ps + '|' + st.size + '|' + String(st.color) + '|' + st.tracking;
      if (last && last.key === sk) { last.text += ch; continue; }
      last = { text: ch, style: st, key: sk };
      cur.push(last);
    }
    lines.push(cur);
    var outLines = [];
    for (i = 0; i < lines.length; i++) {
      var runs = [];
      for (var j = 0; j < lines[i].length; j++) {
        var sty = lines[i][j].style;
        runs.push({ text: lines[i][j].text, ps: sty.ps, size: sty.size, color: sty.color, tracking: sty.tracking });
      }
      outLines.push(runs);
    }
    var id = w.attrs(t.name), key = id.substring(5, id.indexOf('"', 5));
    w.texts[key] = { lines: outLines, align: t.align || 'LEFT', leading: t.layerLeading || 0, box: t.boxRect || null, opacity: t.opacity === undefined ? 1 : t.opacity,
      stroke: t.stroke || null, strokeWidth: t.stroke ? (t.strokeWidth || 1) / k : 0 };
    var c0 = mApply(m, [0, 0]), c1 = mApply(m, [100, 0]), c2 = mApply(m, [100, 100]), c3 = mApply(m, [0, 100]);
    return '<path' + id + ' fill="none" stroke="none" d="M ' + svgNum(c0[0]) + ' ' + svgNum(c0[1]) + ' L ' + svgNum(c1[0]) + ' ' + svgNum(c1[1]) + ' L ' + svgNum(c2[0]) + ' ' + svgNum(c2[1]) + ' L ' + svgNum(c3[0]) + ' ' + svgNum(c3[1]) + ' Z"/>';
  }
  function svgImage(w, it, images) {
    var b64 = images[it.image];
    if (!b64) return '';
    var mime = /\.jpe?g$/i.test(it.image) ? 'image/jpeg' : (/\.gif$/i.test(it.image) ? 'image/gif' : 'image/png');
    var r = (it.rotation || 0);
    return '<image' + w.attrs(it.name) + ' width="' + svgNum(it.width) + '" height="' + svgNum(it.height) + '" transform="translate(' + svgNum(it.x) + ' ' + svgNum(it.y) + ')' + (r ? ' rotate(' + svgNum(r) + ')' : '') + '"' +
      svgOpacity(it.opacity) + ' preserveAspectRatio="none" xlink:href="data:' + mime + ';base64,' + b64 + '"/>';
  }
  function svgItems(w, list, images) {
    var out = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.kind === 'vector') out += svgVector(w, it);
      else if (it.kind === 'text') out += svgText(w, it);
      else if (it.kind === 'image') out += svgImage(w, it, images);
      else if (it.kind === 'group') out += '<g' + w.attrs(it.name) + svgOpacity(it.opacity) + '>' + svgItems(w, it.children || [], images) + '</g>';
      else if (it.kind === 'frame') {
        // a precomp is clipped to its own size, as After Effects shows it
        var cid = 'clip' + (w.clip++);
        w.defs.push('<clipPath id="' + cid + '"><rect width="' + svgNum(it.width) + '" height="' + svgNum(it.height) + '"/></clipPath>');
        var s = it.scale || 1, r = it.rotation || 0;
        out += '<g' + w.attrs(it.name) + ' transform="translate(' + svgNum(it.x) + ' ' + svgNum(it.y) + ')' + (r ? ' rotate(' + svgNum(r) + ')' : '') + (Math.abs(s - 1) > 0.0001 ? ' scale(' + svgNum(s) + ')' : '') + '"' + svgOpacity(it.opacity) + '>' +
          '<g clip-path="url(#' + cid + ')">' + svgItems(w, it.children || [], images) + '</g></g>';
      }
    }
    return out;
  }
  function compSvg(comp, layers, images) {
    var w = svgWriter();
    var body = svgItems(w, layers, images);
    // the comp is clipped to its own size; Illustrator lines that clipping path up with the artboard
    w.defs.push('<clipPath id="clip' + (w.clip++) + '"><rect width="' + comp.width + '" height="' + comp.height + '"/></clipPath>');
    var rootClip = 'clip' + (w.clip - 1);
    var note = '', any = false;
    for (var tk in w.texts) if (w.texts.hasOwnProperty(tk)) { any = true; break; }
    if (any) note = '<!-- bridge-text:' + encodeURIComponent(asciiJSON(w.texts)) + ' -->';
    return note + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + comp.width + '" height="' + comp.height + '" viewBox="0 0 ' + comp.width + ' ' + comp.height + '">' +
      '<defs>' + w.defs.join('') + '</defs><g clip-path="url(#' + rootClip + ')">' + body + '</g></svg>';
  }
  function panelMessage(text) {
    try {
      var box = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');
      box.encoding = 'UTF-8'; box.open('w');
      box.write(asciiJSON({ bridge: 'figma-to-ae', source: 'illustrator', message: text, layers: [] }));
      box.close();
    } catch (eW) {}
  }
  // The copy of an app that is actually running. With two years installed, a plain
  // name means the newest one, which may not be the one that is open.
  function runningTarget(name) {
    if (typeof BridgeTalk === 'undefined') return null;
    try { if (BridgeTalk.isRunning(name)) return name; } catch (e0) {}
    for (var v = 40; v >= 20; v--) {
      var spec = null;
      try { spec = BridgeTalk.getSpecifier(name, String(v)); } catch (e1) {}
      if (!spec) continue;
      try { if (BridgeTalk.isRunning(spec)) return spec; } catch (e2) {}
    }
    return null;
  }
  var AI_IMPORT_SRC = null;
  function setIllustratorImportSource(src) { AI_IMPORT_SRC = src; }
  function sendToIllustrator() {
    var comp = activeComp();
    if (!comp) return 'Open a comp first.';
    if (typeof BridgeTalk === 'undefined') return 'This version of After Effects cannot talk to Illustrator.';
    if (!AI_IMPORT_SRC) return 'The Illustrator part of LayerBoat is missing. Run the installer again.';
    if (!runningTarget('illustrator')) return 'Open Illustrator first.';
    var warn = {}, images = {}, layers = [];
    exportComp(comp, layers, warn, images, selectionOnly(comp));
    if (!layers.length) return 'Nothing in this comp can go to Illustrator. Shape, text, solid, image and precomp layers can.';
    var svg = '<!-- bridge:' + encodeURIComponent(comp.name) + ':' + comp.id + ' -->' + compSvg(comp, layers, images);
    var home = Folder.userData.fsName + '/LayerBoat';
    if (!Folder(home).exists) Folder(home).create();
    var f = new File(home + '/from-figma.svg');
    f.encoding = 'UTF-8';
    if (!f.open('w')) return 'LayerBoat could not write its file.';
    f.write(svg); f.close();
    if (HOME && Folder(HOME + '/dev/dumps').exists) { try { var df = new File(HOME + '/dev/dumps/to-illustrator.svg'); df.encoding = 'UTF-8'; df.open('w'); df.write(svg); df.close(); } catch (eD) {} }
    var notes = [];
    for (var k in warn) if (warn.hasOwnProperty(k)) notes.push(k.split('Figma').join('Illustrator'));
    var bt = new BridgeTalk();
    bt.target = runningTarget('illustrator') || 'illustrator';
    bt.body = AI_IMPORT_SRC + '\nLayerBoatAI_import({ wait: 0 });';
    // Illustrator's answer is shown in the panel through the live inbox
    bt.onResult = function (m) {
      log('illustrator import: ' + m.body);
      var b = String(m.body);
      if (b.indexOf('OK ') === 0) panelMessage('In Illustrator now: ' + b.substring(3));
      else if (b.indexOf('ERR ') === 0) panelMessage('Illustrator could not bring it in: ' + b.substring(4));
    };
    bt.onError = function (m) { log('illustrator import error: ' + m.body); panelMessage('Illustrator could not bring it in: ' + m.body); };
    try { BridgeTalk.bringToFront(runningTarget('illustrator') || 'illustrator'); } catch (eB) {}
    bt.send();
    return 'Sent ' + layers.length + ' layers to Illustrator.' + (notes.length ? ' ' + notes.join(' ') : '');
  }

  // ---------- Illustrator ----------
  // The panel sends LayerBoat's Illustrator script to Illustrator through
  // BridgeTalk. It describes the selection, or the active artboard, the same
  // way the Figma plugin does, so the same builder makes the layers.
  var AI_SRC = null;
  function setIllustratorSource(src) { AI_SRC = src; }
  // Asks Illustrator for its artwork. Illustrator posts it to the relay and the
  // live panel builds it, so After Effects never sits waiting on Illustrator.
  function fromIllustrator() {
    if (typeof BridgeTalk === 'undefined') return 'This version of After Effects cannot talk to Illustrator.';
    if (!AI_SRC) return 'The Illustrator part of LayerBoat is missing. Run the installer again.';
    if (!runningTarget('illustrator')) return 'Open Illustrator with your artwork first.';
    var status = '';
    try { status = BridgeTalk.getStatus('illustrator'); } catch (eS) {}
    if (status === 'BUSY') return 'Illustrator is busy. Try again when it is idle.';
    // Illustrator only saves files at full speed while it is the front app. In the
    // background, saving the shape file can stall for minutes. So Illustrator comes
    // forward while it works, and hands the screen back to After Effects when done.
    var aiFront = $.global.__bridgeAiFront !== false;
    var aiOpts = { post: true, returnTo: aiFront ? 'aftereffects' : null };
    if (HOME && Folder(HOME + '/dev/dumps').exists) { aiOpts.log = HOME + '/dev/dumps/ai-log.txt'; aiOpts.dump = HOME + '/dev/dumps/ai-payload.json'; }
    var bt = new BridgeTalk();
    bt.target = runningTarget('illustrator') || 'illustrator';
    bt.body = AI_SRC + '\nLayerBoatAI_export(' + JSON.stringify(aiOpts) + ');';
    if (aiFront) { try { BridgeTalk.bringToFront(runningTarget('illustrator') || 'illustrator'); } catch (eB) {} }
    // a script error in Illustrator comes back here, and is shown in the panel like any message
    bt.onError = function (m) {
      log('illustrator error: ' + m.body);
      try {
        var box = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');
        box.encoding = 'UTF-8'; box.open('w');
        box.write(JSON.stringify({ bridge: 'figma-to-ae', source: 'illustrator', message: 'Illustrator could not send this: ' + m.body, layers: [] }));
        box.close();
      } catch (eW) {}
    };
    bt.send();
    log('illustrator: asked (status was ' + status + ')');
    return 'Asked Illustrator for the artwork. It appears here when Illustrator is done.';
  }

  // ---------- update from Illustrator ----------
  // The selected paths, fills and strokes in the open comp take the shape and colours
  // of the shape selected in Illustrator. Layers, keyframes and effects stay as they are.
  var UPDATE_KINDS = { 'ADBE Vector Shape': 'path', 'ADBE Vector Fill Color': 'fill', 'ADBE Vector Stroke Color': 'stroke', 'ADBE Vector Stroke Width': 'width' };
  function updateTargets(comp) {
    var out = [], seen = {}, sel = comp.selectedProperties;
    function add(prop) {
      var kind = UPDATE_KINDS[prop.matchName];
      if (!kind) return;
      var key = prop.propertyDepth + ':' + kind + ':' + out.length;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ prop: prop, kind: kind, layer: prop.propertyGroup(prop.propertyDepth) });
    }
    for (var i = 0; i < sel.length; i++) {
      var p = sel[i];
      if (UPDATE_KINDS[p.matchName]) { add(p); continue; }
      // a selected path, fill or stroke group stands for its main property
      if (p.matchName === 'ADBE Vector Shape - Group') add(p.property('ADBE Vector Shape'));
      else if (p.matchName === 'ADBE Vector Graphic - Fill') add(p.property('ADBE Vector Fill Color'));
      else if (p.matchName === 'ADBE Vector Graphic - Stroke') { add(p.property('ADBE Vector Stroke Color')); add(p.property('ADBE Vector Stroke Width')); }
    }
    return out;
  }
  function updateFromIllustrator() {
    var comp = activeComp();
    if (!comp) return 'Open a comp and select a path, fill or stroke on a shape layer first.';
    var targets = updateTargets(comp);
    if (!targets.length) return 'Select a path, fill or stroke on a shape layer first. Twirl the layer open to pick one.';
    if (typeof BridgeTalk === 'undefined' || !runningTarget('illustrator')) return 'Open Illustrator and select a shape there first.';
    if (!AI_SRC) return 'The Illustrator part of LayerBoat is missing. Run the installer again.';
    $.global.__bridgeUpdate = { comp: comp, targets: targets, time: comp.time };
    var bt = new BridgeTalk();
    bt.target = runningTarget('illustrator') || 'illustrator';
    bt.body = AI_SRC + '\nLayerBoatAI_pick();';
    bt.send();
    return 'Asked Illustrator for the selected shape.';
  }
  // ---------- rasterize from Illustrator ----------
  // The selection in Illustrator, or its active artboard, comes in as one image layer,
  // in the open comp or in a new comp the size of the artboard.
  function rasterizeFromIllustrator() {
    if (typeof BridgeTalk === 'undefined' || !runningTarget('illustrator')) return 'Open Illustrator with your artwork first.';
    if (!AI_SRC) return 'The Illustrator part of LayerBoat is missing. Run the installer again.';
    var bt = new BridgeTalk();
    bt.target = runningTarget('illustrator') || 'illustrator';
    bt.body = AI_SRC + '\nLayerBoatAI_rasterize();';
    // Illustrator works at full speed only in front; it hands the screen back when done
    try { BridgeTalk.bringToFront(runningTarget('illustrator') || 'illustrator'); } catch (eB) {}
    bt.send();
    return 'Asked Illustrator for an image of the selection.';
  }
  function placeRaster(r) {
    var footage = fileFootage(r.file);
    if (!footage) return 'The image from Illustrator could not be found.';
    var comp = app.project.activeItem;
    app.beginUndoGroup('Rasterize from Illustrator');
    try {
      if (!(comp instanceof CompItem)) {
        comp = app.project.items.addComp(r.artboardName || 'Illustrator', Math.max(4, Math.round(r.artboard[0])), Math.max(4, Math.round(r.artboard[1])), 1, 10, 30);
        comp.openInViewer();
      }
      var L = comp.layers.add(footage);
      L.name = r.name || 'Illustrator image';
      var sc = footage.width ? r.width / footage.width * 100 : 50;
      var tr = L.property('ADBE Transform Group');
      tr.property('ADBE Scale').setValue([sc, sc]);
      tr.property('ADBE Position').setValue([r.x + r.width / 2, r.y + r.height / 2]);
      L.selected = true;
    } finally { app.endUndoGroup(); }
    return 'Added ' + (r.name || 'the image') + ' as an image layer in ' + comp.name + '.';
  }

  // the inverse of an affine matrix [a, b, c, d, e, f]
  function mInv(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) det = 1e-12;
    var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  // position, rotation and scale about an anchor, as one matrix
  function trsMatrix(pos, anchor, scale, rot) {
    var r = rot * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), sx = scale[0] / 100, sy = scale[1] / 100;
    var m = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0];
    m[4] = pos[0] - (m[0] * anchor[0] + m[2] * anchor[1]);
    m[5] = pos[1] - (m[1] * anchor[0] + m[3] * anchor[1]);
    return m;
  }
  // layer space to comp space at time t, following parents
  function layerMatrixAt(L, t) {
    var tr = L.property('ADBE Transform Group');
    var m = trsMatrix(tr.property('ADBE Position').valueAtTime(t, false), tr.property('ADBE Anchor Point').valueAtTime(t, false),
      tr.property('ADBE Scale').valueAtTime(t, false), tr.property('ADBE Rotate Z').valueAtTime(t, false));
    return L.parent ? mMul(layerMatrixAt(L.parent, t), m) : m;
  }
  // from the comp into the space of a property inside shape groups
  function compToProperty(prop, layer, t) {
    var m = layerMatrixAt(layer, t), groups = [], g = prop.parentProperty;
    while (g && g !== layer) { if (g.matchName === 'ADBE Vector Group') groups.unshift(g); g = g.parentProperty; }
    for (var i = 0; i < groups.length; i++) {
      var tg = groups[i].property('ADBE Vector Transform Group');
      m = mMul(m, trsMatrix(tg.property('ADBE Vector Position').valueAtTime(t, false), tg.property('ADBE Vector Anchor').valueAtTime(t, false),
        tg.property('ADBE Vector Scale').valueAtTime(t, false), tg.property('ADBE Vector Rotation').valueAtTime(t, false)));
    }
    return mInv(m);
  }
  function applyUpdate(u) {
    var job = $.global.__bridgeUpdate;
    $.global.__bridgeUpdate = null;
    if (!job) return 'Illustrator sent a shape, but nothing in After Effects was waiting for it.';
    var done = [], skipped = 0, pathIndex = 0;
    app.beginUndoGroup('Update from Illustrator');
    try {
      for (var i = 0; i < job.targets.length; i++) {
        var tg = job.targets[i], prop = tg.prop, val = null;
        try {
          if (tg.kind === 'path') {
            var src = u.paths && u.paths[pathIndex];
            if (!src) { skipped++; continue; }
            pathIndex++;
            var m = compToProperty(prop, tg.layer, job.time), sh = new Shape(), v = [], ins = [], outs = [];
            for (var k = 0; k < src.v.length; k++) {
              var x = src.v[k][0], y = src.v[k][1];
              v.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
              ins.push([m[0] * src.i[k][0] + m[2] * src.i[k][1], m[1] * src.i[k][0] + m[3] * src.i[k][1]]);
              outs.push([m[0] * src.o[k][0] + m[2] * src.o[k][1], m[1] * src.o[k][0] + m[3] * src.o[k][1]]);
            }
            sh.vertices = v; sh.inTangents = ins; sh.outTangents = outs; sh.closed = !!src.closed;
            val = sh;
          } else if (tg.kind === 'fill') { if (!u.fill) { skipped++; continue; } val = [u.fill[0], u.fill[1], u.fill[2], 1]; }
          else if (tg.kind === 'stroke') { if (!u.stroke) { skipped++; continue; } val = [u.stroke[0], u.stroke[1], u.stroke[2], 1]; }
          else if (tg.kind === 'width') { if (u.width === null || u.width === undefined) { skipped++; continue; } val = u.width; }
          // an animated property gets a keyframe at the current time; the rest change outright
          if (prop.numKeys > 0) prop.setValueAtTime(job.time, val); else prop.setValue(val);
          done.push(tg.kind);
        } catch (eP) { skipped++; log('update ' + tg.kind + ': ' + errText(eP)); }
      }
    } finally { app.endUndoGroup(); }
    var names = { path: 'path', fill: 'fill colour', stroke: 'stroke colour', width: 'stroke width' }, said = {}, list = [];
    for (var d = 0; d < done.length; d++) if (!said[done[d]]) { said[done[d]] = true; list.push(names[done[d]]); }
    var msg = done.length ? 'Updated ' + done.length + ' ' + (done.length === 1 ? 'property' : 'properties') + ' from Illustrator: ' + list.join(', ') + '.' : 'Nothing was updated.';
    if (skipped) msg += ' ' + skipped + ' had nothing to take from the Illustrator shape.';
    return msg;
  }

  // ---------- group tools ----------
  // Small helpers for the panel, working on the selected layers of the open comp.
  function activeComp() { var c = app.project.activeItem; return c instanceof CompItem ? c : null; }
  function childrenOf(comp, P) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i), q = L.parent;
      while (q) { if (q === P) { out.push(L); break; } q = q.parent; }
    }
    return out;
  }
  function selectGroup() {
    var comp = activeComp(); if (!comp || !comp.selectedLayers.length) return 'Select a group layer first.';
    var sel = comp.selectedLayers.slice(0), n = 0;
    for (var i = 0; i < sel.length; i++) { var kids = childrenOf(comp, sel[i]); for (var k = 0; k < kids.length; k++) { kids[k].selected = true; n++; } }
    return 'Selected ' + n + ' layers in the group.';
  }
  function groupToPrecomp() {
    var comp = activeComp(); if (!comp || comp.selectedLayers.length !== 1) return 'Select one group layer first.';
    var P = comp.selectedLayers[0], kids = childrenOf(comp, P);
    if (!kids.length) return 'That layer has nothing parented to it.';
    app.beginUndoGroup('Group to precomp');
    var idx = [P.index];
    for (var i = 0; i < kids.length; i++) idx.push(kids[i].index);
    idx.sort(function (a, b) { return a - b; });
    var name = P.name;
    var pc = comp.layers.precompose(idx, name, true);
    try { pc.parentFolder = precompBin(); pc.comment = ''; } catch (e) {}
    app.endUndoGroup();
    return 'Moved ' + name + ' into its own comp.';
  }
  function releaseGroup() {
    var comp = activeComp(); if (!comp || !comp.selectedLayers.length) return 'Select a group layer first.';
    app.beginUndoGroup('Release group');
    var n = 0, sel = comp.selectedLayers.slice(0);
    for (var i = 0; i < sel.length; i++) {
      var P = sel[i];
      for (var c = 1; c <= comp.numLayers; c++) { var L = comp.layer(c); if (L.parent === P) { L.parent = P.parent; n++; } }
      if (P.nullLayer) P.remove();
    }
    app.endUndoGroup();
    return 'Released ' + n + ' layers.';
  }
  function toggleHelpers() {
    var comp = activeComp(); if (!comp) return 'Open a comp first.';
    comp.hideShyLayers = !comp.hideShyLayers;
    return comp.hideShyLayers ? 'Helper layers hidden.' : 'Helper layers shown.';
  }

  // ---------- live connection ----------
  // After Effects scripts cannot open a listening port, so a tiny relay app
  // sits in between. Figma posts to the relay, and this panel polls it.
  var PORT = 7317;
  var HOME = null;
  function setHome(path) { HOME = path; }

  // Plain HTTP/1.0 GET over a socket. Returns {status, body} or null.
  function httpGet(path) {
    var s = new Socket();
    s.timeout = 3;
    if (!s.open('127.0.0.1:' + PORT, 'BINARY')) return null;
    s.write('GET ' + path + ' HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n');
    var parts = [];
    var guard = 0;
    while (!s.eof && guard < 100000) {
      var chunk = s.read(1048576);
      if (chunk) parts.push(chunk); else guard += 1000;
      guard++;
    }
    s.close();
    var resp = parts.join('');
    var cut = resp.indexOf('\r\n\r\n');
    if (cut < 0) return null;
    var status = parseInt(resp.substring(0, resp.indexOf('\r\n')).split(' ')[1], 10);
    return { status: status, body: resp.substring(cut + 4) };
  }

  function fromBase64(b64) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', code = [], i;
    for (i = 0; i < 256; i++) code.push(-1);
    for (i = 0; i < 64; i++) code[A.charCodeAt(i)] = i;
    var clean = b64.split('\n').join('').split('\r').join('').split(' ').join('');
    var pad = clean.charAt(clean.length - 1) === '=' ? (clean.charAt(clean.length - 2) === '=' ? 2 : 1) : 0;
    var end = clean.length - (pad ? 4 : 0), out = [], part = [], F = String.fromCharCode;
    for (i = 0; i < end; i += 4) {
      var n = (code[clean.charCodeAt(i)] << 18) | (code[clean.charCodeAt(i + 1)] << 12) | (code[clean.charCodeAt(i + 2)] << 6) | code[clean.charCodeAt(i + 3)];
      part.push(F(n >> 16 & 255, n >> 8 & 255, n & 255));
      if (part.length === 8192) { out.push(part.join('')); part = []; }
    }
    if (pad) {
      var a = code[clean.charCodeAt(end)], b = code[clean.charCodeAt(end + 1)];
      var c = pad === 1 ? code[clean.charCodeAt(end + 2)] : 0;
      var m = (a << 18) | (b << 12) | (c << 6);
      part.push(pad === 1 ? F(m >> 16 & 255, m >> 8 & 255) : F(m >> 16 & 255));
    }
    out.push(part.join(''));
    return out.join('');
  }
  function isWindows() { return $.os.toLowerCase().indexOf('windows') !== -1; }
  // The helper from before the rename answers on the same port but saves into the old
  // folder, so it is asked to stop once, and this version's helper starts instead.
  var helperChecked = false;
  // this version's helper checks that everything Figma sends is plain JSON
  var HELPER_ID = 'layerboat-helper 2';
  function relayRunning() {
    var r = httpGet('/ping');
    if (!(r && r.status === 200 && r.body.indexOf('relay') === 0)) return false;
    if (helperChecked) return true;
    var who = httpGet('/who');
    if (who && who.body === HELPER_ID) { helperChecked = true; return true; }
    log('an older helper is running; stopping it');
    httpGet('/quit');
    $.sleep(400);
    return false;
  }

  function startRelay() {
    if (!HOME) return false;
    var bin;
    if (isWindows()) {
      var wa = ($.getenv('PROCESSOR_ARCHITEW6432') || $.getenv('PROCESSOR_ARCHITECTURE') || '').toUpperCase();
      bin = new File(HOME + '/relay/layerboat-helper-windows-' + (wa === 'ARM64' ? 'arm64' : 'amd64') + '.exe');
      if (!bin.exists) { log('relay missing at ' + bin.fsName); return false; }
      // a hidden window that does not wait for the relay to exit
      var vbs = new File(Folder.temp.fsName + '/figma-bridge-start-relay.vbs');
      vbs.encoding = 'UTF-8';
      vbs.open('w');
      vbs.writeln('CreateObject("WScript.Shell").Run """' + bin.fsName + '""", 0, False');
      vbs.close();
      system.callSystem('wscript.exe //B //Nologo "' + vbs.fsName + '"');
    } else {
      var arch = system.callSystem('/usr/bin/uname -m').replace(/\s+/g, '');
      bin = new File(HOME + '/relay/layerboat-helper-' + (arch === 'arm64' ? 'arm64' : 'amd64'));
      if (!bin.exists) { log('relay missing at ' + bin.fsName); return false; }
      var sh = new File(Folder.temp.fsName + '/figma-bridge-start-relay.sh');
      sh.lineFeed = 'Unix';
      sh.encoding = 'UTF-8';
      sh.open('w');
      sh.writeln('#!/bin/sh');
      sh.writeln('chmod +x "' + bin.fsName + '"');
      sh.writeln('xattr -d com.apple.quarantine "' + bin.fsName + '" 2>/dev/null');
      sh.writeln('nohup "' + bin.fsName + '" >/dev/null 2>&1 &');
      sh.close();
      system.callSystem('/bin/sh "' + sh.fsName + '"');
    }
    for (var i = 0; i < 15; i++) {
      $.sleep(200);
      if (relayRunning()) { log('relay started'); return true; }
    }
    log('relay did not start');
    return false;
  }

  // Builds artwork Illustrator left in the inbox, for when the panel is not open to
  // pick it up. Illustrator calls this through BridgeTalk. Uses the panel's saved options.
  function buildInbox() {
    var inbox = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');
    if (!inbox.exists) return 'NONE';
    inbox.encoding = 'UTF-8';
    if (!inbox.open('r')) return 'ERR could not read the artwork';
    var txt = inbox.read(); inbox.close(); inbox.remove();
    var data = parseData(txt, true);
    if (!data) return 'ERR the artwork could not be read';
    if (data.update) return 'OK ' + applyUpdate(data.update);
    if (data.raster) return 'OK ' + placeRaster(data.raster);
    if (!(data.layers && data.layers.length)) return 'OK ' + (data.message || '');
    function opt(key, dflt) { try { if (app.settings.haveSetting('LayerBoat', key)) return app.settings.getSetting('LayerBoat', key) === '1'; } catch (e) {} return dflt; }
    build(data, { intoActive: opt('intoActive', false), nulls: opt('nulls', true), combine: opt('combine', true), update: opt('update', true), centerAnchors: opt('centre', true) });
    return 'OK ' + (LayerBoatCore.lastStatus || 'Done.');
  }
  function listen(onData, onStatus) {
    var G = $.global;
    if (typeof Socket === 'undefined') { onStatus('Live mode is not available here. Use Copy and Paste.'); return false; }
    // stop any earlier live loop first
    G.__figmaBridgeLive = false;
    try { if (G.__figmaBridgeTask) app.cancelTask(G.__figmaBridgeTask); } catch (eC) {}
    G.__figmaBridgeTask = null;
    // Illustrator hands artwork over through a file, so live mode keeps going for it
    // even when the helper Figma talks to will not start
    var relayOk = relayRunning() || startRelay();
    G.__figmaBridgeRelayTry = new Date().getTime();
    G.__figmaBridgeOnData = onData;
    G.__figmaBridgeOnStatus = onStatus;
    // always re-arm, since After Effects can drop scheduled tasks
    try { if (G.__figmaBridgeTask) app.cancelTask(G.__figmaBridgeTask); } catch (e0) {}
    G.__figmaBridgeTask = null;
    // Each poll schedules the next one. A repeating task gets dropped by
    // After Effects after a long build runs inside it, so chain single shots.
    G.__figmaBridgeLive = true;
    G.__figmaBridgePoll = function () {
      G.__figmaBridgeTask = null;
      if (!G.__figmaBridgeLive) return;
      var data = null;
      // artwork Illustrator left for us
      try {
        var inbox = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');
        if (inbox.exists) {
          inbox.encoding = 'UTF-8'; inbox.open('r'); var txt = inbox.read(); inbox.close(); inbox.remove();
          log('live: Illustrator sent ' + txt.length + ' chars');
          data = parseData(txt, true);
          if (data && data.update) { G.__figmaBridgeOnStatus(applyUpdate(data.update)); data = null; }
          else if (data && data.raster) { G.__figmaBridgeOnStatus(placeRaster(data.raster)); data = null; }
          else if (data && data.message && !(data.layers && data.layers.length)) { G.__figmaBridgeOnStatus(data.message); data = null; }
        }
      } catch (eI) { log('inbox error ' + errText(eI)); }
      if (!data) try {
        var r = httpGet('/next');
        if (!r) {
          // try the helper again now and then, not on every poll
          var nowT = new Date().getTime();
          if (nowT - (G.__figmaBridgeRelayTry || 0) > 10000) { G.__figmaBridgeRelayTry = nowT; if (!relayRunning()) startRelay(); }
        }
        else if (r.status === 200 && r.body) {
          log('live: received ' + r.body.length + ' chars');
          // the helper has checked it is plain JSON, so the fast reader is safe
          data = parseData(r.body, helperChecked);
          // a message from another app, with nothing to build
          if (data && data.message && !(data.layers && data.layers.length)) { G.__figmaBridgeOnStatus(data.message); data = null; }
        }
      } catch (e) { log('live error ' + errText(e)); }
      // schedule the next poll before building, so a build error cannot stop live mode
      G.__figmaBridgeTask = app.scheduleTask('$.global.__figmaBridgePoll()', data ? 1500 : 400, false);
      if (data) {
        try { G.__figmaBridgeOnData(data); } catch (e2) { log('build error ' + errText(e2)); }
      }
    };
    G.__figmaBridgeTask = app.scheduleTask('$.global.__figmaBridgePoll()', 400, false);
    onStatus(relayOk ? 'Live. Click Send in the Figma plugin.' : 'Live for Illustrator. The helper Figma needs did not start, so use Copy and Paste for Figma for now.');
    log('live: polling relay');
    return true;
  }

  function stopListening() {
    var G = $.global;
    G.__figmaBridgeLive = false;
    try { if (G.__figmaBridgeTask) app.cancelTask(G.__figmaBridgeTask); } catch (e) {}
    G.__figmaBridgeTask = null;
  }

  // ---------- self check ----------
  // Runs every part of LayerBoat that can be tried without Figma, and says what worked.
  // Made for checking a new computer, Windows above all.
  function selfCheck() {
    var lines = [], fails = 0;
    function ok(label, good, detail) {
      if (!good) fails++;
      lines.push((good ? 'OK    ' : 'FAIL  ') + label + (detail ? ' (' + detail + ')' : ''));
      return good;
    }
    function info(label, v) { lines.push('      ' + label + ': ' + v); }
    info('LayerBoat', VERSION);
    info('After Effects', app.version);
    info('System', $.os);
    var home = HOME || (Folder.userData.fsName + '/LayerBoat');
    if (!HOME) HOME = home;
    info('LayerBoat folder', home);
    var allowed = scriptsCanUseSystem();
    ok('Scripts may write files and use the network', allowed, allowed ? '' : 'turn it on in Settings > Scripting & Expressions');
    // the installed files
    var win = isWindows();
    var arch = '';
    if (win) arch = ($.getenv('PROCESSOR_ARCHITEW6432') || $.getenv('PROCESSOR_ARCHITECTURE') || '').toUpperCase();
    else { try { arch = system.callSystem('/usr/bin/uname -m').replace(/\s+/g, ''); } catch (eU) {} }
    info('Processor', arch);
    var relayName = win ? 'layerboat-helper-windows-' + (arch === 'ARM64' ? 'arm64' : 'amd64') + '.exe' : 'layerboat-helper-' + (arch === 'arm64' ? 'arm64' : 'amd64');
    ok('Relay program is installed', new File(home + '/relay/' + relayName).exists, relayName);
    ok('Illustrator launcher is installed', new File(home + '/relay/' + (win ? 'start-relay.vbs' : 'LayerBoat Helper.app')).exists);
    var plug = ['manifest.json', 'code.js', 'ui.html'], plugOk = true;
    for (var i = 0; i < plug.length; i++) if (!new File(home + '/Figma Plugin/' + plug[i]).exists) plugOk = false;
    ok('Figma plugin files are installed', plugOk, home + '/Figma Plugin');
    var aiScripts = ['LayerBoat Panel.jsx', 'Send to After Effects.jsx', 'Send to Figma.jsx', 'Bring in from Figma.jsx'], aiOk = true;
    for (i = 0; i < aiScripts.length; i++) if (!new File(home + '/Illustrator/' + aiScripts[i]).exists) aiOk = false;
    ok('Illustrator scripts are installed', aiOk, home + '/Illustrator');
    var prefsRoot = win ? new Folder(Folder.userData.fsName + '/Adobe/After Effects') : new Folder('~/Library/Preferences/Adobe/After Effects');
    var panels = prefsRoot.exists ? prefsRoot.getFiles(function (f) { return f instanceof Folder; }) : [], found = [];
    for (i = 0; i < panels.length; i++) if (new File(panels[i].fsName + '/Scripts/ScriptUI Panels/LayerBoat.jsx').exists) found.push(panels[i].name);
    ok('Panel is in the Window menu', found.length > 0, found.length ? 'for After Effects ' + found.join(', ') : 'not found under ' + prefsRoot.fsName);
    // writing where the live inbox is
    var probe = new File(home + '/check-write.tmp');
    var wrote = false;
    try { probe.open('w'); probe.write('x'); probe.close(); wrote = probe.exists; probe.remove(); } catch (eW) {}
    ok('LayerBoat can write to its folder', wrote);
    // the relay
    var running = relayRunning();
    if (!running) running = startRelay();
    if (!ok('Relay starts and answers', running, running ? '' : 'see log.txt in the LayerBoat folder')) {
      lines.push('      Firewall or security software may be blocking ' + relayName + '.');
    } else {
      var ping = httpGet('/ping?from=ae');
      ok('Relay answers After Effects', !!(ping && ping.status === 200), ping ? ping.body : 'no answer');
      // a drawing for Illustrator travels as a file the relay writes; it is taken away again at once
      var svgFile = new File(home + '/from-figma.svg');
      if (!svgFile.exists) {
        var sent = httpPost('/send?to=ai', '<!-- bridge:check:0 --><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
        var st = httpGet('/status?to=ai');
        ok('Relay hands drawings to Illustrator', !!(sent && sent.status === 200 && svgFile.exists && st && st.body === 'waiting'), sent ? sent.body : 'no answer');
        try { svgFile.remove(); } catch (eR) {}
      } else info('Relay to Illustrator', 'skipped, a drawing from Figma is waiting');
      var nx = httpGet('/next?for=ai-check');
      ok('Relay mailbox answers', !!(nx && (nx.status === 204 || nx.status === 200)), nx ? 'status ' + nx.status : 'no answer');
    }
    // building layers, in a comp that is removed again
    var comp = null;
    try {
      var data = { bridge: 'figma-to-ae', version: 1, name: 'LayerBoat check', rootId: null, width: 200, height: 100, layers: [
        { name: 'Check box', id: 'check:1', opacity: 1, blend: 'NORMAL', x: 20, y: 20, rotation: 0, scaleX: 100, scaleY: 100, skew: 0, width: 80, height: 40, effects: [],
          type: 'shape', kind: 'rect', radius: 6, fills: [{ type: 'solid', color: [0.2, 0.4, 0.9, 1], opacity: 1, blend: 'NORMAL' }], stroke: null }], warnings: [] };
      build(data, { intoActive: false, update: false });
      for (i = app.project.numItems; i >= 1; i--) { var it = app.project.item(i); if (it instanceof CompItem && it.name === 'LayerBoat check') { comp = it; break; } }
      ok('Layers are built', !!(comp && comp.numLayers >= 1), comp ? comp.numLayers + ' layer' : 'no comp');
    } catch (eB) { ok('Layers are built', false, errText(eB)); }
    try { if (comp) comp.remove(); } catch (eC) {}
    // Illustrator, when it is open
    var aiUp = false;
    try { aiUp = !!runningTarget('illustrator'); } catch (eI) {}
    if (aiUp) {
      var answer = null, bt = new BridgeTalk();
      bt.target = runningTarget('illustrator') || 'illustrator';
      bt.body = '"Illustrator " + app.version';
      bt.onResult = function (m) { answer = m.body; };
      bt.onError = function (m) { answer = 'ERR ' + m.body; };
      bt.send();
      for (i = 0; i < 100 && answer === null; i++) { $.sleep(100); try { BridgeTalk.pump(); } catch (eP) {} }
      ok('Illustrator answers After Effects', !!(answer && answer.indexOf('ERR') !== 0), answer || 'no answer in 10 seconds');
    } else info('Illustrator', 'not open, so not checked');
    lines.unshift(fails ? fails + ' check' + (fails > 1 ? 's' : '') + ' failed.' : 'Everything worked.');
    return lines.join('\n');
  }

  return { buildInbox: buildInbox, selfCheck: selfCheck, errText: errText, fromIllustrator: fromIllustrator, updateFromIllustrator: updateFromIllustrator, applyUpdate: applyUpdate, rasterizeFromIllustrator: rasterizeFromIllustrator, placeRaster: placeRaster, setIllustratorSource: setIllustratorSource, setIllustratorImportSource: setIllustratorImportSource, sendToIllustrator: sendToIllustrator, sendToFigma: sendToFigma, selectGroup: selectGroup, groupToPrecomp: groupToPrecomp, releaseGroup: releaseGroup, toggleHelpers: toggleHelpers, run: run, build: build, listen: listen, stopListening: stopListening, setHome: setHome, VERSION: VERSION, lastStatus: '', setLog: setLog, log: log, canUseSystem: scriptsCanUseSystem };
})();
