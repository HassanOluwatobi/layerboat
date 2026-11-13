// Installs LayerBoat, on macOS and Windows, from inside After Effects.
// In After Effects choose File > Scripts > Run Script File... and pick this file.
(function installBridge() {
  var VERSION = '@@VERSION@@';
  var src = File($.fileName).parent;
  var isMac = $.os.toLowerCase().indexOf('mac') !== -1;
  var home = new Folder(Folder.userData.fsName + '/LayerBoat');
  var report = [];

  function fail(msg) { alert(msg, 'LayerBoat'); }
  function sh(cmd) { try { return system.callSystem(cmd); } catch (e) { return ''; } }
  function ensure(folder) { if (!folder.exists) folder.create(); return folder.exists; }
  function copy(from, to) {
    var f = new File(from);
    if (!f.exists) return false;
    var t = new File(to);
    if (t.exists) t.remove();
    return f.copy(to);
  }

  // 1. Let scripts write files and reach the relay. This setting is in
  // Settings > Scripting & Expressions, and the panel needs it.
  var sections = ['Main Pref Section', 'Main Pref Section v2'];
  for (var s = 0; s < sections.length; s++) {
    try { app.preferences.savePrefAsLong(sections[s], 'Pref_SCRIPTING_FILE_NETWORK_SECURITY', 1); } catch (eP) {}
  }
  try { app.preferences.saveToDisk(); app.preferences.reload(); } catch (eS) {}
  var probe = new File(Folder.temp.fsName + '/figma-bridge-install-check.txt');
  var canWrite = false;
  try { canWrite = probe.open('w') && probe.write('ok'); probe.close(); probe.remove(); } catch (eW) {}
  if (!canWrite) {
    fail('Almost there. Turn on ' + (isMac ? 'After Effects > Settings' : 'Edit > Preferences') +
      ' > Scripting & Expressions > "Allow Scripts to Write Files and Access Network", then run this installer again.');
    return;
  }

  // 2. Stop an older relay, so the new one starts next time
  try {
    var q = new Socket();
    q.timeout = 1;
    if (q.open('127.0.0.1:7317', 'BINARY')) { q.write('GET /quit HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n'); q.read(50); q.close(); $.sleep(400); }
  } catch (eQ) {}

  // 3. The relay and the Figma plugin
  if (!ensure(home) || !ensure(new Folder(home.fsName + '/relay')) || !ensure(new Folder(home.fsName + '/Figma Plugin'))) {
    fail('Could not create ' + home.fsName + '.'); return;
  }
  var relays = isMac ? ['layerboat-helper-arm64', 'layerboat-helper-amd64'] : ['layerboat-helper-windows-amd64.exe', 'layerboat-helper-windows-arm64.exe'];
  for (var r = 0; r < relays.length; r++) {
    if (!copy(src.fsName + '/relay/' + relays[r], home.fsName + '/relay/' + relays[r])) { fail('The relay files are missing. Keep this installer in the LayerBoat folder it came in.'); return; }
  }
  if (isMac) {
    var rd = home.fsName + '/relay';
    sh('/bin/sh -c "chmod +x \'' + rd + '\'/layerboat-helper-*; xattr -dr com.apple.quarantine \'' + rd + '\' 2>/dev/null; codesign --force -s - \'' + rd + '\'/layerboat-helper-arm64 \'' + rd + '\'/layerboat-helper-amd64 2>/dev/null; true"');
  }
  // 3a. A launcher Illustrator can open, since Illustrator scripts cannot run programs.
  // On a Mac it is a small background app; on Windows a script that starts the relay hidden.
  try {
    if (isMac) {
      var appDir = home.fsName + '/relay/LayerBoat Helper.app/Contents';
      if (ensure(new Folder(home.fsName + '/relay/LayerBoat Helper.app')) && ensure(new Folder(appDir)) && ensure(new Folder(appDir + '/MacOS'))) {
        var plist = new File(appDir + '/Info.plist');
        plist.encoding = 'UTF-8'; plist.lineFeed = 'Unix'; plist.open('w');
        plist.write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
          '<plist version="1.0"><dict>' +
          '<key>CFBundleExecutable</key><string>run</string>' +
          '<key>CFBundleIdentifier</key><string>local.figmabridge.relay</string>' +
          '<key>CFBundleName</key><string>LayerBoat Relay</string>' +
          '<key>CFBundlePackageType</key><string>APPL</string>' +
          '<key>CFBundleVersion</key><string>' + VERSION + '</string>' +
          '<key>LSBackgroundOnly</key><true/><key>LSUIElement</key><true/>' +
          '</dict></plist>\n');
        plist.close();
        var run = new File(appDir + '/MacOS/run');
        run.encoding = 'UTF-8'; run.lineFeed = 'Unix'; run.open('w');
        run.write('#!/bin/sh\nDIR="$(cd "$(dirname "$0")/../../.." && pwd)"\nBIN="$DIR/layerboat-helper-amd64"\n[ "$(uname -m)" = "arm64" ] && BIN="$DIR/layerboat-helper-arm64"\nexec "$BIN"\n');
        run.close();
        var ad = home.fsName + '/relay/LayerBoat Helper.app';
        sh('/bin/sh -c "chmod +x \'' + appDir + '/MacOS/run\'; xattr -dr com.apple.quarantine \'' + ad + '\' 2>/dev/null; codesign --force -s - \'' + ad + '\' 2>/dev/null; true"');
      }
    } else {
      var wa = ($.getenv('PROCESSOR_ARCHITEW6432') || $.getenv('PROCESSOR_ARCHITECTURE') || '').toUpperCase();
      var exe = new File(home.fsName + '/relay/layerboat-helper-windows-' + (wa === 'ARM64' ? 'arm64' : 'amd64') + '.exe');
      var vbs = new File(home.fsName + '/relay/start-relay.vbs');
      vbs.encoding = 'UTF-8'; vbs.open('w');
      vbs.writeln('CreateObject("WScript.Shell").Run """' + exe.fsName + '""", 0, False');
      vbs.close();
    }
  } catch (eL) { report.push('The relay launcher for Illustrator could not be made: ' + eL); }

  var plugFiles = ['manifest.json', 'code.js', 'ui.html'];
  for (var p = 0; p < plugFiles.length; p++) copy(src.fsName + '/Figma Plugin/' + plugFiles[p], home.fsName + '/Figma Plugin/' + plugFiles[p]);
  var manifest = home.fsName + '/Figma Plugin/manifest.json';

  // 3b. The Illustrator script, kept with LayerBoat and added to Illustrator's own Scripts menu where allowed
  var aiScripts = ['LayerBoat Panel.jsx', 'Send to After Effects.jsx', 'Send to Figma.jsx', 'Bring in from Figma.jsx'];
  var aiScript = src.fsName + '/Illustrator/Send to After Effects.jsx';
  var aiAdded = 0, aiFound = 0;
  // nothing here may stop the install
  try { if (new File(aiScript).exists && ensure(new Folder(home.fsName + '/Illustrator'))) {
    for (var as = 0; as < aiScripts.length; as++) copy(src.fsName + '/Illustrator/' + aiScripts[as], home.fsName + '/Illustrator/' + aiScripts[as]);
    // what the panel runs; kept out of Illustrator's Scripts menu
    copy(src.fsName + '/Illustrator/LayerBoat actions.jsx', home.fsName + '/Illustrator/LayerBoat actions.jsx');
    var appRoot = isMac ? new Folder('/Applications') : new Folder(($.getenv('ProgramFiles') || 'C:/Program Files') + '/Adobe');
    var ais = appRoot.exists ? appRoot.getFiles('Adobe Illustrator*') : [];
    for (var ai = 0; ai < ais.length; ai++) {
      if (!(ais[ai] instanceof Folder)) continue;
      var presets = new Folder(ais[ai].fsName + (isMac ? '/Presets.localized' : '/Presets'));
      var locales = presets.exists ? presets.getFiles(function (f) { return f instanceof Folder; }) : [];
      for (var lc = 0; lc < locales.length; lc++) {
        var sf = new Folder(locales[lc].fsName + '/Scripts');
        if (!sf.exists) continue;
        aiFound++;
        var okAll = true;
        for (var as2 = 0; as2 < aiScripts.length; as2++) {
          if (!new File(src.fsName + '/Illustrator/' + aiScripts[as2]).exists) continue;
          if (!copy(src.fsName + '/Illustrator/' + aiScripts[as2], sf.fsName + '/LayerBoat - ' + aiScripts[as2])) okAll = false;
        }
        if (okAll) aiAdded++;
      }
    }
  } } catch (eAi) {}

  // 4. The panel, for every After Effects version on this computer
  var panelSrc = src.fsName + '/LayerBoat.jsx';
  var prefsRoot = isMac ? new Folder('~/Library/Preferences/Adobe/After Effects') : new Folder(Folder.userData.fsName + '/Adobe/After Effects');
  var versions = prefsRoot.exists ? prefsRoot.getFiles(function (f) { return f instanceof Folder; }) : [];
  var installed = 0, wasThere = false;
  for (var v = 0; v < versions.length; v++) {
    var panels = new Folder(versions[v].fsName + '/Scripts/ScriptUI Panels');
    if (!ensure(new Folder(versions[v].fsName + '/Scripts')) || !ensure(panels)) continue;
    if (new File(panels.fsName + '/LayerBoat.jsx').exists) wasThere = true;
    // the panel's name before LayerBoat; left in place it would open the old version
    var oldPanel = new File(panels.fsName + '/' + 'Bridge from ' + 'Figma.jsx');
    if (oldPanel.exists) { wasThere = true; try { oldPanel.remove(); } catch (eOld) {} }
    // removed first, so a file saved as "Layerboat.jsx" takes the new spelling
    try { var prev = new File(panels.fsName + '/LayerBoat.jsx'); if (prev.exists) prev.remove(); } catch (ePrev) {}
    if (copy(panelSrc, panels.fsName + '/LayerBoat.jsx')) installed++;
  }
  if (!installed) report.push('The panel could not be added to the Window menu. Copy "LayerBoat.jsx" into After Effects\' Scripts/ScriptUI Panels folder.');

  // 5. Open the panel straight away, so there is no need to restart
  try { $.evalFile(new File(panelSrc)); } catch (eO) { report.push('Open the panel from Window > LayerBoat.jsx after restarting After Effects. (' + eO + ')'); }

  // 6. The one step left in Figma
  var w = new Window('dialog', 'LayerBoat ' + VERSION + ' is installed');
  w.orientation = 'column'; w.alignChildren = ['fill', 'top']; w.spacing = 10; w.margins = 18; w.preferredSize.width = 620;
  w.add('statictext', undefined, 'The LayerBoat panel is open. From now on it is also in Window > LayerBoat.jsx.', { multiline: true }).preferredSize = [560, 34];
  // a panel that was already docked keeps running the old version until it is reopened
  if (wasThere) w.add('statictext', undefined, 'Updating? If the LayerBoat panel was already open, close it and open it again from Window > LayerBoat.jsx. Until then it runs the old version.', { multiline: true }).preferredSize = [560, 34];
  w.add('statictext', undefined, 'One step left, in Figma: Plugins > Development > Import plugin from manifest..., then choose this file:', { multiline: true }).preferredSize = [560, 34];
  var path = w.add('edittext', undefined, manifest, { readonly: true });
  path.preferredSize = [560, 24];
  var row = w.add('group');
  var copyBtn = row.add('button', undefined, 'Copy path');
  var showBtn = row.add('button', undefined, isMac ? 'Show in Finder' : 'Show in Explorer');
  var done = row.add('button', undefined, 'Done', { name: 'ok' });
  if (isMac) w.add('statictext', undefined, 'In the file window, press Cmd+Shift+G, paste and press Return.');
  var aiText = aiAdded ? 'Illustrator: restart it once. Then choose File > Scripts > LayerBoat - LayerBoat Panel. The panel stays open beside your artwork.' :
    'Illustrator: use the Bring in from Illustrator button in the panel. To work from Illustrator itself, run LayerBoat/Illustrator/LayerBoat Panel.jsx with File > Scripts > Other Script.';
  w.add('statictext', undefined, aiText, { multiline: true }).preferredSize = [560, 34];
  if (report.length) w.add('statictext', undefined, report.join(' '), { multiline: true }).preferredSize = [420, 50];
  copyBtn.onClick = function () {
    if (isMac) sh('/bin/sh -c "printf \'%s\' \'' + manifest + '\' | pbcopy"');
    else sh('cmd /c "echo|set /p=' + manifest + '|clip"');
    copyBtn.text = 'Copied';
  };
  showBtn.onClick = function () { new Folder(home.fsName + '/Figma Plugin').execute(); };
  done.onClick = function () { w.close(); };
  w.show();
})();
