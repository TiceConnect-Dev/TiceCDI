import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { parisClock, presenceDeadline, shiftDay, parisMidnight } from "../cdi/calendar.mjs";
import { openDatabase } from "../standalone/sqlite.mjs";
import { maintain } from "../cdi/privacy.mjs";
import { model } from "../cdi/service.mjs";
import { csvRows } from "../public/cdi/shared.js";
import { totp } from "../cdi/security.mjs";

const root=mkdtempSync(join(tmpdir(),"ticecdi-smoke-"));
const php=process.env.PHP_BIN || "php";
const secret="Une phrase de test TiceCDI 2026";
const password="Un mot de passe uniquement pour le test";
const setupKey="installation-fictive";
const sockets=[];
let output="";
const archive=process.argv[2] || "dist/TiceCDI-PHP.zip";

async function freePort() {
  const socket=createServer().listen(0,"127.0.0.1");
  await once(socket,"listening");
  const port=socket.address().port;
  socket.close();
  await once(socket,"close");
  return port;
}

async function serve(kind) {
  const fixture=join(root,kind), data=join(fixture,"data"), web=join(fixture,"web");
  mkdirSync(web,{recursive:true});
  const port=await freePort();
  const base="http://127.0.0.1:"+port;
  const isPhp=kind.startsWith("php");
  const prefix=isPhp?"/Gestion-CDI-PHP":"";
  if(isPhp) execFileSync("unzip",["-q",archive,"-d",web]);
  const env={...process.env,PORT:String(port),CDI_DATA_DIR:data,CDI_ORIGIN:"",CDI_SETUP_KEY:setupKey};
  const server=spawn(isPhp?php:process.execPath,isPhp?["-S","127.0.0.1:"+port,"-t",web]:["standalone/server.mjs"],
    {env,stdio:["ignore","pipe","pipe"]});
  server.stderr.on("data",chunk=>{output+=chunk;});
  server.stdout.on("data",chunk=>{output+=chunk;});
  sockets.push(server);
  const route=path=>{
    if(!isPhp) return base+path;
    const parsed=new URL(path,base);
    parsed.searchParams.set("route",parsed.pathname);
    return base+prefix+"/index.php?"+parsed.searchParams;
  };
  for(let i=0;i<100;i++){
    try {if((await fetch(route("/healthz"))).ok) break;} catch {}
    if(i===99) throw Error("Édition indisponible "+kind);
    await delay(50);
  }
  let current="";
  async function call(path,{method="GET",body,expected=200,session=current}={}) {
    const response=await fetch(route("/api"+path),{method,
      headers:{"Content-Type":"application/json",Cookie:session},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const payload=await response.json();
    assert.equal(response.status,expected,kind+" "+method+" "+path+" "+JSON.stringify(payload));
    const cookies=response.headers.getSetCookie();
    return {payload,cookies:cookies.map(part=>part.split(";")[0])};
  }
  async function get(path,session=current,expected=200){return (await call(path,{session,expected})).payload;}
  async function post(path,body,session=current,expected=200){return (await call(path,{method:"POST",body,session,expected})).payload;}
  async function patch(path,body,session=current,expected=200){return (await call(path,{method:"PATCH",body,session,expected})).payload;}
  async function login(login,password) {
    return (await call("/auth/login",{method:"POST",body:{username:login,password},session:""})).cookies[0];
  }
  current=(await call("/auth/setup",{method:"POST",body:{key:setupKey,username:"admin",name:"Administration test",password},session:""})).cookies[0];
  assert.ok(current.startsWith("cdi_session="));
  return {kind,data,web,prefix,base,route,env,get,post,patch,call,login,admin:current};
}

function exactExpiry() {
  const arrival=Date.parse("2026-11-21T08:30:00+01:00");
  const expiry=Date.parse("2026-11-21T09:00:00+01:00");
  const extra=Date.parse("2026-11-21T10:00:00+01:00");
  assert.equal(presenceDeadline(arrival),expiry);
  assert.equal(presenceDeadline(arrival,2),extra);
  const out=execFileSync(php,["-r",'require "php/app/core.php"; echo json_encode([fullHour('+arrival+'),fullHour('+arrival+',2)]);']);
  assert.deepEqual(JSON.parse(out),[expiry,extra]);
}

async function migration() {
  const old=join(root,"old-migrations");
  mkdirSync(old);
  for(const file of readdirSync("drizzle").filter(file=>/^000[0-3].*\.sql$/.test(file))) copyFileSync(join("drizzle",file),join(old,file));
  const original=join(root,"ancienne");
  mkdirSync(original);
  const store=join(original,"cdi.sqlite");
  const before=openDatabase(store,pathToFileURL(old+"/"));
  const yesterday=Date.now()-172800000;
  before.database.prepare("INSERT INTO classes VALUES (?,?,?)").run("cl","6e A","6e a");
  before.database.prepare("INSERT INTO students VALUES (?,?,?,?,?,?,?,?,1)").run("student","Prénom","Démo","prenom demo","demo|prenom","cl","CDIF000000000",null);
  before.database.prepare("INSERT INTO visits (id,student_id,starts_at,expires_at) VALUES (?,?,?,?)").run("visite","student",yesterday,yesterday+3600000);
  before.database.close();
  const oldPhp=join(root,"ancienne-php");
  mkdirSync(oldPhp);
  copyFileSync(store,join(oldPhp,"cdi.sqlite"));
  const report=execFileSync(php,["-r",`require "php/app/core.php"; require "php/app/privacy.php";
    $db=new Store($argv[1],"drizzle");
    $db->atomic(static fn () => maintain($db,clockMs()));
    echo json_encode([$db->one("SELECT purge_enabled FROM privacy_settings")["purge_enabled"],$db->one("SELECT count(*) AS n FROM visits")["n"]]);`,oldPhp]);
  assert.deepEqual(JSON.parse(report),[0,1]);
  const after=openDatabase(store,new URL("../drizzle/",import.meta.url));
  try {
    await maintain(model(after));
    assert.equal(after.database.prepare("SELECT purge_enabled FROM privacy_settings").get().purge_enabled,0);
    assert.equal(after.database.prepare("SELECT count(*) AS n FROM visits").get().n,1);
  } finally {after.database.close();}
}

const setting={
  profile:{institution:"Collège de test",contact:"contact@example.invalid",dpd:"dpd@example.invalid",purpose:"Gestion des passages",
    basis:"Mission d’intérêt public – test",source:"Fichier interne",recipients:"CDI et vie scolaire",hosting:"Établissement",rights:"Auprès du DPD"},
  purge_enabled:true,retention_days:0,audit_days:30,backup_days:30,backup_limit:2,public_planning:true,confirm_retention:true,
};

async function exercise(host) {
  const {get,post,patch,call,login}=host;
  const html=await (await fetch(host.route("/"))).text();
  assert.match(html,/<title>TiceCDI<\/title>/);
  for(const asset of ["ticecdi-logo.webp","ticecdi-icon.webp"]){
    const img=await fetch(host.base+host.prefix+"/cdi/"+asset);
    assert.equal(img.status,200);
    assert.equal((await img.arrayBuffer()).byteLength>1000,true);
  }
  if(host.kind==="php") {
    const payload=readFileSync(join(host.web,host.prefix.slice(1),"LICENSE"));
    assert.deepEqual(payload,readFileSync("LICENSE"));
  }
  assert.deepEqual(await get("/borne/reglages",""),{activated:false});
  await get("/borne/recherche?q=Demo","",403);
  await post("/borne/entree",{student_id:"eleve"},"",403);
  await get("/gestion/sauvegarde","",401);
  const today=parisClock().day, monday=shiftDay(today,1-parisClock().weekday);
  await get("/planning?week="+monday,"",403);
  for(const [name,rights] of Object.entries({vie:["presence"],cdi:["presence","sorties","borne","arrivees"],
    exporteur:["export"],restauration:["restaurer"],dpo:["donnees"],plan:["planning"]})) {
    await post("/gestion/comptes",{username:name,name:name==="vie"?"Vie scolaire":name,rights,password});
  }
  const [viewer,cdi,exporter,restore,dpo,plan]=await Promise.all(
    ["vie","cdi","exporteur","restauration","dpo","plan"].map(name=>login(name,password)));
  await post("/gestion/borne/activation",{},viewer,403);
  await get("/gestion/confidentialite",cdi,403);
  await get("/gestion/presences",viewer);
  await get("/gestion/eleves",viewer,403);
  await post("/gestion/export",{type:"planning"},plan,403);
  await post("/gestion/sauvegarde/export",{phrase:secret},restore,403);
  await post("/gestion/sauvegarde",{backup:{}},exporter,403);
  await get("/gestion/sauvegarde/00000000-0000-0000-0000-000000000000",restore,403);
  await post("/gestion/eleves/recherche",{q:"Demo"},viewer,403);
  const result=await patch("/gestion/confidentialite",setting);
  assert.deepEqual(result.profile,setting.profile);
  const notice=await get("/notice","");
  for(const key of ["profile","public_planning","retention_days","audit_days","backup_days","backup_limit","purge_enabled"])
    assert.deepEqual(notice[key],setting[key],key);
  await post("/gestion/planning",{day:today,start_min:540,end_min:600,title:"Titre privé",notes:"Note privée",kind:"cours"});
  await post("/gestion/planning",{day:today,start_min:600,end_min:660,title:"Fermeture privée",kind:"fermeture"});
  const visual=await get("/planning?week="+monday,"");
  assert.deepEqual(visual.rows.map(row=>row.title),["Réservé","Fermé"]);
  assert.ok(visual.rows.every(row=>!row.class_name&&!Object.hasOwn(row,"notes")&&!Object.hasOwn(row,"id")));
  assert.equal((await get("/gestion/planning?week="+monday,plan)).rows[0].title,"Titre privé");
  await patch("/gestion/horaires",{use_hours:false,hours:[{weekday:1,start_min:480,end_min:720}]});
  const rows=Array.from({length:6},(_,i)=>({first_name:"Élève "+i,last_name:"Démo",class_name:"5e A",external_id:"CD-"+i,
    irrelevant:"champs exclus"}));
  assert.equal((await post("/gestion/import",{rows,preview:true})).added,6);
  await post("/gestion/import",{rows});
  const pupils=(await get("/gestion/eleves?badges=1")).rows;
  await get("/gestion/eleves?badges=1",viewer,403);
  const id=pupils[0].id;
  const code=pupils[0].code;
  await get("/gestion/dossier/"+id,viewer,403);
  assert.ok((await post("/gestion/dossier/recherche",{q:"demo"},dpo)).rows.some(row=>row.id===id));
  await patch("/gestion/dossier/"+id,{first_name:"Prénom rectifié",last_name:"Démo",class_id:pupils[0].class_id,external_id:pupils[0].external_id},dpo);
  assert.equal((await get("/gestion/dossier/"+id,dpo)).student.first_name,"Prénom rectifié");
  await get("/gestion/dossier/"+id+"/export",dpo,403);
  const device=(await call("/gestion/borne/activation",{method:"POST",body:{},session:cdi})).cookies[0];
  assert.ok(device.startsWith("cdi_device="));
  assert.equal((await get("/borne/reglages",device)).activated,true);
  await get("/borne/recherche?q=Demo",device,404);
  await get("/gestion/presences",device,401);
  await post("/borne/entree",{student_id:id},device,400);
  // Éviter de dépendre de l’heure réelle ou d’une fermeture programmée pendant l’essai.
  const db=new DatabaseSync(join(host.data,"cdi.sqlite"));
  db.exec("DELETE FROM planning WHERE kind='fermeture'");
  const arrival=await post("/borne/entree",{code},device);
  assert.equal(Object.hasOwn(arrival,"first_name"),false);
  const current=(await get("/gestion/presences",viewer)).rows[0];
  assert.equal(arrival.expires_at,presenceDeadline(current.starts_at));
  await patch("/gestion/presences/"+current.id,{minutes:60,expires_at:current.expires_at},viewer,403);
  assert.equal((await patch("/gestion/presences/"+current.id,{minutes:60,expires_at:current.expires_at},cdi)).expires_at,current.expires_at+3600000);
  await post("/borne/sortie",{code},device);
  assert.equal((await get("/gestion/dossier/"+id)).visits[0].status,"sortie_enregistree");

  const earlier=shiftDay(today,-2), start=parisMidnight(earlier)+8*3600000;
  const insert=db.prepare("INSERT INTO visits (id,student_id,starts_at,expires_at) VALUES (?,?,?,?)");
  for(const pupil of pupils) insert.run(crypto.randomUUID(),pupil.id,start,start+1800000);
  assert.equal((await get("/gestion/dossier/"+id)).visits.at(-1).status,"creneau_expire");
  assert.equal((await get("/gestion/presences",viewer)).rows.length,0);
  const stats="/gestion/statistiques?from="+earlier+"&to="+earlier;
  assert.equal((await get(stats)).visits,6);
  const old=await post("/gestion/sauvegarde/export",{phrase:secret},exporter);
  assert.equal(old.format,"cdi-encrypted");
  assert.equal(Object.hasOwn(old,"tables"),false);
  await post("/gestion/sauvegarde",{backup:old,phrase:"une phrase incorrecte"},restore,400);
  const backupId=(await get("/gestion/sauvegarde",exporter)).rows[0].id;
  await get("/gestion/sauvegarde/"+backupId,restore,403);
  assert.equal((await get("/gestion/sauvegarde/"+backupId,exporter)).format,"cdi-encrypted");
  if(host.kind==="php") {
    const cli=join(host.web,host.prefix.slice(1),"app","maintenance.php");
    assert.match(execFileSync(php,[cli,host.web],{env:host.env,encoding:"utf8"}),/purge terminée/);
  } else {
    await post("/gestion/confidentialite/purge",{});
  }
  assert.equal((await get("/gestion/dossier/"+id)).visits.length,1);
  assert.equal((await get(stats)).visits,6);
  assert.equal(db.prepare("SELECT visits FROM daily_statistics WHERE day=?").get(earlier).visits,6);
  assert.ok((await get("/gestion/confidentialite")).last_success);
  const requested=await get("/gestion/dossier/"+id+"/export");
  assert.equal(requested.student.id,id);
  assert.ok(requested.visits.every(visit=>visit.starts_at!==start));
  await call("/gestion/dossier/"+id,{method:"DELETE",body:{confirmation:"EFFACER"},session:dpo});
  await get("/gestion/dossier/"+id,dpo,404);
  const preview=await post("/gestion/sauvegarde",{backup:old,phrase:secret},restore);
  await post("/gestion/sauvegarde",{backup:old,phrase:secret,token:preview.token},restore);
  await get("/gestion/dossier/"+id,dpo,404);
  assert.equal((await get(stats)).visits,6);
  assert.equal((await get("/borne/reglages",device)).activated,false);
  const logs=(await get("/gestion/journal?area=confidentialite")).rows;
  assert.ok(logs.some(row=>row.action==="Effacement validé"));
  assert.ok(!JSON.stringify(logs).includes(code));
  const recovery=await post("/gestion/sauvegarde/etat/export",{phrase:secret},exporter);
  assert.equal(recovery.format,"cdi-encrypted");
  db.close();
  return {old,restore,recovery,id,stats};
}

async function verifyLayout(hosts) {
  if(!process.env.TICECDI_BROWSER) return;
  const {chromium}=await import(pathToFileURL(process.env.TICECDI_BROWSER).href);
  const browser=await chromium.launch({executablePath:process.env.TICECDI_CHROME,headless:true,args:["--no-sandbox"]});
  try {
    mkdirSync("dist/layout",{recursive:true});
    for(const host of hosts) {
      for(const width of [1360,390]) {
        const context=await browser.newContext({viewport:{width,height:850}});
        const page=await context.newPage();
        const errors=[];
        page.on("pageerror", error=>errors.push(error.message));
        const assets=async selector=>page.locator(selector).evaluate(el=>({loaded:el.complete&&el.naturalWidth>0,file:el.currentSrc}));
        await page.goto(host.route("/"));
        await page.locator(".home-subtitle").waitFor();
        assert.equal(await page.locator(".home-subtitle").innerText(),"Présences, planning et fréquentation du CDI");
        await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
        const top=await assets(".masthead img");
        assert.equal(top.loaded,true);
        assert.ok(top.file.endsWith(width===390?"ticecdi-icon.webp":"ticecdi-logo.webp"));
        assert.ok((await assets(".tice-hero-logo img")).file.endsWith("ticecdi-logo.webp"));
        assert.equal(await page.title(),"TiceCDI");
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
        assert.ok(await page.locator(".home-subtitle").isVisible());
        await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(()=>document.activeElement.matches(":focus-visible")));
        await page.screenshot({path:`dist/layout/${host.kind}-${width}.png`});
        await page.goto(host.route("/borne"));
        await page.locator("#kiosk-title").waitFor();
        await page.waitForFunction(()=>document.querySelector(".masthead img")?.complete);
        assert.ok((await assets(".masthead img")).file.endsWith("ticecdi-icon.webp"));
        await page.goto(host.route("/gestion"));
        await page.locator("#login-form").waitFor();
        await page.waitForFunction(()=>document.querySelector(".masthead img")?.complete);
        assert.equal((await assets(".masthead img")).loaded,true);
        await context.addCookies([{name:"cdi_session",value:host.admin.split("=")[1],url:host.base}]);
        for(const path of ["/gestion/planning","/gestion/statistiques","/gestion/confidentialite"]) {
          await page.goto(host.route(path));
          await page.locator(".masthead img").waitFor();
          await page.waitForFunction(()=>document.querySelector(".masthead img")?.complete);
          assert.equal((await assets(".masthead img")).loaded,true);
          assert.ok(!page.url().includes("connexion"));
          await page.locator("#main h1").waitFor();
          if(path.endsWith("planning")) await page.locator(".accessible-planning").waitFor();
        }
        assert.deepEqual(errors,[]);
        await context.close();
      }
    }
  } finally {await browser.close();}
}

// Double authentification, codes de secours, sessions actives et traces de connexion.
async function accountSecurity(host) {
  const user="mfa."+host.kind, userPassword="Mot de passe double facteur 2026";
  await host.post("/gestion/comptes",{username:user,name:"Compte 2FA",password:userPassword,admin:false,rights:["planning"]});
  const accountId=(await host.get("/gestion/comptes")).rows.find(row=>row.username===user).id;
  await host.call("/auth/login",{method:"POST",body:{username:user,password:"mauvais"},session:"",expected:401});
  const session=await host.login(user,userPassword);
  await host.post("/gestion/securite/totp",{password:"mauvais"},session,403);
  const {secret,uri}=await host.post("/gestion/securite/totp",{password:userPassword},session);
  assert.match(secret,/^[A-Z2-7]{32}$/);
  assert.ok(uri.startsWith("otpauth://totp/TiceCDI%3A"+user+"?secret="+secret));
  const step=Math.floor(Date.now()/30000);
  await host.post("/gestion/securite/totp/activation",{code:"000000"===await totp(secret,step)?"111111":"000000"},session,400);
  const {codes}=await host.post("/gestion/securite/totp/activation",{code:await totp(secret,step)},session);
  assert.equal(codes.length,10);
  assert.match(codes[0],/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  let state=await host.get("/gestion/securite",session);
  assert.equal(state.mfa.enabled,true); assert.equal(state.mfa.recovery_left,10);
  assert.equal(state.sessions.filter(row=>row.current).length,1);
  assert.ok((await host.get("/gestion/comptes")).rows.find(row=>row.id===accountId).mfa);
  const pending=await host.call("/auth/login",{method:"POST",body:{username:user,password:userPassword},session:""});
  assert.deepEqual(pending.payload,{mfa:true}); assert.equal(pending.cookies.length,0);
  await host.call("/auth/login",{method:"POST",body:{username:user,password:userPassword,code:"12345"},session:"",expected:401});
  const rescue=await host.call("/auth/login",{method:"POST",body:{username:user,password:userPassword,code:codes[0].toUpperCase()},session:""});
  assert.ok(rescue.cookies[0].startsWith("cdi_session="));
  const next=await totp(secret,Math.floor(Date.now()/30000)+1);
  assert.ok((await host.call("/auth/login",{method:"POST",body:{username:user,password:userPassword,code:next},session:""})).cookies[0]);
  await host.call("/auth/login",{method:"POST",body:{username:user,password:userPassword,code:next},session:"",expected:401});
  state=await host.get("/gestion/securite",session);
  assert.equal(state.mfa.recovery_left,9); assert.equal(state.sessions.length,3);
  await host.call("/gestion/securite/sessions",{method:"DELETE",session});
  assert.equal((await host.get("/gestion/securite",session)).sessions.length,1);
  const all=(await host.get("/gestion/sessions")).rows;
  assert.ok(all.some(row=>row.username===user && row.mfa && /^[a-f0-9]{16}$/.test(row.id)));
  assert.ok(all.some(row=>row.username==="admin" && row.current));
  await host.get("/gestion/sessions",session,403);
  await host.call("/gestion/comptes/"+accountId+"/double-authentification",{method:"DELETE"});
  await host.get("/gestion/securite",session,401);
  const journal=(await host.get("/gestion/journal?area=securite")).rows.map(row=>row.action);
  for(const action of ["Échec de connexion","Activation de la double authentification","Échec de la double authentification",
    "Connexion avec un code de secours","Fermeture des autres sessions","Réinitialisation de la double authentification"]) assert.ok(journal.includes(action),host.kind+" "+action);
  const fresh=await host.login(user,userPassword);
  assert.equal((await host.get("/gestion/securite",fresh)).mfa.enabled,false);
}

// Sécurité : en-têtes communs, méthodes refusées et conversion des anciennes empreintes de mot de passe.
async function security(host) {
  for(const path of ["/","/api/auth/status","/cdi/cdi.css"]) {
    const response=await fetch(path==="/cdi/cdi.css"?host.base+host.prefix+path:host.route(path));
    await response.arrayBuffer();
    assert.equal(response.status,200,host.kind+" "+path);
    for(const [name,value] of [["x-content-type-options","nosniff"],["x-frame-options","SAMEORIGIN"],["cross-origin-opener-policy","same-origin"],["x-robots-tag","noindex, nofollow"]]) {
      if(host.kind.startsWith("php") && path==="/cdi/cdi.css") continue; // Servi directement par le serveur web (règles .htaccess).
      assert.equal(response.headers.get(name),value,host.kind+" "+path+" "+name);
    }
    assert.ok(response.headers.get("permissions-policy")?.includes("camera=()") || path==="/cdi/cdi.css" && host.kind.startsWith("php"));
    assert.ok(!response.headers.get("x-powered-by"),host.kind+" X-Powered-By");
  }
  const refused=await fetch(host.route("/api/auth/status"),{method:"PUT"});
  await refused.arrayBuffer();
  assert.equal(refused.status,405);
  const worker=await fetch(host.route("/sw.js"));
  await worker.text();
  assert.equal(worker.status,200); assert.match(worker.headers.get("content-type"),/javascript/);
  assert.equal(worker.headers.get("content-security-policy"),"default-src 'self'");
  const manifest=await (await fetch(host.base+host.prefix+"/cdi/manifest.webmanifest")).json();
  assert.equal(new URL(manifest.start_url,host.base+host.prefix+"/cdi/manifest.webmanifest").href,host.route("/borne"));
  for(const asset of ["theme-dark.css","account.js","qr.js","offline.js","icon-192.png","icon-512.png"]) {
    const response=await fetch(host.base+host.prefix+"/cdi/"+asset);
    await response.arrayBuffer();
    assert.equal(response.status,200,host.kind+" "+asset);
  }
  assert.match(await (await fetch(host.route("/"))).text(),/rel="manifest"[\s\S]*theme-dark\.css/);
  const legacySalt="ab".repeat(16);
  const {pbkdf2Sync}=await import("node:crypto");
  const legacy=legacySalt+":"+pbkdf2Sync("Ancien mot de passe 2025",legacySalt,100000,32,"sha256").toString("hex");
  const db=new DatabaseSync(join(host.data,"cdi.sqlite"));
  db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,0)").run("legacy-"+host.kind,"ancien."+host.kind,"Ancien compte",legacy,JSON.stringify(["planning"]));
  await host.login("ancien."+host.kind,"Ancien mot de passe 2025");
  assert.match(db.prepare("SELECT secret FROM accounts WHERE username=?").get("ancien."+host.kind).secret,/^pbkdf2\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  await host.login("ancien."+host.kind,"Ancien mot de passe 2025");
  await host.call("/auth/login",{method:"POST",body:{username:"ancien."+host.kind,password:"mauvais mot de passe"},session:"",expected:401});
  db.close();
}

try {
  exactExpiry();
  await migration();
  assert.deepEqual(csvRows("Nom;Prénom;Classe;Identifiant interne;INE;Mail\nNom;Prénom;5A;REF;NE PAS GARDER;mail"),[
    {last_name:"Nom",first_name:"Prénom",class_name:"5A",external_id:"REF"},
  ]);
  const node=await serve("node"), phpHost=await serve("php");
  const n=await exercise(node), p=await exercise(phpHost);
  await security(node); await security(phpHost);
  await accountSecurity(node); await accountSecurity(phpHost);
  assert.ok((await node.post("/gestion/sauvegarde",{backup:p.old,phrase:secret},n.restore)).token);
  assert.ok((await phpHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret},p.restore)).token);
  const recoveryHost=await serve("php-reprise");
  await recoveryHost.post("/gestion/sauvegarde/etat",{backup:n.recovery,phrase:secret});
  const preview=await recoveryHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret});
  await recoveryHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret,token:preview.token});
  await recoveryHost.get("/gestion/dossier/"+n.id, recoveryHost.admin,404);
  assert.equal((await recoveryHost.get(n.stats)).visits,6);
  await verifyLayout([node,phpHost]);
  console.log("OK · Node et PHP HTTP, migration, activation, rôles, échéances, purge et totaux, restauration, notices, licence, logos, en-têtes de sécurité, double authentification et sessions.");
} catch(error){
  console.error(output);
  throw error;
} finally {
  for(const server of sockets) if(server.exitCode===null&&server.kill()) await once(server,"exit");
  rmSync(root,{recursive:true,force:true});
}
