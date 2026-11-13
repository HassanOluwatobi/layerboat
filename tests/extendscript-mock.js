// A small stand-in for After Effects' ExtendScript runtime, so LayerBoat's code
// can run in Node. With os 'Windows' it behaves like Windows: paths come out
// as Wine drive paths (Z:\...), and shell commands run through Wine.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

function makeRuntime(opts) {
  const win = opts.os === 'windows';
  const log = [];
  const toHost = (p) => {
    p = String(p);
    if (/^Z:[\\/]/i.test(p)) p = p.slice(2).replace(/\\/g, '/');
    if (p.startsWith('~')) p = opts.home + p.slice(1);
    return path.normalize(p);
  };
  const toFs = (p) => (win ? 'Z:' + p.replace(/\//g, '\\') : p);

  class FileBaseC {
    constructor(p) { this._p = toHost(p); this.encoding = 'UTF-8'; this.lineFeed = 'Unix'; this._mode = null; this._buf = ''; }
    get fsName() { return toFs(this._p); }
    get fullName() { return this._p; }
    get name() { return path.basename(this._p); }
    get parent() { return new FolderC(path.dirname(this._p)); }
    get exists() { return fs.existsSync(this._p); }
    remove() { try { fs.rmSync(this._p, { recursive: true }); return true; } catch (e) { return false; } }
    execute() { log.push('execute ' + this.fsName); return true; }
  }
  class FileC extends FileBaseC {
    open(mode) {
      this._mode = mode;
      if (mode === 'r') { if (!this.exists) return false; this._buf = fs.readFileSync(this._p, this.encoding === 'BINARY' ? 'latin1' : 'utf8'); this._pos = 0; }
      else this._buf = '';
      return true;
    }
    read() { const r = this._buf.slice(this._pos || 0); this._pos = this._buf.length; return r; }
    write(s) { this._buf += String(s); return true; }
    writeln(s) { this._buf += String(s) + (this.lineFeed === 'Windows' || (win && this.lineFeed !== 'Unix') ? '\r\n' : '\n'); return true; }
    close() {
      if (this._mode === 'w' || this._mode === 'a') {
        fs.mkdirSync(path.dirname(this._p), { recursive: true });
        fs.writeFileSync(this._p, this._buf, this.encoding === 'BINARY' ? 'latin1' : 'utf8');
      }
      this._mode = null; return true;
    }
    copy(to) { try { fs.copyFileSync(this._p, toHost(to instanceof FileBaseC ? to._p : to)); return true; } catch (e) { return false; } }
  }
  class FolderC extends FileBaseC {
    create() { fs.mkdirSync(this._p, { recursive: true }); return true; }
    getFiles(filter) {
      if (!this.exists) return [];
      return fs.readdirSync(this._p).map((n) => {
        const full = path.join(this._p, n);
        return fs.statSync(full).isDirectory() ? new FolderC(full) : new FileC(full);
      }).filter((f) => (typeof filter === 'function' ? filter(f) : true));
    }
  }
  // ExtendScript lets File() and Folder() be called with or without new
  function File(p) { return new FileC(p); }
  File.prototype = FileC.prototype;
  function Folder(p) { return new FolderC(p); }
  Folder.prototype = FolderC.prototype;
  Object.defineProperty(Folder, 'userData', { get: () => new Folder(opts.userData) });
  Object.defineProperty(Folder, 'temp', { get: () => new Folder(opts.temp) });

  // Synchronous sockets, done with curl: enough for LayerBoat's HTTP/1.0 calls.
  class Socket {
    constructor() { this.timeout = 3; this.connected = false; this._out = ''; this._resp = null; this.eof = false; this.error = ''; }
    open(hostPort) {
      this._hp = hostPort;
      try { execSync('curl -s -m 1 -o /dev/null http://' + hostPort + '/ping', { env: Object.assign({}, process.env, { NO_PROXY: '*', no_proxy: '*' }) }); this.connected = true; return true; }
      catch (e) { this.error = 'Cannot connect to ' + hostPort; return false; }
    }
    write(s) { this._out += s; return true; }
    read() {
      if (this._resp === null) {
        const head = this._out.split('\r\n\r\n')[0], body = this._out.slice(head.length + 4);
        const [method, p] = head.split('\r\n')[0].split(' ');
        let cmd = 'curl -s -i -m ' + this.timeout + ' -X ' + method + ' "http://' + this._hp + p + '"';
        if (body) { fs.writeFileSync(opts.temp + '/sock-body', body, 'latin1'); cmd += ' --data-binary @' + opts.temp + '/sock-body'; }
        try { this._resp = execSync(cmd, { env: Object.assign({}, process.env, { NO_PROXY: '*', no_proxy: '*' }) }).toString('latin1'); } catch (e) { this._resp = ''; }
        this._resp = this._resp.replace(/^HTTP\/1\.1/, 'HTTP/1.0');
        const r = this._resp; this.eof = true; return r;
      }
      this.eof = true; return '';
    }
    close() { this.connected = false; }
  }

  const system = {
    callSystem(cmd) {
      log.push('callSystem ' + cmd);
      try {
        if (win) return execSync('wine cmd /c ' + cmd, { env: Object.assign({}, process.env, { WINEDEBUG: '-all' }), timeout: 20000 }).toString();
        return execSync(cmd, { timeout: 20000 }).toString();
      } catch (e) { return ''; }
    }
  };
  const tasks = [];
  const app = {
    version: opts.aeVersion || '26.0x48',
    project: { activeItem: null, numItems: 0, item() { return null; }, file: null },
    preferences: { savePrefAsLong(sec, key, v) { log.push('pref ' + sec + ' ' + key + '=' + v); }, saveToDisk() {}, reload() {} },
    scheduleTask(code, ms) { tasks.push({ code, ms }); return tasks.length; },
    cancelTask() {}
  };
  const dollar = {
    os: win ? 'Windows/10.0.19045' : 'Macintosh OS 15.0',
    fileName: '',
    global: {},
    sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
    getenv(k) { return (opts.env || {})[k] || null; },
    evalFile(f) { const src = fs.readFileSync(toHost(f instanceof FileBaseC ? f._p : f), 'utf8'); return vm.runInContext(src, ctx, { filename: String(f._p || f) }); }
  };

  // ScriptUI stand-in: every control accepts anything and remembers handlers
  function control(type, text) {
    const c = { type, text: text || '', children: [], preferredSize: { width: 0, height: 0 }, value: false, layout: { layout() {}, resize() {} } };
    c.add = (t, b, label) => { const k = control(t, label); c.children.push(k); return k; };
    c.show = () => { log.push('show ' + type + ' ' + c.text); return 1; };
    c.close = () => {}; c.center = () => {};
    return c;
  }
  const windows = [];
  function Window(type, title) { const w = Object.assign(control('window:' + type, title), { _isWindow: true }); windows.push(w); return w; }
  function Panel() {}
  const ctx = vm.createContext({
    File, Folder, Socket, system, app, $: dollar, Window, Panel, alert: (m) => log.push('alert ' + m),
    JSON, Math, Date, parseInt, parseFloat, isNaN, String, Number, Array, Object, RegExp, Error, encodeURIComponent, decodeURIComponent
  });
  // ScriptUI's instanceof Window check
  vm.runInContext('Window.prototype = {}; ', ctx);
  return { ctx, log, tasks, windows, toHost, toFs, run(src, file) { dollar.fileName = file || ''; return vm.runInContext(src, ctx, { filename: file || 'script' }); } };
}
module.exports = { makeRuntime };
