/* global ScriptUI, BridgeTalk, bridgeSendToAE, bridgeSendToFigma, bridgeFromFigma */
// The panel. One palette is kept, so running the script again brings it back
// instead of opening a second one.
(function () {
  if ($.global.__bridgePanel) {
    try { $.global.__bridgePanel.show(); return; } catch (eOld) { $.global.__bridgePanel = null; }
  }
  var w = new Window('palette', 'LayerBoat', undefined, { resizeable: true, closeButton: true });
  w.orientation = 'column';
  w.alignChildren = ['fill', 'top'];
  w.spacing = 6;
  w.margins = 10;
  function heading(t) { var s = w.add('statictext', undefined, t); try { s.graphics.font = ScriptUI.newFont(s.graphics.font.name, 'BOLD', s.graphics.font.size); } catch (eF) {} return s; }
  heading('After Effects');
  var toAE = w.add('button', undefined, 'Send to After Effects');
  toAE.helpTip = 'Sends the selection, or everything on the active artboard, to the LayerBoat panel in After Effects. Receive live must be ticked there.';
  heading('Figma');
  var toFigma = w.add('button', undefined, 'Send to Figma');
  toFigma.helpTip = 'Sends the selection, or everything on the active artboard, to the LayerBoat plugin in Figma.';
  var fromFigma = w.add('button', undefined, 'Bring in from Figma');
  fromFigma.helpTip = 'Brings in the frame you sent with Send to Illustrator in the LayerBoat plugin in Figma.';
  var status = w.add('statictext', undefined, 'Select artwork, or nothing for the whole artboard.', { multiline: true });
  status.preferredSize = [220, 64];
  // Illustrator gives a floating panel's buttons an unreliable view of the open
  // document, so each action is handed to Illustrator itself to run. The actions
  // live in "LayerBoat actions.jsx" beside this panel or in LayerBoat's own folder.
  var here = null;
  try { here = new File($.fileName).parent; } catch (eH) {}
  function actionsPath() {
    var spots = [Folder.userData.fsName + '/LayerBoat/Illustrator/LayerBoat actions.jsx'];
    if (here) spots.push(here.fsName + '/LayerBoat actions.jsx');
    for (var i = 0; i < spots.length; i++) {
      var f = new File(spots[i]);
      if (f.exists) return encodeURI(f.fsName.split(String.fromCharCode(92)).join('/')).split("'").join('%27');
    }
    return null;
  }
  function run(btn, label, fn, call) {
    btn.onClick = function () {
      if (!app.documents.length && fn !== bridgeFromFigma) { status.text = 'Open a document first.'; return; }
      status.text = label + '...';
      w.update();
      function done(m) { status.text = m || 'Done.'; }
      var path = actionsPath();
      if (path && typeof BridgeTalk !== 'undefined') {
        try {
          var bt = new BridgeTalk();
          // this copy of Illustrator, even when another year is installed too
          bt.target = BridgeTalk.appSpecifier || 'illustrator';
          bt.body = "$.evalFile(new File('" + path + "')); var __m = ''; try { __m = " + call + "; } catch (e) { __m = 'Something went wrong: ' + e; } __m || '';";
          bt.onResult = function (r) { done(r.body); };
          bt.onError = function (r) { done('Something went wrong: ' + r.body); };
          bt.send();
          return;
        } catch (eBT) {}
      }
      var m = '';
      try { m = fn(fn === bridgeFromFigma ? 0 : undefined); } catch (e) { m = 'Something went wrong: ' + e; }
      done(m);
    };
  }
  run(toAE, 'Sending to After Effects', bridgeSendToAE, 'bridgeSendToAE()');
  run(toFigma, 'Sending to Figma', bridgeSendToFigma, 'bridgeSendToFigma()');
  run(fromFigma, 'Bringing in from Figma', bridgeFromFigma, 'bridgeFromFigma(0)');
  w.onClose = function () { $.global.__bridgePanel = null; return true; };
  $.global.__bridgePanel = w;
  w.show();
})();
