// Developer tool: draws a board with one example of every feature LayerBoat
// handles, far to the right of the current page, and selects it.
async function drawBoard() {
  async function font(family, style) {
    try { await figma.loadFontAsync({ family: family, style: style }); return { family: family, style: style }; }
    catch (e) { await figma.loadFontAsync({ family: 'Inter', style: style === 'Bold' ? 'Bold' : 'Regular' }); return { family: 'Inter', style: style === 'Bold' ? 'Bold' : 'Regular' }; }
  }
  var REG = await font('Helvetica Neue', 'Regular');
  var BOLD = await font('Helvetica Neue', 'Bold');
  function rgb(h) { return { r: parseInt(h.substr(1, 2), 16) / 255, g: parseInt(h.substr(3, 2), 16) / 255, b: parseInt(h.substr(5, 2), 16) / 255 }; }
  function solid(h, o) { return [{ type: 'SOLID', color: rgb(h), opacity: o === undefined ? 1 : o }]; }

  var maxX = 0;
  figma.currentPage.children.forEach(function (n) { if (n.absoluteBoundingBox) maxX = Math.max(maxX, n.absoluteBoundingBox.x + n.absoluteBoundingBox.width); });
  var board = figma.createFrame();
  board.name = 'LayerBoat test board';
  board.resize(1240, 1000);
  board.x = maxX + 400; board.y = 0;
  board.fills = solid('#F4F5F7');
  board.clipsContent = true;

  function label(t, x, y) {
    var n = figma.createText(); n.fontName = REG; n.characters = t; n.fontSize = 11; n.fills = solid('#6B7280');
    n.x = x; n.y = y; board.appendChild(n); return n;
  }
  function rect(x, y, w, h, fill) { var r = figma.createRectangle(); r.resize(w, h); r.x = x; r.y = y; r.fills = solid(fill); board.appendChild(r); return r; }

  // row 1: stroke alignment
  var a = rect(40, 40, 120, 80, '#3B82F6'); a.strokes = solid('#111827'); a.strokeWeight = 6; a.strokeAlign = 'INSIDE'; a.cornerRadius = 12; label('inside stroke', 40, 128);
  var b = rect(200, 40, 120, 80, '#3B82F6'); b.strokes = solid('#EF4444'); b.strokeWeight = 6; b.strokeAlign = 'OUTSIDE'; b.cornerRadius = 12; label('outside stroke', 200, 128);
  var c = rect(360, 40, 120, 80, '#3B82F6'); c.strokes = solid('#111827'); c.strokeWeight = 6; c.strokeAlign = 'CENTER'; label('center stroke', 360, 128);
  var d = figma.createFrame(); d.resize(120, 80); d.x = 520; d.y = 40; d.fills = solid('#FFFFFF'); d.strokes = solid('#111827');
  d.strokeTopWeight = 0; d.strokeLeftWeight = 0; d.strokeRightWeight = 0; d.strokeBottomWeight = 3; d.strokeAlign = 'INSIDE'; board.appendChild(d); label('bottom border', 520, 128);
  var e = figma.createFrame(); e.resize(120, 80); e.x = 680; e.y = 40; e.fills = solid('#FFFFFF'); e.strokes = solid('#7C3AED');
  e.strokeTopWeight = 1; e.strokeLeftWeight = 6; e.strokeRightWeight = 1; e.strokeBottomWeight = 1; e.strokeAlign = 'INSIDE'; board.appendChild(e); label('left accent border', 680, 128);
  var f = rect(840, 40, 120, 80, '#10B981'); f.cornerRadius = 28; f.cornerSmoothing = 0.6; label('smooth corners', 840, 128);
  var g = rect(1000, 40, 120, 80, '#F59E0B'); g.topLeftRadius = 30; g.bottomRightRadius = 30; label('mixed radii', 1000, 128);

  // row 2: shadows and blur
  var h = rect(40, 190, 120, 80, '#FFFFFF'); h.cornerRadius = 12; h.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 6 }, radius: 12, spread: 0, visible: true, blendMode: 'NORMAL' }]; label('drop shadow', 40, 278);
  var i = rect(200, 190, 120, 80, '#FFFFFF'); i.cornerRadius = 12; i.effects = [{ type: 'DROP_SHADOW', color: { r: 0.2, g: 0.3, b: 1, a: 0.5 }, offset: { x: 0, y: 4 }, radius: 8, spread: 8, visible: true, blendMode: 'NORMAL' }]; label('shadow + spread', 200, 278);
  var j = rect(360, 190, 120, 80, '#E5E7EB'); j.cornerRadius = 12; j.effects = [{ type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true, blendMode: 'NORMAL' }]; label('inner shadow', 360, 278);
  var k1 = figma.createEllipse(); k1.resize(70, 70); k1.x = 530; k1.y = 190; k1.fills = solid('#EF4444'); board.appendChild(k1);
  var k2 = figma.createEllipse(); k2.resize(70, 70); k2.x = 580; k2.y = 205; k2.fills = solid('#3B82F6'); board.appendChild(k2);
  var k3 = rect(545, 215, 110, 50, '#FFFFFF'); k3.opacity = 1; k3.fills = solid('#FFFFFF', 0.35); k3.cornerRadius = 10;
  k3.effects = [{ type: 'BACKGROUND_BLUR', radius: 16, visible: true }]; label('background blur', 520, 278);
  var l = figma.createEllipse(); l.resize(60, 60); l.x = 700; l.y = 200; l.fills = solid('#EC4899'); board.appendChild(l);
  l.effects = [{ type: 'LAYER_BLUR', radius: 8, visible: true }]; label('layer blur', 690, 278);
  var m1 = figma.createEllipse(); m1.resize(60, 60); m1.x = 840; m1.y = 195; m1.fills = solid('#111827');
  var m2 = figma.createEllipse(); m2.resize(60, 60); m2.x = 880; m2.y = 205; m2.fills = solid('#111827');
  board.appendChild(m1); board.appendChild(m2);
  var grp = figma.group([m1, m2], board); grp.opacity = 0.4; grp.name = 'Group at 40%'; label('group opacity (no dark overlap)', 830, 278);

  // row 3: paints
  var n = figma.createEllipse(); n.resize(90, 90); n.x = 40; n.y = 330; board.appendChild(n);
  n.fills = [{ type: 'GRADIENT_ANGULAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 0.5, color: { r: 0, g: 0, b: 1, a: 1 } }, { position: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }];
  label('angular gradient', 40, 428);
  var o = rect(180, 330, 120, 90, '#000000');
  o.fills = [{ type: 'GRADIENT_DIAMOND', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0.6, b: 0.3, a: 1 } }] }];
  label('diamond gradient', 180, 428);
  var pRect = rect(340, 330, 120, 90, '#FFFFFF'); pRect.cornerRadius = 16; pRect.strokeWeight = 6; pRect.strokeAlign = 'INSIDE';
  pRect.strokes = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 0.5, g: 0, b: 1, a: 1 } }, { position: 1, color: { r: 0, g: 0.8, b: 1, a: 1 } }] }];
  label('gradient stroke', 340, 428);
  var q = figma.createLine(); q.resize(140, 0); q.x = 500; q.y = 375; q.strokes = solid('#111827'); q.strokeWeight = 3; q.strokeCap = 'ARROW_LINES'; board.appendChild(q);
  label('arrow line', 500, 428);
  var rr = rect(680, 330, 160, 90, '#000000');
  rr.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0.7, 0.7, 0], [-0.7, 0.7, 0.5]], gradientStops: [{ position: 0, color: { r: 1, g: 0.4, b: 0.2, a: 1 } }, { position: 0.5, color: { r: 1, g: 0.9, b: 0.3, a: 1 } }, { position: 1, color: { r: 0.2, g: 0.7, b: 1, a: 1 } }] }];
  label('3-stop diagonal gradient', 680, 428);
  var ss = rect(880, 330, 120, 90, '#3B82F6'); ss.opacity = 0.5; ss.strokes = solid('#111827'); ss.strokeWeight = 8; ss.strokeAlign = 'INSIDE'; ss.cornerRadius = 8; label('50% shape with stroke', 880, 428);
  var dash = rect(1040, 330, 120, 90, '#FFFFFF'); dash.strokes = solid('#111827'); dash.strokeWeight = 2; dash.dashPattern = [8, 4]; dash.cornerRadius = 8; label('dashed stroke', 1040, 428);

  // row 4+: text
  function txt(chars, x, y, opts) {
    var t = figma.createText();
    t.fontName = opts.bold ? BOLD : REG;
    t.characters = chars;
    t.fontSize = opts.size || 16;
    t.fills = opts.fills || solid(opts.color || '#111827');
    if (opts.width) { t.textAutoResize = 'HEIGHT'; t.resize(opts.width, t.height); }
    if (opts.height) { t.textAutoResize = 'NONE'; t.resize(opts.width || 200, opts.height); }
    if (opts.align) t.textAlignHorizontal = opts.align;
    if (opts.valign) t.textAlignVertical = opts.valign;
    if (opts.lh) t.lineHeight = { value: opts.lh, unit: 'PIXELS' };
    if (opts.ls) t.letterSpacing = { value: opts.ls, unit: 'PERCENT' };
    if (opts.caseUpper) t.textCase = 'UPPER';
    if (opts.underline) t.textDecoration = 'UNDERLINE';
    t.x = x; t.y = y;
    board.appendChild(t);
    return t;
  }
  var para = txt('Plan your week in minutes. Harbor keeps every task, note and file in one calm place, so nothing slips.', 40, 480, { width: 260, lh: 24 });
  label('wrapped paragraph, 24px line height', 40, 590);
  var guide = rect(40, 480, 260, 1, '#EF4444'); guide.name = 'top guide';
  txt('Centred heading\nacross two lines', 340, 480, { width: 220, align: 'CENTER', size: 22, bold: true });
  txt('Right aligned', 600, 480, { width: 180, align: 'RIGHT', size: 18 });
  txt('uppercase spaced', 600, 520, { caseUpper: true, ls: 12, size: 14, bold: true });
  txt('Underlined link', 600, 560, { underline: true, color: '#2563EB' });
  var box = txt('Middle of box', 840, 480, { width: 200, height: 80, valign: 'CENTER', align: 'CENTER', size: 18 });
  var boxBg = rect(840, 480, 200, 80, '#FFFFFF'); boxBg.fills = []; boxBg.strokes = solid('#D1D5DB'); boxBg.strokeWeight = 1; boxBg.name = 'box outline';
  var grad = txt('Gradient', 40, 640, { size: 56, bold: true, fills: [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 0.4, g: 0.2, b: 1, a: 1 } }, { position: 1, color: { r: 1, g: 0.3, b: 0.5, a: 1 } }] }] });
  var stroked = txt('Outlined', 340, 640, { size: 56, bold: true, color: '#FFFFFF' }); stroked.strokes = solid('#111827'); stroked.strokeWeight = 2; stroked.strokeAlign = 'OUTSIDE';
  var mixed = txt('$5 /month', 640, 650, { size: 40, bold: true, color: '#1F2A5C' });
  mixed.setRangeFontSize(3, 9, 16); mixed.setRangeFontName(3, 9, REG); mixed.setRangeFills(3, 9, solid('#6B7280'));
  var multi = txt('Line one\n\nLine three after a blank line', 860, 640, { width: 300, lh: 22 });

  // rotated card
  var rot = rect(40, 760, 160, 100, '#8B5CF6'); rot.cornerRadius = 16; rot.rotation = -12;
  rot.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 8 }, radius: 16, spread: 0, visible: true, blendMode: 'NORMAL' }];
  var rotText = txt('Rotated', 70, 800, { size: 20, bold: true, color: '#FFFFFF' }); rotText.rotation = -12;
  label('rotated card + text', 40, 900);

  // skewed shape
  var sk = rect(300, 780, 120, 80, '#10B981'); sk.cornerRadius = 8;
  sk.relativeTransform = [[1, 0.35, 300], [0, 1, 780]];
  label('skewed shape', 300, 900);

  // luminance mask: a white-to-black gradient fades the photo-like block
  var lm = figma.createFrame(); lm.resize(160, 100); lm.x = 480; lm.y = 770; lm.fills = []; board.appendChild(lm);
  var mk = figma.createRectangle(); mk.resize(160, 100); mk.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }] }];
  lm.appendChild(mk); mk.isMask = true; try { mk.maskType = 'LUMINANCE'; } catch (e) {}
  var under = figma.createRectangle(); under.resize(160, 100); under.fills = solid('#F43F5E'); lm.appendChild(under);
  label('luminance mask', 480, 900);

  // noise effect (comes in as an image)
  var nz = rect(700, 770, 140, 100, '#6366F1'); nz.cornerRadius = 12;
  try { nz.effects = [{ type: 'NOISE', noiseType: 'MONOTONE', noiseSize: 1, density: 0.6, color: { r: 0, g: 0, b: 0, a: 0.4 }, visible: true, blendMode: 'NORMAL' }]; } catch (e) {}
  label('noise effect', 700, 900);

  // left-aligned paragraph with no line height set
  txt('A second paragraph that wraps onto several lines so each line can be checked.', 900, 760, { width: 300 });

  figma.currentPage.selection = [board];
  figma.viewport.scrollAndZoomIntoView([board]);
  figma.closePlugin('Test board ready');
}

drawBoard();
