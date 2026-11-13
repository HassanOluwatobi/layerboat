// Regression run: rebuilds every saved design in dev/fixtures with the core
// on disk, renders each comp's first frame to dev/fixtures-out, and notes
// how long each took. tests/regress.py then compares the renders with
// Figma's own exports and reports what changed.
(function () {
  var dev = File($.fileName).parent.fsName;
  var CORE = File(dev).parent.fsName + '/after-effects/layerboat-core.jsx';
  var cf = new File(CORE); cf.encoding = 'UTF-8'; cf.open('r'); var code = cf.read(); cf.close();
  eval(code);
  var core = LayerBoatCore;
  core.setLog(File(CORE).parent.fsName + '/log.txt');
  var outDir = new Folder(dev + '/fixtures-out'); if (!outDir.exists) outDir.create();
  var list = new Folder(dev + '/fixtures').getFiles('*.json');
  var onlyF = new File(dev + '/regress-only.txt');
  if (onlyF.exists) { onlyF.open('r'); var only = onlyF.read().replace(/\s+/g, ''); onlyF.close(); var keep = []; for (var q = 0; q < list.length; q++) if (decodeURI(list[q].name).indexOf(only) === 0) keep.push(list[q]); list = keep; }
  var report = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (/^baseline/.test(decodeURI(f.name))) continue;
    f.encoding = 'UTF-8'; f.open('r'); var data = JSON.parse(f.read()); f.close();
    var name = decodeURI(f.name).replace(/\.json$/, '');
    var before = {};
    for (var k = 1; k <= app.project.numItems; k++) before[app.project.item(k).id] = true;
    var t0 = new Date().getTime(), err = '';
    try { core.build(data, { intoActive: false, nulls: true, combine: true, update: false }); } catch (e) { err = String(e); }
    var secs = (new Date().getTime() - t0) / 1000;
    var comp = null, made = [];
    for (var j = 1; j <= app.project.numItems; j++) {
      var it = app.project.item(j);
      if (before[it.id]) continue;
      made.push(it);
      if (it instanceof CompItem && it.name === data.name && (!it.parentFolder || it.parentFolder.name !== 'Figma Precomps')) comp = it;
    }
    if (comp) {
      comp.saveFrameToPng(0, new File(outDir.fsName + '/' + name + '.png'));
      report.push(name + '\t' + secs.toFixed(1) + 's\t' + comp.numLayers + ' layers' + (err ? '\terror ' + err : ''));
    } else report.push(name + '\tno comp built\t' + err);
    // leave the project as it was
    for (var m = made.length - 1; m >= 0; m--) { try { if (made[m] instanceof CompItem) made[m].remove(); } catch (eR) {} }
    for (var n = made.length - 1; n >= 0; n--) { try { made[n].remove(); } catch (eR2) {} }
  }
  var rf = new File(outDir.fsName + '/report.txt'); rf.open('w'); rf.write(report.join('\n')); rf.close();
})();
