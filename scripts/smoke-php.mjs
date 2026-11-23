import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
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
    exporteur:["sauvegarde"],restauration:["restaurer"],dpo:["donnees","effacer"],plan:["planning"]})) {
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
  const found=await post("/borne/recherche",{q:"rectifie pr"},device);
  assert.ok(found.rows[0].label.startsWith("Prénom rectifié"));
  assert.equal(found.fuzzy,false);
  const typo=await post("/borne/recherche",{q:"rectifei"},device);
  assert.ok(typo.fuzzy && typo.rows.some(row=>row.label.startsWith("Prénom rectifié")));
  const arrival=await post("/borne/entree",{code},device);
  assert.equal(Object.hasOwn(arrival,"first_name"),false);
  const current=(await get("/gestion/presences",viewer)).rows[0];
  assert.equal(arrival.expires_at,presenceDeadline(current.starts_at));
  await patch("/gestion/presences/"+current.id,{minutes:60,expires_at:current.expires_at},viewer,403);
  assert.equal((await patch("/gestion/presences/"+current.id,{minutes:60,expires_at:current.expires_at},cdi)).expires_at,current.expires_at+3600000);
  // Douchette QWERTY sur poste AZERTY : chiffres en « & é " … », A en Q, préfixe AIM.
  const azerty="]C0"+[...code].map(char=>({"1":"&","2":"é","3":"\"","4":"'","5":"(","6":"-","7":"è","8":"_","9":"ç","0":"à","A":"Q"})[char]??char).join("");
  await post("/borne/sortie",{code:azerty},device);
  assert.equal((await get("/gestion/dossier/"+id)).visits[0].status,"sortie_enregistree");

  const earlier=shiftDay(today,-2), start=parisMidnight(earlier)+8*3600000;
  const insert=db.prepare("INSERT INTO visits (id,student_id,starts_at,expires_at) VALUES (?,?,?,?)");
  for(const pupil of pupils) insert.run(crypto.randomUUID(),pupil.id,start,start+1800000);
  assert.equal((await get("/gestion/dossier/"+id)).visits.at(-1).status,"creneau_expire");
  assert.equal((await get("/gestion/presences",viewer)).rows.length,0);
  const stats="/gestion/statistiques?from="+earlier+"&to="+earlier;
  const detailed=await get(stats);
  assert.equal(detailed.visits,6); assert.equal(detailed.students,6); assert.equal(detailed.hidden,false);
  assert.deepEqual(detailed.classes.map(row=>[row.name,row.visits,row.students,row.size]),[["5e A",6,6,6]]);
  assert.equal(detailed.durations.find(row=>row.label==="30 min à 1 h").count,6);
  assert.equal(detailed.frequency[0].count,6);
  assert.deepEqual(detailed.sources,[{source:"individuel",visits:6}]);
  assert.equal(detailed.hours.reduce((total,row)=>total+row.visits,0),6); // aucune case masquée
  assert.equal(detailed.peak,6); assert.equal(detailed.busiest.visits,6); assert.equal(detailed.previous.visits,0);
  assert.deepEqual(Object.keys(detailed).sort(),["average","busiest","classes","daily","days","durations","early_exits","frequency","from","group_visits","hidden","hours","observed_hours","peak","per_day","population","previous","retained_from","retained_visits","sources","students","to","visits"]);
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
  const archived=await get(stats);
  assert.equal(archived.visits,6);
  assert.equal(db.prepare("SELECT visits FROM daily_statistics WHERE day=?").get(earlier).visits,6);
  // Après la purge, les répartitions restent complètes (compteurs anonymes par jour).
  assert.equal(archived.hours.reduce((total,row)=>total+row.visits,0),6);
  assert.deepEqual(archived.classes.map(row=>[row.name,row.visits,row.students,row.partial]),[["5e A",6,6,true]]);
  assert.equal(archived.durations.find(row=>row.label==="30 min à 1 h").count,6);
  assert.deepEqual(archived.sources,[{source:"individuel",visits:6}]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM archived_breakdown WHERE day=? AND kind='hour'").get(earlier).n,1);
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
        await page.waitForFunction(()=>document.querySelector(".borne-brand img")?.complete);
        assert.ok((await assets(".borne-brand img")).file.endsWith("ticecdi-icon.webp"));
        // Borne élèves : aucun lien vers l'espace du personnel.
        assert.equal(await page.locator('a[href*="gestion"]').count(),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
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

// Fournisseur d'identité factice (CAS et OpenID Connect) pour tester la connexion ENT.
async function identityProvider() {
  const port=await freePort(), base="http://127.0.0.1:"+port;
  const codes=new Map();
  const b64=(value)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const server=createHttpServer((req,res)=>{
    const url=new URL(req.url,base);
    if(url.pathname==="/cas/serviceValidate") {
      const ok=url.searchParams.get("ticket")==="ST-1" && url.searchParams.get("service").includes("state=");
      res.end(ok?`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>SSO.User</cas:user></cas:authenticationSuccess></cas:serviceResponse>`
        :`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">non</cas:authenticationFailure></cas:serviceResponse>`);
      return;
    }
    if(url.pathname==="/oidc/.well-known/openid-configuration") {
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({issuer:base+"/oidc",authorization_endpoint:base+"/oidc/authorize",token_endpoint:base+"/oidc/token"}));
      return;
    }
    if(url.pathname==="/oidc/token" && req.method==="POST") {
      let body=""; req.on("data",c=>body+=c); req.on("end",()=>{
        const form=new URLSearchParams(body), saved=codes.get(form.get("code"));
        const challenge=createHash("sha256").update(form.get("code_verifier")||"").digest("base64url");
        res.setHeader("Content-Type","application/json");
        if(!saved || saved.challenge!==challenge || form.get("client_id")!=="tice" || form.get("client_secret")!=="secret-oidc") { res.statusCode=400; res.end("{}"); return; }
        res.end(JSON.stringify({access_token:"a",id_token:b64({alg:"none"})+"."+b64({iss:base+"/oidc",aud:"tice",exp:Math.floor(Date.now()/1000)+300,nonce:saved.nonce,preferred_username:"sso.user"})+".sig"}));
      });
      return;
    }
    res.statusCode=404; res.end();
  }).listen(port,"127.0.0.1");
  await once(server,"listening");
  return {base,codes,close:()=>server.close()};
}

// Réglages de connexion : 2FA exigée, inactivité, alertes, connexion ENT CAS et OpenID Connect, places libres et affluence.
async function connectionSettingsTest(host,idp) {
  const db=new DatabaseSync(join(host.data,"cdi.sqlite"));
  const settings=await host.get("/gestion/connexion");
  assert.equal(settings.idle_minutes,60); assert.equal(settings.has_secret,false); assert.ok(settings.callback.includes("sso"));
  // Déconnexion après inactivité ; les actualisations en arrière-plan ne prolongent pas la session.
  const user="idle."+host.kind, userPassword="Mot de passe inactivite 2026";
  await host.post("/gestion/comptes",{username:user,name:"Compte inactif",password:userPassword,admin:false,rights:["presence"]});
  const session=await host.login(user,userPassword);
  const key=createHash("sha256").update(session.split("=")[1]).digest("hex");
  db.prepare("UPDATE sessions SET last_seen=? WHERE token=?").run(Date.now()-90_000,key);
  const background=await fetch(host.route("/api/gestion/presences"),{headers:{Cookie:session,"X-CDI-Background":"1"}});
  await background.arrayBuffer(); assert.equal(background.status,200);
  assert.ok(db.prepare("SELECT last_seen FROM sessions WHERE token=?").all(key)[0].last_seen<Date.now()-80_000);
  db.prepare("UPDATE sessions SET last_seen=? WHERE token=?").run(Date.now()-61*60_000,key);
  await host.get("/gestion/presences",session,401);
  // La session reste inutilisable même après un retour d'activité (l'édition PHP la laisse expirer en base).
  db.prepare("UPDATE sessions SET last_seen=? WHERE token=?").run(Date.now()-61*60_000,key);
  await host.get("/gestion/presences",session,401);
  // Alertes après des échecs répétés.
  for(let i=0;i<3;i++) await host.call("/auth/login",{method:"POST",body:{username:user,password:"faux mot de passe"},session:"",expected:401});
  const base={mfa_policy:"none",idle_minutes:30,alert_threshold:3,sso_mode:"",sso_label:"ENT",cas_url:"",oidc_issuer:"",oidc_client_id:"",oidc_claim:"preferred_username"};
  await host.patch("/gestion/connexion",{...base,idle_minutes:900},host.admin,400);
  await host.patch("/gestion/connexion",{...base,sso_mode:"cas",cas_url:"http://exemple.fr/cas"},host.admin,400);
  await host.patch("/gestion/connexion",base);
  assert.ok((await host.get("/gestion/securite/alertes")).rows.some(row=>row.target===user && row.count>=3));
  // Double authentification exigée pour les administrateurs.
  await host.patch("/gestion/connexion",{...base,mfa_policy:"admins"});
  assert.equal((await host.get("/auth/status")).user.mfa_missing,true);
  await host.get("/gestion/classes",host.admin,403);
  await host.get("/gestion/securite");
  const vie=await host.login(user,userPassword);
  await host.get("/gestion/presences",vie);
  db.prepare("UPDATE security_settings SET mfa_policy='none' WHERE id=1").run();
  // Connexion ENT par CAS.
  await host.post("/gestion/comptes",{username:"sso.user",name:"Agent ENT",password:"Mot de passe ENT 2026 test",admin:false,rights:["planning"]});
  await host.patch("/gestion/connexion",{...base,sso_mode:"cas",sso_label:"Mon ENT",cas_url:idp.base+"/cas"});
  assert.deepEqual((await host.get("/auth/status","")).sso,{enabled:true,label:"Mon ENT"});
  const start=async()=>{
    const response=await fetch(host.route("/api/auth/sso/start"),{redirect:"manual"});
    await response.arrayBuffer();
    assert.equal(response.status,303);
    return {location:new URL(response.headers.get("location")),cookie:response.headers.getSetCookie().find(c=>c.startsWith("cdi_sso=")).split(";")[0]};
  };
  const back=async(url,cookie)=>{
    const response=await fetch(url,{redirect:"manual",headers:{Cookie:cookie}});
    await response.arrayBuffer();
    assert.equal(response.status,303);
    return {location:response.headers.get("location"),cookies:response.headers.getSetCookie().map(c=>c.split(";")[0]).filter(c=>!c.endsWith("="))};
  };
  let step=await start();
  assert.ok(step.location.href.startsWith(idp.base+"/cas/login?service="));
  const service=step.location.searchParams.get("service");
  let done=await back(service+"&ticket=ST-1",step.cookie);
  assert.match(done.location,/(\/gestion|route=%2Fgestion)$/);
  const ssoSession=done.cookies.find(c=>c.startsWith("cdi_session="));
  assert.equal((await host.get("/auth/status",ssoSession)).user.username,"sso.user");
  step=await start();
  done=await back(step.location.searchParams.get("service")+"&ticket=ST-1","");
  assert.ok(done.location.includes("sso=echec"));
  step=await start();
  done=await back(step.location.searchParams.get("service")+"&ticket=ST-2",step.cookie);
  assert.ok(done.location.includes("sso=echec"));
  // Connexion ENT par OpenID Connect avec PKCE, puis étape de double authentification.
  await host.patch("/gestion/connexion",{...base,sso_mode:"oidc",oidc_issuer:idp.base+"/oidc",oidc_client_id:"tice",oidc_client_secret:"secret-oidc"});
  assert.equal((await host.get("/gestion/connexion")).has_secret,true);
  const {secret}=await host.post("/gestion/securite/totp",{password:"Mot de passe ENT 2026 test"},ssoSession);
  await host.post("/gestion/securite/totp/activation",{code:await totp(secret,Math.floor(Date.now()/30000))},ssoSession);
  step=await start();
  assert.ok(step.location.href.startsWith(idp.base+"/oidc/authorize?"));
  const query=step.location.searchParams;
  assert.equal(query.get("code_challenge_method"),"S256");
  idp.codes.set("C-"+host.kind,{challenge:query.get("code_challenge"),nonce:query.get("nonce")});
  done=await back(query.get("redirect_uri")+(query.get("redirect_uri").includes("?")?"&":"?")+"code=C-"+host.kind+"&state="+query.get("state"),step.cookie);
  assert.ok(done.location.includes("etape=code"),done.location);
  const challenge=done.cookies.find(c=>c.startsWith("cdi_challenge="));
  await host.call("/auth/challenge",{method:"POST",body:{code:"000000"},session:challenge,expected:401});
  const finish=await host.call("/auth/challenge",{method:"POST",body:{code:await totp(secret,Math.floor(Date.now()/30000)+1)},session:challenge});
  assert.equal((await host.get("/auth/status",finish.cookies.find(c=>c.startsWith("cdi_session=")))).user.username,"sso.user");
  const journal=(await host.get("/gestion/journal?area=securite")).rows.map(row=>row.action);
  assert.ok(journal.includes("Échec de connexion ENT") && journal.includes("Modification des réglages de connexion"));
  await host.patch("/gestion/connexion",{...base,alert_threshold:5});
  // Places libres en temps réel et affluence par heure.
  const planning=await (await fetch(host.route("/api/planning?week="+weekMonday()))).json();
  if(planning.occupancy) assert.ok("occupied" in planning.occupancy && "places" in planning.occupancy);
  db.close();
}
function weekMonday() {
  const now=new Date(); const day=(now.getUTCDay()+6)%7; now.setUTCDate(now.getUTCDate()-day);
  return now.toISOString().slice(0,10);
}

// Postes de borne : durée réglable, renouvellement automatique à l'usage et révocation poste par poste.
async function devicesTest(host) {
  const db=new DatabaseSync(join(host.data,"cdi.sqlite"));
  let state=await host.get("/gestion/borne/postes");
  assert.deepEqual(state.settings,{duration:"30j",renew:true,name_search:true});
  const activation=await host.call("/gestion/borne/activation",{method:"POST",body:{label:"Borne accueil"}});
  const device=activation.cookies.find(c=>c.startsWith("cdi_device="));
  const setCookie=(await fetch(host.route("/api/gestion/borne/activation"),{method:"POST",headers:{"Content-Type":"application/json",Cookie:host.admin},body:"{}"}));
  const maxAge=setCookie.headers.getSetCookie().find(c=>c.startsWith("cdi_device=")); await setCookie.arrayBuffer();
  const seconds=maxAge.match(/Max-Age=(\d+)/i)?.[1] ?? Math.round((Date.parse(maxAge.match(/expires=([^;]+)/i)[1])-Date.now())/1000);
  assert.ok(Math.abs(seconds-30*86400)<120,maxAge);
  state=await host.get("/gestion/borne/postes");
  const row=state.rows.find(item=>item.label==="Borne accueil");
  assert.ok(row && /^[a-f0-9]{16}$/.test(row.id) && row.activated_by && row.created_at>0);
  // Renouvellement glissant : une borne qui interroge le serveur repousse son échéance et reçoit un nouveau cookie.
  const key=createHash("sha256").update(device.split("=")[1]).digest("hex");
  db.prepare("UPDATE kiosk_devices SET expires_at=?,last_seen=? WHERE token=?").run(Date.now()+86400000,Date.now()-120000,key);
  const poll=await fetch(host.route("/api/borne/reglages"),{headers:{Cookie:device}});
  assert.equal((await poll.json()).activated,true);
  assert.ok(poll.headers.getSetCookie().some(c=>c.startsWith("cdi_device=")));
  assert.ok(db.prepare("SELECT expires_at FROM kiosk_devices WHERE token=?").all(key)[0].expires_at>Date.now()+29*86400000);
  // Durée de 12 h sans renouvellement.
  await host.patch("/gestion/borne/postes",{duration:"2h",renew:true},host.admin,400);
  assert.deepEqual(await host.patch("/gestion/borne/postes",{duration:"12h",renew:false}),{duration:"12h",renew:false,name_search:true});
  db.prepare("UPDATE kiosk_devices SET last_seen=? WHERE token=?").run(Date.now()-120000,key);
  const quiet=await fetch(host.route("/api/borne/reglages"),{headers:{Cookie:device}});
  await quiet.json();
  assert.ok(!quiet.headers.getSetCookie().some(c=>c.startsWith("cdi_device=")));
  // Recherche par nom pour les élèves sans carte : prénom et initiale seulement, sélection liée au poste.
  await host.post("/gestion/import",{rows:[{first_name:"Zélie",last_name:"Bérangère-Test",class_name:"Classe Borne "+host.kind}]});
  const kiosk=(path,body)=>fetch(host.route("/api/borne/"+path),{method:"POST",headers:{"Content-Type":"application/json",Cookie:device},body:JSON.stringify(body)});
  // Affichage de la borne : réglages validés et transmis à la borne avec le planning du jour.
  await host.patch("/gestion/borne/affichage",{announcements:[{text:"Test",tone:"rose"}]},host.admin,400);
  const shown=await host.patch("/gestion/borne/affichage",{announcements:[{text:"  Nouveaux livres  ",tone:"evenement"}],theme:"horaire",idle_delay:120});
  assert.deepEqual(shown.announcements,[{text:"Nouveaux livres",tone:"evenement"}]); assert.equal(shown.theme,"horaire");
  const kioskState=await (await fetch(host.route("/api/borne/reglages"),{headers:{Cookie:device}})).json();
  assert.equal(kioskState.display.idle_delay,120); assert.ok(Array.isArray(kioskState.today.rows) && Array.isArray(kioskState.today.hours));
  let search=await (await kiosk("recherche",{q:"z"})).json();
  assert.equal(search.rows.length,0); assert.equal(search.short,true);
  search=await (await kiosk("recherche",{q:"ze"})).json(); // deux lettres suffisent
  assert.ok(search.rows.some(row=>row.label==="Zélie B."));
  search=await (await kiosk("recherche",{q:"zelie berang"})).json();
  assert.equal(search.rows.length,1);
  assert.equal(search.rows[0].label,"Zélie B."); assert.equal(search.rows[0].class_name,"Classe Borne "+host.kind);
  assert.ok(!("student_id" in search.rows[0]) && !("code" in search.rows[0]));
  // Créneau « élèves refusés » en cours : la borne refuse l’entrée, puis l’accepte une fois le créneau supprimé.
  const nowParis=parisClock(Date.now()), slotMonday=shiftDay(nowParis.day,1-nowParis.weekday);
  if(nowParis.minute>=5 && nowParis.minute<=1400) {
    const slot={day:nowParis.day,start_min:nowParis.minute-5,end_min:nowParis.minute+30,title:"Séance fermée",kind:"cours",students_allowed:false};
    db.prepare("DELETE FROM planning WHERE day=?").run(nowParis.day);
    await host.post("/gestion/planning",slot);
    const planned=(await host.get("/gestion/planning?week="+slotMonday)).rows.find(row=>row.title==="Séance fermée");
    assert.equal(planned.students_allowed,0);
    const refused=await kiosk("entree",{ref:search.rows[0].ref}); const refusedBody=await refused.json();
    assert.equal(refused.status,409,JSON.stringify(refusedBody)); assert.match(refusedBody.error,/séance/);
    await host.call("/gestion/planning/"+planned.id,{method:"DELETE"});
    search=await (await kiosk("recherche",{q:"zelie berang"})).json();
  }
  const checked=await kiosk("entree",{ref:search.rows[0].ref});
  const checkedBody=await checked.json();
  assert.equal(checked.status,200,JSON.stringify(checkedBody)); assert.ok(checkedBody.expires_at>Date.now());
  const foreign=await fetch(host.route("/api/borne/sortie"),{method:"POST",headers:{"Content-Type":"application/json",Cookie:"cdi_device="+"0".repeat(64)},body:JSON.stringify({ref:search.rows[0].ref})});
  await foreign.arrayBuffer(); assert.equal(foreign.status,403);
  assert.equal((await kiosk("sortie",{ref:search.rows[0].ref})).status,200);
  // Arrivée manuelle par le personnel, tableau de bord en direct et notifications.
  const found=(await host.post("/gestion/presences/recherche",{q:"zelie"})).rows;
  assert.equal(found.length,1); assert.equal(found[0].present,false);
  const manual=await host.post("/gestion/presences",{student_id:found[0].id,two_hours:false,reason:" Lecture "});
  assert.ok(manual.expires_at>Date.now() && manual.already===false);
  const visit=(await host.get("/gestion/presences")).rows.find(row=>row.student_id===found[0].id);
  assert.equal(visit.reason,"Lecture");
  assert.equal((await host.patch("/gestion/presences/"+visit.id,{reason:"Recherche documentaire"})).reason,"Recherche documentaire");
  await host.patch("/gestion/presences/"+visit.id,{reason:"x".repeat(61)},host.admin,400);
  assert.equal((await host.post("/gestion/presences",{student_id:found[0].id})).already,true);
  const live=await host.get("/gestion/direct");
  assert.ok(live.present>=1 && Array.isArray(live.arrivals) && Array.isArray(live.events) && typeof live.open==="boolean");
  assert.ok(Array.isArray((await host.get("/gestion/notifications")).rows));
  db.prepare("UPDATE visits SET ended_at=? WHERE ended_at IS NULL").run(Date.now());
  // Réinitialisation : compte, refus sans confirmation, suppression par période, trace conservée au journal.
  const counted=await host.get("/gestion/reinitialisation?scope=tout");
  assert.ok(counted.passages>=1 && counted.alertes>=0 && typeof counted.journal==="number");
  await host.post("/gestion/reinitialisation",{targets:["passages"],scope:"tout",confirm:"non"},host.admin,400);
  const day=parisClock(Date.now()).day;
  const cleared=await host.post("/gestion/reinitialisation",{targets:["passages","alertes","journal"],scope:"periode",from:day,to:day,confirm:"VIDER"});
  assert.ok(cleared.counts.passages>=1);
  assert.equal((await host.get("/gestion/reinitialisation?scope=periode&from="+day+"&to="+day)).passages,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='Réinitialisation des données'").get().n,1);
  // Carte scannée : premier passage = entrée, second passage = sortie.
  const card=db.prepare("SELECT code FROM students WHERE search_name LIKE '%zelie%'").all()[0].code;
  const first=await (await kiosk("auto",{code:card.toLowerCase()})).json();
  assert.ok(first.expires_at && first.direction===undefined,JSON.stringify(first));
  assert.equal((await (await kiosk("auto",{code:card})).json()).direction,"sortie");
  const expired=await kiosk("entree",{ref:"f".repeat(32)}); await expired.arrayBuffer(); assert.equal(expired.status,410);
  await host.patch("/gestion/borne/postes",{duration:"30j",renew:true,name_search:false});
  const disabled=await kiosk("recherche",{q:"zelie"}); await disabled.arrayBuffer(); assert.equal(disabled.status,403);
  assert.equal((await (await fetch(host.route("/api/borne/reglages"),{headers:{Cookie:device}})).json()).name_search,false);
  await host.patch("/gestion/borne/postes",{duration:"30j",renew:true,name_search:true});
  // Suppression d'une classe : déplacement des élèves actifs, fiches retirées rangées dans « Anciens élèves ».
  const classes=async()=>(await host.get("/gestion/classes")).rows;
  const source=(await classes()).find(row=>row.name==="Classe Borne "+host.kind);
  await host.post("/gestion/classes",{name:"Accueil "+host.kind});
  const destination=(await classes()).find(row=>row.name==="Accueil "+host.kind);
  await host.call("/gestion/classes/"+source.id,{method:"DELETE",expected:409});
  assert.equal((await host.call("/gestion/classes/"+source.id,{method:"DELETE",body:{move_to:destination.id}})).payload.moved,1);
  assert.equal((await classes()).find(row=>row.id===destination.id).total,1);
  const pupil=(await host.post("/gestion/eleves/recherche",{q:"zelie",class:"",archived:false})).rows?.[0];
  if(pupil) await host.call("/gestion/eleves/"+pupil.id,{method:"DELETE"});
  await host.call("/gestion/classes/"+destination.id,{method:"DELETE",body:{}});
  assert.ok((await classes()).some(row=>row.name==="Anciens élèves"));
  // Révocation d'un seul poste.
  await host.call("/gestion/borne/postes/"+row.id,{method:"DELETE"});
  await host.call("/gestion/borne/postes/"+row.id,{method:"DELETE",expected:404});
  assert.equal((await (await fetch(host.route("/api/borne/reglages"),{headers:{Cookie:device}})).json()).activated,false);
  assert.ok((await host.get("/gestion/journal?area=confidentialite")).rows.some(item=>item.action==="Révocation d’un poste"));
  await host.patch("/gestion/borne/postes",{duration:"30j",renew:true});
  db.close();
}

// Droits fins : « consulter » donne la lecture sans la modification.
async function viewRightsTest(host) {
  const pass="Mot de passe consultation 2026";
  await host.post("/gestion/comptes",{username:"lecture."+host.kind,name:"Consultation",password:pass,admin:false,
    rights:["planning_voir","seances_voir","eleves_voir","classes_voir","exclusions_voir","groupes_voir","reglages_voir","journal"]});
  const viewer=await host.login("lecture."+host.kind,pass);
  const monday=weekMonday();
  await host.get("/gestion/planning?week="+monday,viewer);
  await host.post("/gestion/planning",{day:monday,start_min:600,end_min:660,title:"Interdit",kind:"cours"},viewer,403);
  await host.post("/gestion/planning/copier",{start:monday},viewer,403);
  await host.get("/gestion/seances",viewer);
  await host.post("/gestion/seances",{kind:"classe",id:"x"},viewer,403);
  await host.get("/gestion/eleves",viewer);
  await host.post("/gestion/eleves",{first_name:"A",last_name:"B",class_id:"x"},viewer,403);
  await host.get("/gestion/classes",viewer);
  await host.post("/gestion/classes",{name:"Interdite"},viewer,403);
  await host.get("/gestion/exclusions",viewer);
  await host.post("/gestion/exclusions",{student_id:"x",reason:"r",until_day:monday},viewer,403);
  await host.get("/gestion/groupes",viewer);
  await host.post("/gestion/groupes",{name:"Interdit",members:[]},viewer,403);
  await host.get("/gestion/reglages",viewer);
  await host.get("/gestion/horaires",viewer);
  await host.patch("/gestion/reglages",{open:true,second_hour:true,message:""},viewer,403);
  await host.get("/gestion/journal",viewer);
  await host.get("/gestion/statistiques?from="+monday+"&to="+monday,viewer,403);
  await host.get("/gestion/comptes",viewer,403);
  const listed=(await host.get("/gestion/comptes")).rows.find(row=>row.username==="lecture."+host.kind);
  assert.deepEqual(listed.rights.sort(),["classes_voir","eleves_voir","exclusions_voir","groupes_voir","journal","planning_voir","reglages_voir","seances_voir"]);
  // Export ciblé sans accès aux sauvegardes.
  await host.post("/gestion/comptes",{username:"pdf."+host.kind,name:"Export planning",password:pass,admin:false,rights:["planning_voir","export_planning"]});
  const pdf=await host.login("pdf."+host.kind,pass);
  await host.post("/gestion/export",{type:"planning"},pdf);
  await host.post("/gestion/export",{type:"appel"},pdf,403);
  await host.post("/gestion/export",{type:"statistiques"},pdf,403);
  await host.post("/gestion/export",{type:"archives"},pdf,403);
  await host.get("/gestion/sauvegarde",pdf,403);
  await host.post("/gestion/sauvegarde/export",{phrase:"Phrase de sauvegarde 2026"},pdf,403);
  await host.post("/gestion/export",{type:"planning"},viewer,403); // consulter seul ne suffit pas
  // Dossiers individuels : consulter sans rectifier, effacer ni exporter ; comptes en consultation.
  await host.post("/gestion/comptes",{username:"dossier."+host.kind,name:"Dossiers",password:pass,admin:false,rights:["dossiers_voir","comptes_voir"]});
  const reader=await host.login("dossier."+host.kind,pass);
  const fake="00000000-0000-0000-0000-000000000000";
  await host.post("/gestion/dossier/recherche",{q:"zzz"},reader);
  await host.patch("/gestion/dossier/"+fake,{first_name:"A",last_name:"B"},reader,403);
  await host.call("/gestion/dossier/"+fake,{method:"DELETE",body:{confirmation:"EFFACER"},session:reader,expected:403});
  await host.get("/gestion/dossier/"+fake+"/export",reader,403);
  await host.get("/gestion/comptes",reader);
  await host.post("/gestion/comptes",{username:"interdit."+host.kind,name:"Interdit",password:pass,admin:false,rights:["dossiers_voir"]},reader,403);
}

// Migration 0009 : les anciens droits « export » et « donnees » sont répartis sans perte.
function legacyRightsMigration() {
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE accounts (id TEXT, permissions TEXT)");
  db.prepare("INSERT INTO accounts VALUES (?,?)").run("a",JSON.stringify(["planning","export","donnees"]));
  db.prepare("INSERT INTO accounts VALUES (?,?)").run("b",JSON.stringify(["planning_voir","export_planning"]));
  db.exec(readFileSync("drizzle/0009_finer_rights.sql","utf8"));
  const rows=Object.fromEntries(db.prepare("SELECT id,permissions FROM accounts").all().map(row=>[row.id,JSON.parse(row.permissions).sort()]));
  assert.deepEqual(rows.a,["dossiers_voir","donnees","effacer","export_appel","export_dossiers","export_planning","export_statistiques","planning","sauvegarde"].sort());
  assert.deepEqual(rows.b,["export_planning","planning_voir"]);
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
    assert.ok(response.headers.get("permissions-policy")?.includes("camera=(self)") || path==="/cdi/cdi.css" && host.kind.startsWith("php"));
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
  // Les scripts du navigateur doivent au moins être syntaxiquement valides.
  for(const file of readdirSync("public/cdi").filter(name=>name.endsWith(".js")))
    execFileSync(process.execPath,["--check","--input-type=module"],{input:readFileSync(join("public/cdi",file))});
  exactExpiry();
  legacyRightsMigration();
  await migration();
  assert.deepEqual(csvRows("Nom;Prénom;Classe;Identifiant interne;INE;Mail\nNom;Prénom;5A;REF;NE PAS GARDER;mail"),[
    {last_name:"Nom",first_name:"Prénom",class_name:"5A",external_id:"REF"},
  ]);
  const node=await serve("node"), phpHost=await serve("php");
  const n=await exercise(node), p=await exercise(phpHost);
  await security(node); await security(phpHost);
  await accountSecurity(node); await accountSecurity(phpHost);
  await devicesTest(node); await devicesTest(phpHost);
  await viewRightsTest(node); await viewRightsTest(phpHost);
  const idp=await identityProvider();
  try { await connectionSettingsTest(node,idp); await connectionSettingsTest(phpHost,idp); } finally { idp.close(); }
  assert.ok((await node.post("/gestion/sauvegarde",{backup:p.old,phrase:secret},n.restore)).token);
  assert.ok((await phpHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret},p.restore)).token);
  const recoveryHost=await serve("php-reprise");
  await recoveryHost.post("/gestion/sauvegarde/etat",{backup:n.recovery,phrase:secret});
  const preview=await recoveryHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret});
  await recoveryHost.post("/gestion/sauvegarde",{backup:n.old,phrase:secret,token:preview.token});
  await recoveryHost.get("/gestion/dossier/"+n.id, recoveryHost.admin,404);
  assert.equal((await recoveryHost.get(n.stats)).visits,6);
  await verifyLayout([node,phpHost]);
  console.log("OK · Node et PHP HTTP, migration, activation, rôles, échéances, purge et totaux, restauration, notices, licence, logos, en-têtes de sécurité, double authentification, sessions, connexion ENT, règles de connexion, postes de borne, recherche par nom, suppression de classe, droits de consultation et d’export.");
} catch(error){
  console.error(output);
  throw error;
} finally {
  for(const server of sockets) if(server.exitCode===null&&server.kill()) await once(server,"exit");
  rmSync(root,{recursive:true,force:true});
}
