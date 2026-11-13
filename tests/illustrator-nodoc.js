// Mock Illustrator: reading or setting coordinateSystem with no document throws, like the real app.
const fs=require('fs'),vm=require('vm'),path=require('path'),os=require('os');
const tmpd=fs.mkdtempSync(path.join(os.tmpdir(),'lb-'));
fs.mkdirSync(tmpd+'/LayerBoat');
fs.writeFileSync(tmpd+'/LayerBoat/from-figma.svg','<!-- bridge:Card%201:1 --><svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="red"/></svg>');
function F(p){this.fsName=p;this.encoding='';}
F.prototype={get exists(){return fs.existsSync(this.fsName)},open(m){this.m=m;if(m==='r'&&!this.exists)return false;if(m==='w')this.buf='';return true},read(){return fs.readFileSync(this.fsName,'utf8')},write(t){this.buf+=t},close(){if(this.m==='w')fs.writeFileSync(this.fsName,this.buf)},remove(){try{fs.unlinkSync(this.fsName)}catch(e){}return true}};
const docs=[];let cs=1;
function mkGroup(){return{name:'',pageItems:[],position:[0,100],translate(){},remove(){},selected:false}}
const app={documents:docs,
 get coordinateSystem(){if(!docs.length)throw new Error('There is no document');return cs},
 set coordinateSystem(v){if(!docs.length)throw new Error('There is no document');cs=v}};
docs.add=function(){const d={artboards:[{artboardRect:[0,100,200,0],name:''}],groupItems:{createFromFile(){return mkGroup()}},views:[{}],selection:null,close(){}};d.artboards.setActiveArtboardIndex=()=>{};docs.push(d);return d};
const ctx={app,File:F,Folder:Object.assign(function(p){this.fsName=p},{userData:{fsName:tmpd},temp:{fsName:tmpd}}),
 CoordinateSystem:{DOCUMENTCOORDINATESYSTEM:2},DocumentColorSpace:{RGB:1},SaveOptions:{DONOTSAVECHANGES:0},$:{sleep(){}},decodeURIComponent,Math,String,parseFloat,isFinite,Infinity};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','after-effects','illustrator-import.jsx'),'utf8'),ctx);
const r=vm.runInContext('LayerBoatAI_import({wait:0})',ctx);
console.log(r, 'docs:',docs.length);
process.exit(String(r).indexOf('OK')===0&&docs.length===1?0:1);
