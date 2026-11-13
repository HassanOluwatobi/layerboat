// LayerBoat for Illustrator: brings in what the LayerBoat plugin in Figma sent.
// Figma sends the frame as SVG, with its text as live text and its layer names
// as ids. It waits in a file, because Illustrator scripts cannot listen for it.
// Placed into the open document on a new artboard, or opened as a new document.
function LayerBoatAI_import(opts) {
  opts = opts || {};
  var home = Folder.userData.fsName + '/LayerBoat';
  var drop = new File(home + '/from-figma.svg');
  if (!drop.exists) {
    // the drawing can still be on its way: Figma sends it once LayerBoat is running
    if (opts.startRelay) opts.startRelay();
    var waitFor = opts.wait === undefined ? 45 : opts.wait;
    for (var w = 0; w < waitFor * 4 && !drop.exists; w++) $.sleep(250);
    if (!drop.exists) return 'WAIT';
    $.sleep(200);
  }
  drop.encoding = 'UTF-8';
  if (!drop.open('r')) return 'ERR LayerBoat could not read what Figma sent.';
  var text = drop.read(); drop.close();

  try { drop.remove(); } catch (e3) {}
  // several frames sent together come as several drawings, one artboard each
  var pieces = text.split('<!-' + '- bridge-next -' + '->');
  var done = [], fails = [];
  for (var pi = 0; pi < pieces.length; pi++) {
    var piece = pieces[pi];
    while (piece.length && piece.charCodeAt(0) <= 32) piece = piece.substring(1);
    if (!piece.length) continue;
    var r1 = String(importOne(piece));
    if (r1.indexOf('OK ') === 0) done.push(r1.substring(3)); else fails.push(r1.substring(4));
  }
  if (!done.length) return 'ERR ' + (fails[0] || 'Nothing came in.');
  return 'OK ' + done.join(', ') + (fails.length ? ' (' + fails.length + ' could not come in: ' + fails[0] + ')' : '');

  // one drawing, onto a new artboard, or a new document when none is open
  function importOne(text) {
    // the first line names the frame
    var name = 'From Figma', id = '';
    var head = '<!-- bridge:';
    if (text.indexOf(head) === 0) {
      var end = text.indexOf(' -->');
      var parts = text.substring(head.length, end).split(':');
      try { name = decodeURIComponent(parts[0]) || name; } catch (e1) {}
      try { id = decodeURIComponent(parts[1] || ''); } catch (e2) {}
      text = text.substring(end + 4);
    }
    var size = svgSize(text);
    if (!size) return 'ERR What Figma sent is not a drawing LayerBoat can read.';

    // Illustrator imports from a file, named after the frame so its group is too
    var safe = '';
    for (var c = 0; c < name.length && safe.length < 60; c++) {
      var code = name.charCodeAt(c);
      safe += (code < 32 || '/:*?"<>|'.indexOf(name.charAt(c)) !== -1 || code === 92) ? '-' : name.charAt(c);
    }
    var tmp = new File(Folder.temp.fsName + '/' + (safe || 'From Figma') + '.svg');
    tmp.encoding = 'UTF-8';
    if (!tmp.open('w')) return 'ERR LayerBoat could not write its file.';
    tmp.write(text); tmp.close();

    // Illustrator refuses to read or set its coordinate system while no document is open
    var oldCoords = null, g = null, ab = null, nd = null, note = '';
    function useDocCoords() {
      try {
        if (oldCoords === null) oldCoords = app.coordinateSystem;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
      } catch (eC) {}
    }
    try {
      if (app.documents.length) useDocCoords();
      var doc = (!app.documents.length || opts.newDocument) ? null : app.activeDocument, rect = null;
      if (doc) {
        // a new artboard the size of the frame: to the right of the others, or below them
        // when the canvas has no room left there
        var right = -Infinity, top = 0, left = Infinity, bottom = Infinity;
        for (var a = 0; a < doc.artboards.length; a++) {
          var ar = doc.artboards[a].artboardRect;
          if (ar[2] > right) { right = ar[2]; top = ar[1]; }
          if (ar[0] < left) left = ar[0];
          if (ar[3] < bottom) bottom = ar[3];
        }
        var spots = [[right + 100, top], [left, bottom - 100]];
        for (var sp = 0; sp < spots.length && !ab; sp++) {
          rect = [spots[sp][0], spots[sp][1], spots[sp][0] + size[0], spots[sp][1] - size[1]];
          try { ab = doc.artboards.add(rect); } catch (eAb) { ab = null; }
        }
        if (!ab) { doc = null; note = ' (in a new document, as the open one has no room left on its canvas)'; }
      }
      if (!doc) {
        // a new Illustrator document the size of the frame
        nd = app.documents.add(DocumentColorSpace.RGB, size[0], size[1]);
        doc = nd;
        useDocCoords();
        ab = doc.artboards[0];
        rect = ab.artboardRect;
      }
      try { ab.name = name; } catch (e5) {}
      g = doc.groupItems.createFromFile(tmp);
      g.name = name;
      removeDefinitions(g);
      // Figma clips the frame to its own size, so that clipping path marks where the
      // frame's corner is. It is lined up with the artboard's corner.
      var anchor = g;
      for (var c2 = 0; c2 < g.pageItems.length && anchor === g; c2++) {
        var it2 = g.pageItems[c2];
        if (it2.parent !== g || it2.typename !== 'GroupItem' || !it2.clipped) continue;
        for (var c3 = 0; c3 < it2.pageItems.length; c3++) {
          var cp = it2.pageItems[c3];
          if (cp.parent !== it2 || !(cp.typename === 'PathItem' && cp.clipping)) continue;
          var gb2 = cp.geometricBounds;
          if (Math.abs((gb2[2] - gb2[0]) - size[0]) < 1 && Math.abs((gb2[1] - gb2[3]) - size[1]) < 1) { anchor = cp; break; }
        }
      }
      var ap = anchor.position;
      g.translate(rect[0] - ap[0], rect[1] - ap[1]);
      // drawings from After Effects carry their real layer names beside short ids,
      // and their text as a note, which is made here as real Illustrator text
      var real = realNames(text);
      var texts = textNote(text);
      if (texts) note += placeTexts(doc, g, texts, real || {});
      if (real) renameAll(g, real);
      else cleanNames(g.pageItems);
      if (!nd) {
        doc.artboards.setActiveArtboardIndex(doc.artboards.length - 1);
        // the window moves to the new artboard, so the drawing is in view
        try {
          var vw = doc.views[0], vb = vw.bounds, aw = rect[2] - rect[0], ah = rect[1] - rect[3];
          var fit = Math.min((vb[2] - vb[0]) / aw, (vb[1] - vb[3]) / ah) * 0.9;
          if (fit > 0 && isFinite(fit)) vw.zoom = vw.zoom * fit;
          vw.centerPoint = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
        } catch (eV) {}
      }
      try { doc.selection = null; g.selected = true; } catch (e6) {}
      return 'OK ' + name + note;
    } catch (err) {
      // a failed import leaves nothing half made behind
      try { if (nd) nd.close(SaveOptions.DONOTSAVECHANGES); else { if (g) g.remove(); if (ab) ab.remove(); } } catch (eG) {}
      return 'ERR ' + err + (err.line ? ' (line ' + err.line + ')' : '');
    } finally {
      try { if (oldCoords !== null) app.coordinateSystem = oldCoords; } catch (eR) {}
      try { tmp.remove(); } catch (e7) {}
    }

  }

  // the width and height on the svg element
  function svgSize(t) {
    var s = t.indexOf('<svg');
    if (s === -1) return null;
    var tag = t.substring(s, t.indexOf('>', s));
    function attr(n) {
      var k = tag.indexOf(' ' + n + '="');
      if (k === -1) return NaN;
      k += n.length + 3;
      return parseFloat(tag.substring(k, tag.indexOf('"', k)));
    }
    var wv = attr('width'), hv = attr('height');
    if (isNaN(wv) || isNaN(hv)) {
      var vb = tag.indexOf('viewBox="');
      if (vb === -1) return null;
      var nums = tag.substring(vb + 9, tag.indexOf('"', vb + 9)).split(' ');
      wv = parseFloat(nums[2]); hv = parseFloat(nums[3]);
    }
    return isNaN(wv) || isNaN(hv) ? null : [wv, hv];
  }
  // Figma's masks and clips are written as definitions, which Illustrator brings in
  // as loose artwork beside the drawing. The drawing itself already carries them.
  function removeDefinitions(container) {
    var def = new RegExp('^(mask|clip|filter|paint|pattern|stroke)[0-9]+([ _][0-9]+)*$');
    for (var i = container.pageItems.length - 1; i >= 0; i--) {
      try { var it = container.pageItems[i]; if (it.parent === container && def.test(it.name)) it.remove(); } catch (e) {}
    }
  }
  // the text note After Effects leaves beside the drawing, or null
  function textNote(t) {
    var k = t.indexOf('<!-- bridge-text:');
    if (k === -1) return null;
    var e = t.indexOf(' -->', k);
    try { return eval('(' + decodeURIComponent(t.substring(k + 17, e)) + ')'); } catch (eT) { return null; }
  }
  function rgb(c) { var r = new RGBColor(); r.red = Math.round(c[0] * 255); r.green = Math.round(c[1] * 255); r.blue = Math.round(c[2] * 255); return r; }
  // Each text sits where its square was drawn. The square's corners give the text
  // layer's position, turn and scale.
  function placeTexts(doc, g, recs, real) {
    var found = [], missing = {}, fonts = {}, i;
    function walk(c) {
      for (var q = 0; q < c.pageItems.length; q++) {
        var it = c.pageItems[q];
        if (it.parent !== c) continue;
        if (it.typename === 'GroupItem') walk(it);
        else if (it.typename === 'PathItem' && recs.hasOwnProperty(it.name)) found.push(it);
      }
    }
    walk(g);
    function font(ps) {
      if (fonts.hasOwnProperty(ps)) return fonts[ps];
      var f = null;
      try { f = app.textFonts.getByName(ps); } catch (eF) { missing[ps] = true; }
      fonts[ps] = f;
      return f;
    }
    function style(range, r, s, rec) {
      var ca = range.characterAttributes;
      var f = r.ps ? font(r.ps) : null;
      if (f) ca.textFont = f;
      ca.size = Math.max(0.1, r.size * s);
      if (r.color) ca.fillColor = rgb(r.color); else ca.fillColor = new NoColor();
      ca.tracking = Math.round(r.tracking || 0);
      if (rec.leading) { ca.autoLeading = false; ca.leading = rec.leading * s; }
      if (rec.stroke) { ca.strokeColor = rgb(rec.stroke); ca.strokeWeight = rec.strokeWidth * s; }
    }
    for (i = 0; i < found.length; i++) {
      var ph = found[i], rec = recs[ph.name], tf = null;
      try {
        var pts = ph.pathPoints;
        if (pts.length < 4) continue;
        var p0 = pts[0].anchor, p1 = pts[1].anchor, p3 = pts[3].anchor;
        var ux = (p1[0] - p0[0]) / 100, uy = (p1[1] - p0[1]) / 100, vx = (p3[0] - p0[0]) / 100, vy = (p3[1] - p0[1]) / 100;
        var s = Math.sqrt(Math.abs(ux * vy - uy * vx)) || 1;
        // made in the layer's own space at its scale, then turned into place
        if (rec.box) {
          var frame = doc.pathItems.rectangle(-rec.box[1] * s, rec.box[0] * s, rec.box[2] * s, rec.box[3] * s);
          tf = doc.textFrames.areaText(frame);
        } else tf = doc.textFrames.pointText([0, 0]);
        var parts = [];
        for (var L = 0; L < rec.lines.length; L++) { var line = ''; for (var r = 0; r < rec.lines[L].length; r++) line += rec.lines[L][r].text; parts.push(line); }
        tf.contents = parts.join(String.fromCharCode(13));
        var first = rec.lines[0] && rec.lines[0][0];
        for (L = 0; !first && L < rec.lines.length; L++) first = rec.lines[L][0];
        if (first) style(tf.textRange, first, s, rec);
        var just = rec.align === 'CENTER' ? Justification.CENTER : (rec.align === 'RIGHT' ? Justification.RIGHT : Justification.LEFT);
        tf.textRange.paragraphAttributes.justification = just;
        // runs that differ from the first are styled line by line
        var paras = tf.paragraphs, nonEmpty = [];
        for (L = 0; L < rec.lines.length; L++) if (parts[L].length) nonEmpty.push(L);
        var useAll = paras.length === rec.lines.length, useSome = !useAll && paras.length === nonEmpty.length;
        for (L = 0; L < rec.lines.length && (useAll || useSome); L++) {
          var runs = rec.lines[L];
          if (!parts[L].length) continue;
          var pi = useAll ? L : -1;
          if (useSome) for (var n = 0; n < nonEmpty.length; n++) if (nonEmpty[n] === L) pi = n;
          var at = 0;
          for (r = 0; r < runs.length; r++) {
            var same = runs[r].ps === first.ps && runs[r].size === first.size && String(runs[r].color) === String(first.color) && runs[r].tracking === first.tracking;
            if (!same) for (var c = 0; c < runs[r].text.length; c++) style(paras[pi].characters[at + c], runs[r], s, rec);
            at += runs[r].text.length;
          }
        }
        // where the layer's origin ends up after turning, found with a marker point
        var a = ux / s, b = uy / s, cc = -vx / s, d = -vy / s;
        var mark = doc.pathItems.add();
        mark.setEntirePath([[0, 0], [0, 0]]);
        if (Math.abs(a - 1) > 0.0001 || Math.abs(b) > 0.0001 || Math.abs(cc) > 0.0001 || Math.abs(d - 1) > 0.0001) {
          var M = app.getIdentityMatrix();
          M.mValueA = a; M.mValueB = b; M.mValueC = cc; M.mValueD = d; M.mValueTX = 0; M.mValueTY = 0;
          tf.transform(M, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
          mark.transform(M, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        }
        var q0 = mark.pathPoints[0].anchor;
        mark.remove();
        tf.translate(p0[0] - q0[0], p0[1] - q0[1]);
        if (rec.opacity < 0.999) tf.opacity = rec.opacity * 100;
        tf.move(ph, ElementPlacement.PLACEBEFORE);
        tf.name = real.hasOwnProperty(ph.name) ? real[ph.name] : ph.name;
        ph.remove();
      } catch (eP) {
        try { if (tf) tf.remove(); } catch (eR) {}
      }
    }
    var miss = [];
    for (var mk in missing) if (missing.hasOwnProperty(mk)) miss.push(mk);
    return miss.length ? ' Fonts not installed here: ' + miss.join(', ') + '.' : '';
  }
  function renameAll(c, real) {
    for (var q = 0; q < c.pageItems.length; q++) {
      var it = c.pageItems[q];
      try { if (real.hasOwnProperty(it.name)) it.name = real[it.name]; } catch (eN) {}
      if (it.parent === c && it.typename === 'GroupItem') renameAll(it, real);
    }
  }
  // the id and data-name pairs in the drawing, or null when it has none.
  // split is used because a regular expression is slow on a drawing this long.
  function realNames(t) {
    var parts = t.split(' data-name="');
    if (parts.length < 2) return null;
    var map = {}, amp = new RegExp('&(amp|lt|gt|quot);', 'g'), ent = { amp: '&', lt: '<', gt: '>', quot: '"' };
    for (var i = 1; i < parts.length; i++) {
      var before = parts[i - 1], k = before.lastIndexOf(' id="');
      if (k === -1) continue;
      var id = before.substring(k + 5, before.indexOf('"', k + 5));
      var nm = parts[i].substring(0, parts[i].indexOf('"')).replace(amp, function (m, e) { return ent[e]; });
      map[id] = nm;
    }
    return map;
  }
  // Illustrator writes spaces and symbols in names as codes such as _x20_ and adds
  // _1_ to repeated names, and Figma adds _2 to repeated names in its SVG. The names
  // are put back as they were in Figma.
  function cleanNames(items) {
    var hexCode = new RegExp('_x([0-9A-Fa-f]{2})_', 'g'), repeat = new RegExp('_[0-9]+_$'), figmaRepeat = new RegExp('^(.*)_([0-9]+)$');
    var names = {}, list = [], i;
    for (i = 0; i < items.length; i++) {
      try {
        var nm = items[i].name;
        if (!nm) continue;
        var clean = nm.replace(hexCode, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }).replace(repeat, '');
        names[clean] = true;
        list.push([items[i], nm, clean]);
      } catch (e) {}
    }
    for (i = 0; i < list.length; i++) {
      var c = list[i][2], fm = figmaRepeat.exec(c);
      // only when the plain name is there too, so a name that really ends in _2 is kept
      if (fm && names[fm[1]]) c = fm[1];
      if (c !== list[i][1]) { try { list[i][0].name = c; } catch (e2) {} }
    }
  }
}
