// Simulates a Windows install and the live connection, using Wine for the
// Windows relay and a stand-in for After Effects' scripting runtime.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { makeRuntime } = require('./extendscript-mock');

const root = '/tmp/wsim';
fs.rmSync(root, { recursive: true, force: true });
const appData = root + '/AppData/Roaming', temp = root + '/Temp', dl = root + '/Downloads';
const aiScripts = root + '/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts';
for (const d of [appData + '/Adobe/After Effects/26.0', appData + '/Adobe/After Effects/25.3', temp, dl, aiScripts]) fs.mkdirSync(d, { recursive: true });
execSync('cd ' + dl + ' && unzip -q "' + process.argv[2] + '"');
const env = { NO_PROXY: '*', no_proxy: '*' };
try { execSync('curl -s -m 1 http://127.0.0.1:7317/quit', { env: Object.assign({}, process.env, env) }); } catch (e) {}

const rt = makeRuntime({ os: 'windows', userData: appData, temp, home: root, env: { PROCESSOR_ARCHITECTURE: 'AMD64', ProgramFiles: 'Z:\\tmp\\wsim\\Program Files' } });
const installer = dl + '/LayerBoat/Install LayerBoat.jsx';
let ok = true;
function check(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) ok = false; }

rt.run(fs.readFileSync(installer, 'utf8'), rt.toFs(installer));
const home = appData + '/LayerBoat';
check('relay copied (x64 and ARM)', fs.existsSync(home + '/relay/layerboat-helper-windows-amd64.exe') && fs.existsSync(home + '/relay/layerboat-helper-windows-arm64.exe'));
check('Figma plugin copied', ['manifest.json', 'code.js', 'ui.html'].every((f) => fs.existsSync(home + '/Figma Plugin/' + f)));
check('panel installed for both After Effects versions', ['26.0', '25.3'].every((v) => fs.existsSync(appData + '/Adobe/After Effects/' + v + '/Scripts/ScriptUI Panels/LayerBoat.jsx')));
check('scripting preference set', rt.log.some((l) => l.indexOf('Pref_SCRIPTING_FILE_NETWORK_SECURITY=1') !== -1));
check('no Mac commands on Windows', !rt.log.some((l) => /chmod|xattr|codesign|pbcopy|\/bin\/sh/.test(l)));
const vbs = temp + '/figma-bridge-start-relay.vbs';
check('relay started through a hidden VBScript', fs.existsSync(vbs) && /WScript\.Shell"\)\.Run """Z:\\.*layerboat-helper-windows-amd64\.exe""", 0, False/.test(fs.readFileSync(vbs, 'utf8')));
let alive = '';
for (let i = 0; i < 20 && alive.indexOf('relay') !== 0; i++) {
  try { alive = execSync('curl -s -m 1 http://127.0.0.1:7317/ping', { env: Object.assign({}, process.env, env) }).toString(); } catch (e) {}
  if (alive.indexOf('relay') !== 0) execSync('sleep 0.5');
}
check('Windows relay answering', alive.indexOf('relay') === 0);
check('installer dialog shown', rt.log.some((l) => l.indexOf('show window:dialog LayerBoat') === 0));
check('live mode scheduled', rt.tasks.length > 0);

// Figma sends a design, the panel's next poll picks it up
const G = rt.ctx.$.global;
let received = null;
G.__figmaBridgeOnData = (d) => { received = d; };
execSync('curl -s -m 2 -X POST --data-binary \'{"bridge":"figma-to-ae","version":1,"name":"Sim frame","layers":[]}\' http://127.0.0.1:7317/send', { env: Object.assign({}, process.env, env) });
rt.run('$.global.__figmaBridgePoll()');
check('design received by the panel', received && received.name === 'Sim frame');
const st = execSync('curl -s http://127.0.0.1:7317/status', { env: Object.assign({}, process.env, env) }).toString();
check('Figma sees it was picked up', st === 'taken');

// Illustrator: its script is installed, and artwork it leaves in the inbox is built
check('Illustrator script kept with LayerBoat', fs.existsSync(home + '/Illustrator/Send to After Effects.jsx'));
check('Illustrator script added to its Scripts menu', fs.existsSync(aiScripts + '/LayerBoat - Send to After Effects.jsx'));
received = null;
fs.writeFileSync(home + '/incoming-ai.json', JSON.stringify({ bridge: 'figma-to-ae', version: 1, source: 'illustrator', name: 'Sim artboard', layers: [{ type: 'group', children: [] }] }));
rt.run('$.global.__figmaBridgePoll()');
check('Illustrator artwork received by the panel', received && received.name === 'Sim artboard');
check('Illustrator inbox emptied', !fs.existsSync(home + '/incoming-ai.json'));
let shown = null;
G.__figmaBridgeOnStatus = (t) => { shown = t; };
received = null;
fs.writeFileSync(home + '/incoming-ai.json', JSON.stringify({ bridge: 'figma-to-ae', source: 'illustrator', message: 'Illustrator: Open a document first.', layers: [] }));
rt.run('$.global.__figmaBridgePoll()');
check('Illustrator message shown, nothing built', shown === 'Illustrator: Open a document first.' && !received);

// Illustrator and Figma: the scripts and the hidden launcher are installed, and the
// relay passes files both ways through the LayerBoat folder
check('Illustrator to Figma script installed', fs.existsSync(home + '/Illustrator/Send to Figma.jsx'));
check('Figma to Illustrator script installed', fs.existsSync(home + '/Illustrator/Bring in from Figma.jsx'));
check('Illustrator panel installed', fs.existsSync(home + '/Illustrator/LayerBoat Panel.jsx'));
const launcher = home + '/relay/start-relay.vbs';
check('hidden relay launcher made for Illustrator', fs.existsSync(launcher) && /WScript\.Shell"\)\.Run """Z:\\.*layerboat-helper-windows-amd64\.exe""", 0, False/.test(fs.readFileSync(launcher, 'utf8')));
try { fs.unlinkSync(home + '/to-figma.taken'); } catch (e) {}
fs.writeFileSync(home + '/to-figma.json', '{"bridge":"figma-to-ae","source":"illustrator","name":"Sim art","layers":[]}');
let fromAi = '';
for (let i = 0; i < 20 && !fromAi; i++) {
  execSync('sleep 0.3');
  fromAi = execSync('curl -s -m 2 "http://127.0.0.1:7317/next?for=figma"', { env: Object.assign({}, process.env, env) }).toString();
}
check('Illustrator artwork handed to Figma', fromAi.indexOf('Sim art') > 0 && !fs.existsSync(home + '/to-figma.json'));
check('Illustrator told Figma has it', fs.existsSync(home + '/to-figma.taken'));
execSync('curl -s -m 2 -X POST --data-binary "<svg width=\'10\' height=\'10\'/>" "http://127.0.0.1:7317/send?to=ai"', { env: Object.assign({}, process.env, env) });
check('Figma drawing left for Illustrator', fs.existsSync(home + '/from-figma.svg') && fs.readFileSync(home + '/from-figma.svg', 'utf8').indexOf('<svg') === 0);
const aiSt = execSync('curl -s "http://127.0.0.1:7317/status?to=ai"', { env: Object.assign({}, process.env, env) }).toString();
check('Figma sees the drawing waiting', aiSt === 'waiting');
fs.unlinkSync(home + '/from-figma.svg');

// the installer's Copy path button
function find(c, text) { if (c.text === text) return c; for (const k of c.children || []) { const f = find(k, text); if (f) return f; } return null; }
const dlg = rt.windows.find((w) => w.type === 'window:dialog');
const copyBtn = dlg && find(dlg, 'Copy path');
if (copyBtn) copyBtn.onClick();
const cmd = rt.log.filter((l) => l.indexOf('callSystem cmd /c') === 0).pop() || '';
check('Copy path uses the Windows clipboard', /echo\|set \/p=Z:\\.*manifest\.json\|clip/.test(cmd));
check('Copy path button confirms', copyBtn && copyBtn.text === 'Copied');

execSync('curl -s -m 1 http://127.0.0.1:7317/quit || true', { env: Object.assign({}, process.env, env) });
console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
