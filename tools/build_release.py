# Builds release/dist/LayerBoat and a zip of it.
import os, shutil, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rel = os.path.join(root, 'release')
out = os.path.join(rel, 'dist', 'LayerBoat')
shutil.rmtree(os.path.join(rel, 'dist'), ignore_errors=True)
os.makedirs(os.path.join(out, 'relay'))
os.makedirs(os.path.join(out, 'Figma Plugin'))
core = open(os.path.join(root, 'after-effects', 'layerboat-core.jsx'), encoding='utf-8').read()
tpl = open(os.path.join(rel, 'panel-template.jsx'), encoding='utf-8').read()
import json as _json
ai_src = open(os.path.join(root, 'after-effects', 'illustrator-export.jsx'), encoding='utf-8').read()
# kept as plain ASCII, so the panel file reads the same in every encoding
_imp_src = open(os.path.join(root, 'after-effects', 'illustrator-import.jsx'), encoding='utf-8').read()
panel = tpl.replace('/*@@CORE@@*/', core).replace('/*@@AI@@*/', _json.dumps(ai_src, ensure_ascii=True)).replace('/*@@AIIMP@@*/', _json.dumps(_imp_src, ensure_ascii=True))
os.makedirs(os.path.join(out, 'Illustrator'))
import_src = open(os.path.join(root, 'after-effects', 'illustrator-import.jsx'), encoding='utf-8').read()
# Illustrator scripts cannot reach the network, so the relay is started through a
# launcher the installer makes, and the artwork is left in a file it watches
relay_start = (
    "function bridgeStartRelay() {\n"
    "  var rd = Folder.userData.fsName + '/LayerBoat/relay';\n"
    "  var l = $.os.toLowerCase().indexOf('mac') !== -1 ? new File(rd + '/LayerBoat Helper.app') : new File(rd + '/start-relay.vbs');\n"
    "  if (!l.exists) return false;\n"
    "  try { return l.execute(); } catch (e) { return false; }\n"
    "}\n")
# The three actions, each giving back a message for the person, or '' when all went well
ae_link = (
    "function bridgeAETarget() {\n"
    "  if (typeof BridgeTalk === 'undefined') return null;\n"
    "  try { if (BridgeTalk.isRunning('aftereffects')) return 'aftereffects'; } catch (e0) {}\n"
    "  for (var v = 40; v >= 20; v--) {\n"
    "    var spec = null;\n"
    "    try { spec = BridgeTalk.getSpecifier('aftereffects', String(v)); } catch (e1) {}\n"
    "    if (spec) { try { if (BridgeTalk.isRunning(spec)) return spec; } catch (e2) {} }\n"
    "  }\n"
    "  return null;\n"
    "}\n"
    "function bridgeAskAE() {\n"
    "  var spec = bridgeAETarget();\n"
    "  if (!spec || !new File(Folder.userData.fsName + '/LayerBoat/layerboat-core.jsx').exists) return;\n"
    "  try {\n"
    "    var bt = new BridgeTalk();\n"
    "    bt.target = spec;\n"
    "    bt.body = \"$.evalFile(new File(Folder.userData.fsName + '/LayerBoat/layerboat-core.jsx')); LayerBoatCore.buildInbox();\";\n"
    "    bt.send();\n"
    "  } catch (e) {}\n"
    "}\n")
actions = ae_link + (
    "function bridgeSendToAE() {\n"
    "  var r = LayerBoatAI_export({ post: true });\n"
    "  if (String(r).indexOf('ERR') === 0) return String(r).substring(4);\n"
    "  // the LayerBoat panel picks the artwork up within a second. When it is closed,\n"
    "  // After Effects is asked to build it directly.\n"
    "  var inbox = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');\n"
    "  for (var i = 0; i < 6 && inbox.exists; i++) $.sleep(250);\n"
    "  if (inbox.exists) bridgeAskAE();\n"
    "  for (var j = 0; j < 40 && inbox.exists; j++) $.sleep(250);\n"
    "  if (inbox.exists) return bridgeAETarget() ? 'The artwork is ready, but After Effects has not picked it up. If After Effects is showing its Home screen or a dialog, close it, then send again.' : 'Open After Effects, then send again.';\n"
    "  return '';\n"
    "}\n"
    "function bridgeSendToFigma() {\n"
    "  var home = Folder.userData.fsName + '/LayerBoat';\n"
    "  if (!bridgeStartRelay()) return 'The helper that talks to Figma is missing. Run Install LayerBoat.jsx in After Effects again.';\n"
    "  var r = LayerBoatAI_export({ post: true, forFigma: true });\n"
    "  if (String(r).indexOf('ERR') === 0) return String(r).substring(4);\n"
    "  var drop = new File(home + '/to-figma.json'), taken = new File(home + '/to-figma.taken');\n"
    "  // the helper takes the file within a second, then Figma takes it from the helper\n"
    "  for (var i = 0; i < 40 && drop.exists; i++) $.sleep(250);\n"
    "  if (drop.exists) return 'The helper that talks to Figma did not start. Run Install LayerBoat.jsx in After Effects again, then send again.';\n"
    "  for (var k = 0; k < 40 && !taken.exists; k++) $.sleep(250);\n"
    "  if (!taken.exists) return 'The artwork is ready for Figma. Open the LayerBoat plugin in Figma (Plugins > Development > LayerBoat) and it comes in straight away.';\n"
    "  return '';\n"
    "}\n"
    "function bridgeFromFigma(wait) {\n"
    "  var r = LayerBoatAI_import({ startRelay: bridgeStartRelay, wait: wait });\n"
    "  if (r === 'WAIT') return 'LayerBoat is ready for Figma. In Figma, select a frame, open the LayerBoat plugin and click Send to Illustrator. Then bring it in again.';\n"
    "  if (String(r).indexOf('ERR') === 0) return String(r).substring(4);\n"
    "  return String(r).indexOf('(') !== -1 || String(r).indexOf('Fonts') !== -1 ? 'Brought in ' + String(r).substring(3) : '';\n"
    "}\n")
common = ai_src + '\n' + import_src + '\n' + relay_start + actions
def script(head, call):
    return head + common + '(function () {\n  var m = ' + call + ';\n  if (m) alert(\'LayerBoat: \' + m);\n})();\n'
open(os.path.join(out, 'Illustrator', 'Send to After Effects.jsx'), 'w', encoding='utf-8').write(script(
    '// LayerBoat for Illustrator: sends the selection, or everything on the active artboard,\n'
    '// to the LayerBoat panel in After Effects. The panel must have Receive live ticked.\n', 'bridgeSendToAE()'))
open(os.path.join(out, 'Illustrator', 'Send to Figma.jsx'), 'w', encoding='utf-8').write(script(
    '// LayerBoat for Illustrator: sends the selection, or everything on the active artboard,\n'
    '// to Figma. The LayerBoat plugin must be open in Figma.\n', 'bridgeSendToFigma()'))
open(os.path.join(out, 'Illustrator', 'Bring in from Figma.jsx'), 'w', encoding='utf-8').write(script(
    '// LayerBoat for Illustrator: brings in what you sent from the LayerBoat plugin in Figma.\n'
    '// Run it, then click Send to Illustrator in Figma if you have not already.\n', 'bridgeFromFigma(45)'))
# A floating panel that stays open in Illustrator. It runs in its own script engine,
# so it lives on after the script that opened it has finished.
panel_ai = ('#targetengine "bridge"\n'
    '// LayerBoat for Illustrator: a small panel with every LayerBoat action. Run it once\n'
    '// from File > Scripts and keep it open beside your artwork.\n'
    + common + open(os.path.join(rel, 'illustrator-panel.jsx'), encoding='utf-8').read())
open(os.path.join(out, 'Illustrator', 'LayerBoat Panel.jsx'), 'w', encoding='utf-8').write(panel_ai)
open(os.path.join(out, 'Illustrator', 'LayerBoat actions.jsx'), 'w', encoding='utf-8').write(
    '// LayerBoat for Illustrator: the actions the LayerBoat panel runs. Open the panel, not this file.\n' + common)
open(os.path.join(out, 'LayerBoat.jsx'), 'w', encoding='utf-8').write(panel)
# Photoshop: one script, in File > Scripts, that sends the open document to After Effects
os.makedirs(os.path.join(out, 'Photoshop'))
ps_src = open(os.path.join(root, 'photoshop', 'photoshop-export.jsx'), encoding='utf-8').read()
ps_send = (
    "function bridgePSSendToAE() {\n"
    "  if (!bridgeAETarget()) return 'Open After Effects first, then send again.';\n"
    "  var r = LayerBoatPS_export({ post: true });\n"
    "  if (String(r).indexOf('ERR') === 0) return String(r).substring(4);\n"
    "  // the LayerBoat panel picks the artwork up within a second. When it is closed,\n"
    "  // After Effects is asked to build it directly.\n"
    "  var inbox = new File(Folder.userData.fsName + '/LayerBoat/incoming-ai.json');\n"
    "  for (var i = 0; i < 6 && inbox.exists; i++) $.sleep(250);\n"
    "  if (inbox.exists) bridgeAskAE();\n"
    "  for (var j = 0; j < 60 && inbox.exists; j++) $.sleep(250);\n"
    "  if (inbox.exists) return 'The artwork is ready, but After Effects has not picked it up. If After Effects is showing its Home screen or a dialog, close it, then send again.';\n"
    "  return '';\n"
    "}\n")
open(os.path.join(out, 'Photoshop', 'Send to After Effects.jsx'), 'w', encoding='utf-8').write(
    '// LayerBoat for Photoshop: sends the open document to After Effects. Text stays\n'
    '// editable, shapes stay shapes, and every other layer arrives as an image.\n'
    '#target photoshop\n' + ps_src + '\n' + ae_link + ps_send +
    "(function () {\n  var m = bridgePSSendToAE();\n  if (m) alert('LayerBoat: ' + m);\n})();\n")
os.makedirs(os.path.join(out, 'support'), exist_ok=True)
open(os.path.join(out, 'support', 'layerboat-core.jsx'), 'w', encoding='utf-8').write('// LayerBoat: the builder After Effects runs when Illustrator sends artwork with the panel closed.\n' + core)
check = open(os.path.join(rel, 'check-template.jsx'), encoding='utf-8').read().replace('/*@@CORE@@*/', core)
open(os.path.join(out, 'LayerBoat check.jsx'), 'w', encoding='utf-8').write(check)
for b in ('layerboat-helper-arm64', 'layerboat-helper-amd64', 'layerboat-helper-windows-amd64.exe', 'layerboat-helper-windows-arm64.exe'):
    shutil.copy2(os.path.join(root, 'relay', b), os.path.join(out, 'relay', b))
for f in ('manifest.json', 'code.js', 'ui.html'):
    shutil.copy2(os.path.join(root, 'figma-plugin', f), os.path.join(out, 'Figma Plugin', f))
import re as _re
_ver = _re.search(r"VERSION = '([^']+)'", core).group(1)
inst = open(os.path.join(rel, 'Install LayerBoat.jsx'), encoding='utf-8').read().replace('@@VERSION@@', _ver)
open(os.path.join(out, 'Install LayerBoat.jsx'), 'w', encoding='utf-8').write(inst)
shutil.copy(os.path.join(rel, 'Uninstall LayerBoat.jsx'), os.path.join(out, 'Uninstall LayerBoat.jsx'))
shutil.copy2(os.path.join(rel, 'README.txt'), os.path.join(out, 'README.txt'))
import re
ver = re.search(r"VERSION = '([^']+)'", core).group(1)
zp = os.path.join(rel, 'dist', 'LayerBoat ' + ver + '.zip')
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, dn, fn in os.walk(out):
        for f in fn:
            full = os.path.join(dp, f)
            arc = os.path.relpath(full, os.path.dirname(out))
            info = zipfile.ZipInfo.from_file(full, arc)
            if f.startswith('bridge-relay'):
                info.external_attr = (0o755 << 16)
            with open(full, 'rb') as fh:
                z.writestr(info, fh.read(), zipfile.ZIP_DEFLATED)
print('built', zp, os.path.getsize(zp))
