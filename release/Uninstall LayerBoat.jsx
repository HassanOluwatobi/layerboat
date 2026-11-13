// Uninstall LayerBoat.jsx
// Run it in After Effects with File > Scripts > Run Script File.
// It removes everything the installer added. Your projects and artwork are not touched.
(function () {
  var isMac = $.os.toLowerCase().indexOf('mac') !== -1;
  var removed = 0, missed = [];

  function rmTree(f) {
    if (!f || !f.exists) return true;
    if (f instanceof Folder) {
      var kids = f.getFiles();
      for (var i = 0; i < kids.length; i++) rmTree(kids[i]);
    }
    var ok = false;
    try { ok = f.remove(); } catch (e) {}
    if (ok) removed++; else missed.push(f.fsName);
    return ok;
  }

  // 1. Stop the helper, so its files can be removed
  try {
    var s = new Socket();
    s.timeout = 2;
    if (s.open('127.0.0.1:7317', 'binary')) {
      s.write('GET /quit HTTP/1.0\r\nHost: localhost\r\n\r\n');
      s.read(200);
      s.close();
    }
  } catch (eQ) {}
  if (isMac) { try { system.callSystem('pkill -f layerboat-helper'); } catch (eK) {} }
  $.sleep(500);

  // 2. The panel, in every After Effects version on this computer
  var prefsRoot = isMac ? new Folder('~/Library/Preferences/Adobe/After Effects') : new Folder(Folder.userData.fsName + '/Adobe/After Effects');
  var versions = prefsRoot.exists ? prefsRoot.getFiles(function (f) { return f instanceof Folder; }) : [];
  for (var v = 0; v < versions.length; v++) {
    var panels = versions[v].fsName + '/Scripts/ScriptUI Panels/';
    rmTree(new File(panels + 'LayerBoat.jsx'));
    rmTree(new File(panels + 'Bridge from Figma.jsx'));
  }

  // 2b. Copies made with After Effects' own File > Scripts > Install ScriptUI Panel,
  // which go into the After Effects program folder
  try {
    var appScripts = Folder.appPackage ? new Folder(Folder.appPackage.parent.fsName + '/Scripts') : null;
    var spots = appScripts ? [appScripts, new Folder(appScripts.fsName + '/ScriptUI Panels')] : [];
    for (var sp = 0; sp < spots.length; sp++) {
      if (!spots[sp].exists) continue;
      var ours = spots[sp].getFiles(function (f) { return f instanceof File && /^(LayerBoat|Install LayerBoat|Bridge from Figma).*\.jsx$/i.test(decodeURI(f.name)); });
      for (var o = 0; o < ours.length; o++) rmTree(ours[o]);
    }
  } catch (eApp) {}

  // 3. The Illustrator scripts, where the installer could add them
  var appRoot = isMac ? new Folder('/Applications') : new Folder(($.getenv('ProgramFiles') || 'C:/Program Files') + '/Adobe');
  var ais = appRoot.exists ? appRoot.getFiles('Adobe Illustrator*') : [];
  for (var a = 0; a < ais.length; a++) {
    if (!(ais[a] instanceof Folder)) continue;
    var presets = new Folder(ais[a].fsName + (isMac ? '/Presets.localized' : '/Presets'));
    var locales = presets.exists ? presets.getFiles(function (f) { return f instanceof Folder; }) : [];
    for (var l = 0; l < locales.length; l++) {
      var sf = new Folder(locales[l].fsName + '/Scripts');
      var mine = sf.exists ? sf.getFiles('LayerBoat - *.jsx') : [];
      for (var m = 0; m < mine.length; m++) rmTree(mine[m]);
    }
  }

  // 3b. The Photoshop script
  var pss = appRoot.exists ? appRoot.getFiles('Adobe Photoshop*') : [];
  for (var pi = 0; pi < pss.length; pi++) {
    if (!(pss[pi] instanceof Folder)) continue;
    var psf = new Folder(pss[pi].fsName + '/Presets/Scripts');
    var psMine = psf.exists ? psf.getFiles('LayerBoat - *.jsx') : [];
    for (var pm = 0; pm < psMine.length; pm++) rmTree(psMine[pm]);
  }

  // 4. LayerBoat's own folder: the helper, the Figma plugin and the Illustrator panel
  rmTree(new Folder(Folder.userData.fsName + '/LayerBoat'));
  // and the folder from before the rename
  rmTree(new Folder(Folder.userData.fsName + '/Figma Bridge'));

  var msg = missed.length
    ? 'LayerBoat is mostly removed. These could not be deleted, so remove them by hand:\n\n' + missed.join('\n')
    : 'LayerBoat is removed.';
  msg += '\n\nTwo things to finish by hand:\n1. Restart After Effects so LayerBoat leaves the Window menu.\n2. In Figma, open Plugins > Manage plugins > In development and remove LayerBoat.';
  alert(msg, 'Uninstall LayerBoat');
})();
