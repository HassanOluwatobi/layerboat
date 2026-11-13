// LayerBoat check: tries every part of LayerBoat on this computer and writes down what
// worked. Run it in After Effects with File > Scripts > Run Script File, after
// installing. It saves "LayerBoat check.txt" on the Desktop.
(function () {
  var HOME = Folder.userData.fsName + '/LayerBoat';

  /*@@CORE@@*/

  var core = LayerBoatCore;
  core.setLog(HOME + '/log.txt');
  core.setHome(HOME);
  var report = '';
  try { report = core.selfCheck(); } catch (e) { report = 'The check stopped: ' + core.errText(e) + (e.line ? ' (line ' + e.line + ')' : ''); }
  var out = new File(Folder.desktop.fsName + '/LayerBoat check.txt');
  try { out.encoding = 'UTF-8'; out.open('w'); out.write(report); out.close(); } catch (eW) {}
  var w = new Window('dialog', 'LayerBoat check');
  w.orientation = 'column'; w.alignChildren = ['fill', 'top']; w.margins = 16; w.spacing = 10;
  var t = w.add('edittext', undefined, report, { multiline: true, readonly: true, scrolling: true });
  t.preferredSize = [560, 320];
  w.add('statictext', undefined, out.exists ? 'Saved as "LayerBoat check.txt" on your Desktop.' : 'Copy the text above to keep it.');
  var b = w.add('button', undefined, 'Done', { name: 'ok' });
  b.onClick = function () { w.close(); };
  w.show();
})();
