// LayerBoat for After Effects
// Receives layers sent from the "LayerBoat to After Effects" Figma plugin and
// rebuilds them as native After Effects layers.
(function bridgePanel(thisObj) {
  var HOME = Folder.userData.fsName + '/LayerBoat';

  /*@@CORE@@*/

  var core = LayerBoatCore;
  core.setIllustratorSource(/*@@AI@@*/);
  core.setIllustratorImportSource(/*@@AIIMP@@*/);
  try { if (!Folder(HOME).exists) Folder(HOME).create(); } catch (e0) {}
  core.setLog(HOME + '/log.txt');
  core.setHome(HOME);

  var win = (thisObj instanceof Panel) ? thisObj : new Window('palette', 'LayerBoat', undefined, { resizeable: true });
  win.orientation = 'column';
  win.alignChildren = ['fill', 'top'];
  win.spacing = 8;
  win.margins = 12;
  var pasteBtn = win.add('button', undefined, 'Paste from Figma');
  pasteBtn.preferredSize.height = 34;
  var aiBtn = win.add('button', undefined, 'Bring in from Illustrator');
  aiBtn.helpTip = 'Brings the selection in Illustrator, or everything on its active artboard, into a new comp.';
  var aiRow = win.add('group');
  aiRow.orientation = 'row'; aiRow.alignChildren = ['fill', 'center']; aiRow.spacing = 6;
  var aiUpBtn = aiRow.add('button', undefined, 'Update from Illustrator');
  var aiRasBtn = aiRow.add('button', undefined, 'As an image');
  aiRasBtn.helpTip = 'Brings the selection in Illustrator, or its active artboard, into the open comp as one sharp image layer, in its place.';
  aiUpBtn.helpTip = 'Select a path, fill or stroke here and a shape in Illustrator. The selected properties take that shape\'s path and colours. Animated ones get a keyframe at the current time.';
  var intoActive = win.add('checkbox', undefined, 'Paste into the open comp');
  intoActive.value = false;
  var useNulls = win.add('checkbox', undefined, 'Parent layers to their groups');
  useNulls.value = true;
  var combine = win.add('checkbox', undefined, 'Combine icons into one layer');
  combine.value = true;
  combine.helpTip = 'Groups made only of vector shapes become one shape layer. Turn off to put every shape on its own layer.';
  var comps = win.add('checkbox', undefined, 'Figma components as precomps');
  comps.value = true;
  comps.helpTip = 'Each Figma component is built once as its own comp. Every copy is a layer of it, with its own text in Essential Graphics, so a change to the component shows in every copy.';
  var centre = win.add('checkbox', undefined, 'Centre anchor points');
  centre.value = true;
  centre.helpTip = 'Puts each layer\'s anchor point in its middle, so it turns and scales about its centre. Nothing moves on screen.';
  var live = win.add('checkbox', undefined, 'Receive live from Figma');
  live.value = true;
  var update = win.add('checkbox', undefined, 'Update the comp when sending again');
  update.value = true;
  update.helpTip = 'Sending a frame you sent before rebuilds it in the same comp and keeps your keyframes, effects and own layers.';
  var sendBtn = win.add('button', undefined, 'Send comp to Figma');
  var sendAiBtn = win.add('button', undefined, 'Send comp to Illustrator');
  sendAiBtn.helpTip = 'Opens the comp, or its selected layers, in Illustrator on a new artboard. Layers keep their names and text stays editable.';
  sendBtn.helpTip = 'Sends the open comp, or just the selected layers, to the LayerBoat plugin in Figma.';
  var tools = win.add('panel', undefined, 'Groups');
  tools.orientation = 'column'; tools.alignChildren = ['fill', 'top']; tools.spacing = 4; tools.margins = [8, 12, 8, 8];
  var row1 = tools.add('group'); row1.alignChildren = ['fill', 'center'];
  var selBtn = row1.add('button', undefined, 'Select group');
  selBtn.helpTip = 'Selects every layer parented to the selected group layer.';
  var helpBtn = row1.add('button', undefined, 'Show helpers');
  helpBtn.helpTip = 'Shows or hides the helper layers LayerBoat adds for groups and backgrounds.';
  var row2 = tools.add('group'); row2.alignChildren = ['fill', 'center'];
  var pcBtn = row2.add('button', undefined, 'Precomp group');
  pcBtn.helpTip = 'Moves the selected group layer and everything parented to it into its own comp.';
  var relBtn = row2.add('button', undefined, 'Release group');
  relBtn.helpTip = 'Unparents the layers of the selected group, keeping where they sit.';
  var status = win.add('statictext', undefined, 'Copy in Figma, then click Paste.', { multiline: true });
  status.preferredSize = [220, 70];

  // the options are remembered between sessions
  var SECTION = 'LayerBoat';
  function loadOpt(box, key) { try { if (app.settings.haveSetting(SECTION, key)) box.value = app.settings.getSetting(SECTION, key) === '1'; } catch (e) {} }
  function saveOpt(box, key) { box.onClick = (function (prev) { return function () { try { app.settings.saveSetting(SECTION, key, box.value ? '1' : '0'); } catch (e) {} if (prev) prev(); }; })(box.onClick); }
  var boxes = [[intoActive, 'intoActive'], [useNulls, 'nulls'], [combine, 'combine'], [comps, 'components'], [update, 'update'], [centre, 'centre']];
  for (var bi = 0; bi < boxes.length; bi++) { loadOpt(boxes[bi][0], boxes[bi][1]); saveOpt(boxes[bi][0], boxes[bi][1]); }

  function opts() { return { intoActive: intoActive.value, nulls: useNulls.value, combine: combine.value, components: comps.value, update: update.value, centerAnchors: centre.value }; }
  function setStatus(t) { status.text = t; try { win.layout.layout(true); } catch (e) {} }

  function startLive() {
    try {
      if (!core.canUseSystem()) {
        setStatus('Turn on Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network", then tick Receive live again.');
        live.value = false;
        return;
      }
      core.listen(function (data) {
        setStatus('Building ' + (data.name || 'layers') + '...');
        core.build(data, opts());
        setStatus(core.lastStatus || 'Done.');
      }, setStatus);
    } catch (e) { setStatus('Live mode error: ' + core.errText(e)); }
  }

  pasteBtn.onClick = function () {
    try {
      setStatus('Pasting...');
      core.run(opts(), function () { setStatus(core.lastStatus || 'Done.'); });
    } catch (e) {
      alert('LayerBoat error: ' + core.errText(e));
    }
  };

  function tool(fn, undoName) {
    return function () {
      try {
        var t = fn();
        setStatus(t);
      } catch (e) { setStatus((undoName || 'LayerBoat') + ' error: ' + core.errText(e)); }
    };
  }
  sendBtn.onClick = tool(function () {
    if (!core.canUseSystem()) return 'Turn on Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" first.';
    setStatus('Sending...');
    return core.sendToFigma();
  }, 'Send');
  sendAiBtn.onClick = tool(function () {
    // Illustrator's answer arrives through live mode, so it is switched on
    if (!live.value) { live.value = true; startLive(); }
    setStatus('Sending...');
    return core.sendToIllustrator();
  }, 'Send');
  aiBtn.onClick = tool(function () {
    if (!core.canUseSystem()) return 'Turn on Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" first.';
    // the artwork arrives through live mode, so it is switched on
    if (!live.value) { live.value = true; startLive(); }
    return core.fromIllustrator();
  }, 'Illustrator');
  aiUpBtn.onClick = tool(function () {
    if (!core.canUseSystem()) return 'Turn on Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" first.';
    // the answer arrives through live mode, so it is switched on
    if (!live.value) { live.value = true; startLive(); }
    return core.updateFromIllustrator();
  }, 'Update');
  aiRasBtn.onClick = tool(function () {
    if (!core.canUseSystem()) return 'Turn on Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" first.';
    if (!live.value) { live.value = true; startLive(); }
    return core.rasterizeFromIllustrator();
  }, 'Image');
  selBtn.onClick = tool(core.selectGroup, 'Select group');
  pcBtn.onClick = tool(core.groupToPrecomp, 'Precomp group');
  relBtn.onClick = tool(core.releaseGroup, 'Release group');
  helpBtn.onClick = tool(function () { var t = core.toggleHelpers(); helpBtn.text = /hidden|Hid/.test(t) ? 'Show helpers' : 'Hide helpers'; return t; }, 'Helpers');

  live.onClick = function () {
    if (live.value) startLive();
    else { core.stopListening(); setStatus('Live mode is off. Copy in Figma, then click Paste.'); }
  };

  win.onResizing = win.onResize = function () { this.layout.resize(); };
  // a floating window opened by the installer is kept, so it does not vanish when the installer ends
  if (win instanceof Window) { $.global.__figmaBridgeWindow = win; win.center(); win.show(); } else { win.layout.layout(true); }
  if (live.value) startLive();
})(this);
