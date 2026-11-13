/* global ScriptUI, bridgeSendToAE, bridgeSendToFigma, bridgeFromFigma */
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
  function run(btn, label, fn) {
    btn.onClick = function () {
      if (!app.documents.length && fn !== bridgeFromFigma) { status.text = 'Open a document first.'; return; }
      status.text = label + '...';
      w.update();
      var m = '';
      try { m = fn(fn === bridgeFromFigma ? 0 : undefined); } catch (e) { m = 'Something went wrong: ' + e; }
      status.text = m || 'Done.';
    };
  }
  run(toAE, 'Sending to After Effects', bridgeSendToAE);
  run(toFigma, 'Sending to Figma', bridgeSendToFigma);
  run(fromFigma, 'Bringing in from Figma', bridgeFromFigma);
  w.onClose = function () { $.global.__bridgePanel = null; return true; };
  $.global.__bridgePanel = w;
  w.show();
})();
