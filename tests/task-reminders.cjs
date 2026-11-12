const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/weekly-focus-app.js','utf8');
const start=source.indexOf('  var taskReminderPanel = null;'),end=source.indexOf('  function detailHtml(id)',start);
let opened=[],errors=[];const panel={mount(){return this},async openTask(seed){opened.push(seed)},unmount(){}};
const ctx={sb:{},session:{user:{id:'one'}},cloud:{board:'board/a'},window:{AkatsukiBroadcastPanel:(client,options)=>{assert.equal(options.app,'wf');return panel}},activeSubs:a=>a,subs:()=>[{id:'s1',t:'Review chapter'}],toast:m=>errors.push(m)};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
(async()=>{await ctx.openSubReminder('study:MEDICINE/Neurology','s1');assert.equal(opened[0].sourceTaskId,JSON.stringify(['board/a','study:MEDICINE/Neurology','s1']));assert.equal(opened[0].type,'do');ctx.session=null;await ctx.openSubReminder('a','s1');assert.equal(opened.length,1);assert.match(errors.at(-1),/Sign in/);ctx.session={};await ctx.openSubReminder('a','deleted');assert.match(errors.at(-1),/no longer available/);assert(source.includes('if (a === "subreminder")'));console.log('PASS source identity, sign-in guard and deleted-item guard');})().catch(e=>{console.error(e);process.exitCode=1});
