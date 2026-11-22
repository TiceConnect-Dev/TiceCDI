import { api, day, e, fullName, icon, notice, time, urlFor } from "./shared.js";
import { button, saveFile, timeLabel } from "./schedule.js";

const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
const gestion=(path,method,body)=>api("/gestion/"+path,method,body);
const statuses={present:"Présent",retard:"En retard",absent:"Absent",excuse:"Excusé",attente:"En attente de place",exclu:"Exclusion active"};
const plural=(n,one,many=one+"s")=>n+" "+(n===1?one:many);
const dateTime=(stamp)=>day(stamp)+" à "+time(stamp);
const pill=(text,tone="gray")=>`<span class="pill pill-${tone}">${e(text)}</span>`;
const empty=(text)=>`<p class="empty">${e(text)}</p>`;
const table=(heads,rows)=>`<div class="scroll-table"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
function csv(name, rows) {
  function cell(value) {
    const text=String(value??"");
    return '"'+((/^[=+\-@\t\r]/.test(text)?"'":"")+text).replace(/"/g,'""')+'"';
  }
  saveFile(name,"text/csv;charset=utf-8","\uFEFF"+rows.map(row=>row.map(cell).join(";")).join("\r\n"));
}

export async function startCall(classes,dialogForm,options={}) {
  if (options.attendance_id) {location.assign(urlFor("/gestion/seances?fiche="+encodeURIComponent(options.attendance_id)));return;}
  const groups=(await gestion("groupes")).rows.filter(group=>group.active);
  const selected=options.roster_id ?? "";
  const selectedKind=options.kind ?? "classe";
  const requestId=Array.from(crypto.getRandomValues(new Uint8Array(18)),byte=>byte.toString(16).padStart(2,"0")).join("");
  const choices=(rows,kind)=>rows.map(row=>`<option value="${kind}:${e(row.id)}" ${selected===row.id && selectedKind===kind?"selected":""}>${e(row.name)} · ${plural(row.total,"élève")}</option>`).join("");
  const slot=options.plan_id;
  const duration=Math.min(240,Math.max(60,Math.ceil((options.duration??60)/60)*60));
  dialogForm("Ouvrir une fiche d’appel",`<div class="form-grid">
    <label class="field"><span>Classe ou groupe</span><select name="roster" required ${slot?"disabled":""}>
      <option value="">Choisir une classe ou un groupe</option>
      <optgroup label="Classes">${choices(classes,"classe")}</optgroup>
      <optgroup label="Groupes hors classe">${choices(groups,"groupe")}</optgroup>
    </select></label>
    <label class="field"><span>Départ prévu</span><select name="duration">
      ${["Prochaine heure pleine","Deuxième heure pleine","Troisième heure pleine","Quatrième heure pleine"].map((label,index)=>{
        const value=(index+1)*60;
        return `<option value="${value}" ${value===duration?"selected":""}>${label}</option>`;
      }).join("")}
    </select></label></div>
    ${slot?"":'<label class="field"><span>Titre de la séance <small>(facultatif)</small></span><input name="title" maxlength="80" placeholder="Ex. Atelier lecture"></label>'}
    <p class="hint">Tous les élèves sont cochés au départ. Décoche ceux qui sont absents avant de valider l’appel.</p>
    <div class="group-tools" hidden><label class="check-line"><input type="checkbox" id="group-all"> Tout sélectionner</label><strong id="group-count" aria-live="polite"></strong></div>
    <div class="group-roster" id="group-members"><p class="hint">Sélectionne une classe ou un groupe.</p></div>`,
    "Enregistrer l’appel",async form=>{
      const [kind,id]=form.elements.roster.value.split(":");
      const result=await gestion("seances","POST",{
        kind,roster_id:id,plan_id:slot??null,request_id:requestId,
        title:form.elements.title?.value,duration:Number(form.elements.duration.value),student_ids:new FormData(form).getAll("student_ids"),
      });
      location.assign(urlFor("/gestion/seances?fiche="+encodeURIComponent(result.session.id)));
      return "Fiche d’appel ouverte.";
    },{
      ready:form=>{
        const roster=$("#group-members",form), toolbar=$(".group-tools",form), all=$("#group-all",form);
        const count=$("#group-count",form), submit=$("[type=submit]",form);
        let version=0;
        const items=()=>$$("input[name=student_ids]",roster);
        function update() {
          const list=items(), size=list.filter(input=>input.checked).length;
          toolbar.hidden=!list.length;
          count.textContent=size+" / "+list.length+" présents cochés";
          submit.disabled=!list.length;
          all.checked=Boolean(list.length && size===list.length);
          all.indeterminate=size>0 && size<list.length;
        }
        async function load() {
          const current=++version;
          const [kind,id]=form.elements.roster.value.split(":");
          roster.innerHTML='<p class="hint">'+(id?"Chargement des élèves…":"Sélectionne une classe ou un groupe.")+"</p>";
          update();
          if(!id) return;
          try {
            const {rows}=await gestion("seances/effectif?"+new URLSearchParams({kind,id}));
            if(current!==version) return;
            roster.innerHTML=rows.length?rows.map(row=>`<label class="check-line"><input type="checkbox" name="student_ids" value="${e(row.id)}" checked><span>${fullName(row)}</span>${pill(row.class_name)}</label>`).join("")
              : '<p class="hint">Aucun élève actif dans cette liste.</p>';
            update();
          } catch(error) { if(current===version) roster.innerHTML=notice(error.message,"error"); }
        }
        roster.addEventListener("change",update);
        all.addEventListener("change",()=>{items().forEach(input=>{input.checked=all.checked;});update();});
        form.elements.roster.addEventListener("change",load);
        load();
      },
    });
}

export async function renderSessions(target,context) {
  const {section,dialogForm,toast}=context;
  const address="/gestion/seances";
  const selected=new URLSearchParams(location.search).get("fiche");
  if (!selected) {
    const [data,classes]=await Promise.all([gestion("seances"),gestion("classes")]);
    target.innerHTML=section("Fiches d’appel","Retrouve les séances, leurs effectifs et les départs groupés.",button("Nouvelle fiche d’appel","plus",'id="new-call"',"primary"))+
      `<section class="panel table-panel">${data.rows.length?table(["Séance","Début","Appel","Au CDI","État"],data.rows.map(row=>`<tr>
        <td><a href="${urlFor(address+"?fiche="+encodeURIComponent(row.id))}"><strong>${e(row.title)}</strong></a><small>${e(row.roster_name)}</small></td>
        <td>${dateTime(row.started_at)}</td><td>${plural(row.present,"présent")} · ${plural(row.absent,"absent")}${row.waiting?" · "+plural(row.waiting,"en attente","en attente"):""}</td>
        <td>${row.active}</td><td>${row.ended_at?pill("Terminée"):pill("En cours","green")}</td></tr>`)):empty("Aucune fiche d’appel enregistrée.")}</section>`;
    $("#new-call",target).addEventListener("click",()=>startCall(classes.rows,dialogForm).catch(error=>toast(error.message,"error")));
    return;
  }
  const ident=encodeURIComponent(selected);
  let data=await gestion("seances/"+ident);
  function draw() {
    const { session,rows }=data;
    const present=rows.filter(row=>["present","retard"].includes(row.status)).length;
    const absent=rows.filter(row=>row.status==="absent").length;
    const waiting=rows.filter(row=>row.status==="attente").length;
    const active=rows.filter(row=>row.active).length;
    const counters=[[present,"Présents à l’appel"],[absent,"Absents"],[waiting,"En attente"],[active,"Au CDI"]];
    target.innerHTML=section("Fiche d’appel",e(session.title+" · "+session.roster_name+" · "+dateTime(session.started_at)),
      `<a class="btn secondary" href="${urlFor(address)}">${icon("previous")} Toutes les séances</a>`+
      (context.canExport?button("Export CSV","download",'id="call-csv"'):"")+
      (session.ended_at?"":button("Garder des élèves au CDI","users",'id="keep-at-cdi"')+button("Terminer la séance","logout",'id="finish-call"',"primary")))
      +`<div class="metrics call-metrics">${counters.map(([n,title])=>`<div class="metric"><span class="icon-box">${icon("users")}</span><div><b>${n}</b><span>${title}</span></div></div>`).join("")}</div>
      <section class="panel table-panel"><div class="table-top"><h2>Appel de la séance</h2>${session.ended_at?pill("Terminée à "+time(session.ended_at)):pill("En cours","green")}</div>
      ${table(["Élève","Classe","Statut","Présence au CDI"],rows.map(row=>{
        const choices=Object.entries(statuses).filter(([key])=>["present","retard","absent","excuse"].includes(key)||row.status===key).map(([key,label])=>`<option value="${key}" ${row.status===key?"selected":""}>${label}</option>`).join("");
        return `<tr><td><strong>${fullName(row)}</strong></td><td>${e(row.class_name)}</td><td><select class="input call-status" data-student="${e(row.student_id)}" aria-label="Statut de ${fullName(row)}">${choices}</select></td>
          <td>${row.active?pill("Présent au CDI","green"):row.arrived_at?e("Arrivée à "+time(row.arrived_at)):"—"}</td></tr>`;
      }))}</section>`;
    const exportButton=$("#call-csv",target);
    exportButton?.addEventListener("click",async()=>{
      try {
        await gestion("export","POST",{type:"appel"});
        csv("Appel-CDI-"+day(session.started_at).replaceAll("/","-")+".csv",[
          ["Nom","Prénom","Classe","Statut","Arrivée"],...rows.map(row=>[row.last_name,row.first_name,row.class_name,statuses[row.status],row.arrived_at?time(row.arrived_at):""]),
        ]);
      } catch(error) {toast(error.message,"error");}
    });
    $(".table-panel",target).addEventListener("change",async event=>{
      const select=event.target.closest("[data-student]");
      if(!select) return;
      const id=select.dataset.student;
      const changes=$$("[data-student]",target);
      changes.forEach(node=>{node.disabled=true;});
      try {data=await gestion("seances/"+ident,"PATCH",{student_id:id,status:select.value});draw();toast("Appel corrigé.");}
      catch(error){select.value=rows.find(row=>row.student_id===id).status;toast(error.message,"error");}
      finally {changes.forEach(node=>{node.disabled=false;});}
    });
    $("#finish-call",target)?.addEventListener("click",async event=>{
      const finish=event.currentTarget;
      finish.disabled=true;
      try {
        data=await gestion("seances/"+ident+"/fin","POST",{keep_student_ids:[]});
        draw();
        toast("Séance terminée · "+plural(data.closed,"sortie enregistrée","sorties enregistrées")+".");
      } catch(error) { finish.disabled=false; toast(error.message,"error"); }
    });
    $("#keep-at-cdi",target)?.addEventListener("click",()=>{
      const linked=rows.filter(row=>row.active);
      dialogForm("Terminer la séance",`<p>Les présences rattachées à la séance seront clôturées. Coche les élèves qui restent au CDI.</p>
        ${linked.length?`<div class="group-roster">${linked.map(row=>`<label class="check-line"><input type="checkbox" name="keep" value="${e(row.student_id)}">${fullName(row)}</label>`).join("")}</div>`:""}`,
        "Terminer la séance",async form=>{
          data=await gestion("seances/"+ident+"/fin","POST",{keep_student_ids:new FormData(form).getAll("keep")});
          return "Séance terminée · "+plural(data.closed,"sortie enregistrée","sorties enregistrées")+".";
        },{refresh:draw});
    });
  }
  draw();
}

export async function renderGroups(target,{section,dialogForm,toast}) {
  const {rows}=await gestion("groupes");
  target.innerHTML=section("Groupes hors classe","Compose des groupes avec des élèves de plusieurs classes pour les utiliser dans le planning et les appels.",
    button("Créer un groupe","plus",'id="new-group"',"primary"))+`<section class="panel table-panel">
    ${rows.length?table(["Groupe","Élèves actifs","État",""],rows.map(row=>`<tr><td><strong>${e(row.name)}</strong></td><td>${row.total}</td>
    <td>${row.active?pill("Actif","green"):pill("Archivé")}</td><td>${button("Modifier","edit",`data-group="${e(row.id)}"`,"secondary tiny")}</td></tr>`)):empty("Aucun groupe hors classe.")}</section>`;
  async function edit(group) {
    const current=group?(await gestion("groupes/"+group.id)).rows:[];
    const selected=new Map(current.map(row=>[row.id,row]));
    dialogForm(group?"Modifier le groupe":"Créer un groupe",`
      <label class="field"><span>Nom du groupe</span><input name="name" maxlength="65" required placeholder="Ex. Club lecture" value="${e(group?.name)}"></label>
      <label class="check-line"><input type="checkbox" name="active" ${group?.active===0?"":"checked"}> Groupe actif dans le planning et les appels</label>
      <label class="field"><span>Rechercher un élève à ajouter</span><input type="search" id="group-lookup" placeholder="Nom ou prénom" autocomplete="off"></label>
      <div id="group-matches"></div><div><strong id="group-size"></strong><div class="group-roster" id="selected-members"></div></div>`,
      "Enregistrer",form=>gestion("groupes"+(group?"/"+group.id:""),group?"PATCH":"POST",{name:form.elements.name.value,active:form.elements.active.checked,student_ids:[...selected.keys()]}),
      {refresh:()=>renderGroups(target,{section,dialogForm,toast}),success:"Groupe enregistré.",ready:form=>{
        const query=$("#group-lookup",form), results=$("#group-matches",form), roster=$("#selected-members",form);
        let found=[],seq=0,delay;
        function paint() {
          $("#group-size",form).textContent=plural(selected.size,"élève dans le groupe","élèves dans le groupe");
          roster.innerHTML=selected.size?[...selected.values()].map(row=>`<div class="group-person"><span>${fullName(row)} ${pill(row.class_name)}${row.active===0?" · fiche retirée":""}</span>
            ${button("Retirer","close",`data-member-remove="${e(row.id)}"`,"quiet tiny")}</div>`).join(""):'<p class="hint">Ajoute des élèves avec la recherche.</p>';
          results.innerHTML=found.filter(row=>!selected.has(row.id)).map(row=>`<div class="group-person"><span>${fullName(row)} ${pill(row.class_name)}</span>
            ${button("Ajouter","plus",`data-member-add="${e(row.id)}"`,"secondary tiny")}</div>`).join("");
        }
        query.addEventListener("input",()=>{
          clearTimeout(delay);
          const version=++seq, term=query.value.trim();
          found=[];paint();
          if(term.length<2) return;
          delay=setTimeout(async()=>{
            try {
              const result=await gestion("eleves/recherche","POST",{q:term});
              if(version===seq){found=result.rows.slice(0,12);paint();if(!found.length)results.innerHTML=empty("Aucun élève trouvé.");}
            }catch(error){if(version===seq) results.innerHTML=notice(error.message,"error");}
          },180);
        });
        results.addEventListener("click",event=>{
          const id=event.target.closest("[data-member-add]")?.dataset.memberAdd;
          const row=found.find(entry=>entry.id===id);
          if(row){selected.set(id,row);paint();query.focus();}
        });
        roster.addEventListener("click",event=>{
          const id=event.target.closest("[data-member-remove]")?.dataset.memberRemove;
          if(id){selected.delete(id);paint();}
        });
        paint();
      }});
  }
  $("#new-group",target).addEventListener("click",()=>edit().catch(error=>toast(error.message,"error")));
  $(".table-panel",target).addEventListener("click",event=>{
    const id=event.target.closest("[data-group]")?.dataset.group;
    if(id)edit(rows.find(row=>row.id===id)).catch(error=>toast(error.message,"error"));
  });
}

const areaNames={confidentialite:"Données personnelles",planning:"Planning",horaires:"Horaires et borne",seances:"Fiches d’appel",groupes:"Groupes hors classe",annees:"Années scolaires",presences:"Présences",sauvegarde:"Sauvegardes",securite:"Sécurité des comptes"};
const fieldNames={day:"Date",start_min:"Début",end_min:"Fin",title:"Titre",kind:"Type",class_id:"Référence de classe",group_id:"Référence de groupe",notes:"Notes",open:"Borne ouverte",second_hour:"Deuxième heure",hide_weekend:"Week-end masqué",capacity:"Capacité",use_hours:"Application des horaires",message:"Message",expiration:"Départ prévu",sauvegarde_du:"Date de la sauvegarde",poste:"Poste",navigateur:"Navigateur"};
function auditData(raw) {
  if(!raw) return "—";
  const parsed=JSON.parse(raw);
  return Object.entries(parsed).map(([key,value])=>{
    let text=value;
    if (value===null) text="—";
    else if (typeof value==="boolean") text=value?"Oui":"Non";
    else if (Array.isArray(value)) text=value.filter(row=>row && Number.isInteger(row.weekday) && Number.isInteger(row.start_min) && Number.isInteger(row.end_min)).map(row=>`${["Lun.","Mar.","Mer.","Jeu.","Ven.","Sam.","Dim."][row.weekday-1]} ${timeLabel(row.start_min)}–${timeLabel(row.end_min)}`).join(" · ");
    else if (key==="start_min" || key==="end_min") text=timeLabel(value);
    else if (key==="expiration" || key==="sauvegarde_du") {
      const stamp=new Date(value).valueOf();
      text=Number.isFinite(stamp)?dateTime(stamp):"—";
    }
    else if (key==="statut") text=statuses[value]??value;
    return `<div><dt>${e(fieldNames[key]??key.replaceAll("_"," "))}</dt><dd>${e(text)}</dd></div>`;
  }).join("");
}
export async function renderJournal(target,{section,toast}) {
  target.innerHTML=section("Journal des modifications","Retrouve l’auteur, la date et le détail des modifications.")+
    `<section class="panel table-panel"><div class="table-top"><label class="field"><span>Filtrer par rubrique</span><select id="journal-filter" class="input">
    <option value="">Toutes les rubriques</option>${Object.entries(areaNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select></label></div>
    <div id="journal-items"></div><div class="table-top">${button("Charger la suite","previous",'id="journal-more" hidden')}</div></section>`;
  const more=$("#journal-more",target);
  const filter=$("#journal-filter",target);
  const items=$("#journal-items",target);
  let next,rows=[],request=0;
  async function load(append=false) {
    const version=++request;
    const params=new URLSearchParams({area:filter.value});
    if(append&&next) params.set("before",next);
    more.disabled=true;
    try {
      const data=await gestion("journal?"+params);
      if(version!==request)return;
      rows=append?[...rows,...data.rows]:data.rows;
      next=data.next;
      more.hidden=!next;
      items.innerHTML=rows.length?table(["Quand","Par","Action","Détail"],rows.map(row=>`<tr><td>${dateTime(row.at)}</td><td>${e(row.actor)}</td>
        <td><strong>${e(row.action)}</strong><small>${e(row.target)} · ${e(areaNames[row.area]??row.area)}</small></td>
        <td><details class="audit-detail"><summary>Avant / après</summary><div class="audit-grid"><section><b>Avant</b><dl>${auditData(row.before_json)}</dl></section>
        <section><b>Après</b><dl>${auditData(row.after_json)}</dl></section></div></details></td></tr>`)):empty("Aucun changement dans cette rubrique.");
    }catch(error){toast(error.message,"error");}
    finally{if(version===request)more.disabled=false;}
  }
  filter.addEventListener("change",()=>load());
  more.addEventListener("click",()=>load(true));
  await load();
}

export async function renderYears(target,{section,toast,confirmDialog,readCsv}) {
  const data=await gestion("annees");
  const context={section,toast,confirmDialog,readCsv};
  const archived=data.rows.filter(row=>row.closed_at);
  target.innerHTML=section("Années scolaires","Prépare la nouvelle année avec l’export complet des élèves. Les codes-barres sont conservés quand l’identifiant externe correspond.")+
    `<div class="school-year-layout"><section class="panel panel-body"><h2>Passage à la nouvelle année</h2>
    <form class="stack" id="rollover-form"><div class="form-grid">
      <label class="field"><span>Année actuelle</span><input name="from" pattern="[0-9]{4}-[0-9]{4}" value="${e(data.current)}" ${data.initialized?"readonly":""} required></label>
      <label class="field"><span>Nouvelle année</span><input name="to" pattern="[0-9]{4}-[0-9]{4}" value="${e(data.next)}" required></label></div>
      <label class="field"><span>Export CSV complet</span><input type="file" name="file" accept=".csv,.tsv,text/csv" required><small>Colonnes Nom, Prénom, Classe et Identifiant externe. Un élève absent du fichier sera archivé.</small></label>
      <div class="form-actions">${button("Modèle CSV","download",'id="year-sample"')}
        <button type="submit" class="btn primary">${icon("search")} Prévisualiser le passage d’année</button></div>
      <div id="year-preview" aria-live="polite"></div></form></section>
    <section class="panel panel-body"><h2>Archives</h2><div id="year-archives">${archived.length?archived.map(row=>`<div class="group-person"><span><strong>${e(row.label)}</strong><small> · ${plural(row.total,"élève")}</small></span>
    ${button("Consulter","calendar",`data-archive="${e(row.label)}"`,"secondary tiny")}</div>`).join(""):empty("Aucune année archivée.")}</div><div id="archive-detail"></div></section></div>`;
  const form=$("#rollover-form",target);
  const preview=$("#year-preview",target);
  const submit=$("button[type=submit]",form);
  let version=0;
  form.addEventListener("input",()=>{version++;preview.innerHTML="";});
  $("#year-sample",form).addEventListener("click",()=>csv("Modele-nouvelle-annee-CDI.csv",[["Nom","Prénom","Classe","Identifiant externe"],["Exemple","Camille","5e 2","EXEMPLE-01"]]));
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const request=++version;
    submit.disabled=true;
    preview.innerHTML='<p class="hint">Analyse de l’export…</p>';
    try {
      const rows=await readCsv(form.elements.file.files[0]);
      const body={from:form.elements.from.value,to:form.elements.to.value,rows};
      const result=await gestion("annees","POST",body);
      if(request!==version) return;
      if(result.errors?.length){
        preview.innerHTML=notice(plural(result.errors.length,"ligne à corriger","lignes à corriger"),"error")+`<ul>${result.errors.slice(0,60).map(row=>`<li>Ligne ${row.line} · ${e(row.message)}</li>`).join("")}</ul>`;
        return;
      }
      const info=result.counts;
      const details=(name,entries,total,move=false)=>entries.length?`<details><summary>${name} · ${total}</summary><ul>${entries.map(row=>`<li>${fullName(row)} · ${move?e(row.before)+" → ":""}${e(row.class_name)}</li>`).join("")}</ul>${entries.length<total?`<p class="hint">Aperçu des ${entries.length} premières fiches.</p>`:""}</details>`:"";
      preview.innerHTML=notice(plural(info.total,"élève dans la nouvelle liste","élèves dans la nouvelle liste"),"success")+
        `<div class="year-summary">${pill(plural(info.retained,"code conservé","codes conservés"))}${pill(plural(info.rookies,"nouvelle fiche","nouvelles fiches"))}
        ${pill(plural(info.reactivated,"réactivation"))}${pill(plural(info.archived,"fiche à archiver","fiches à archiver"))}</div>
        ${details("Élèves à archiver",result.leaving,info.archived)}
        ${details("Nouvelles fiches",result.newcomers,info.rookies)}
        ${details("Changements de classe",result.moves,info.moved,true)}
        <div class="form-actions">${button("Appliquer le passage d’année","check",'id="apply-year"',"primary")}</div>`;
      $("#apply-year",preview).addEventListener("click",()=>confirmDialog("Appliquer le passage d’année",
        "L’année "+body.from+" sera archivée. "+plural(info.archived,"fiche sera retirée","fiches seront retirées")+" de la borne.",
        "Appliquer",async()=>{await gestion("annees","POST",{...body,token:result.token});return "Année "+body.to+" active.";},undefined,()=>renderYears(target,context),false));
    } catch(error) {if(request===version)preview.innerHTML=notice(error.message,"error");}
    finally {submit.disabled=false;}
  });
  $("#year-archives",target).addEventListener("click",async event=>{
    const label=event.target.closest("[data-archive]")?.dataset.archive;
    if (!label) return;
    const detail=$("#archive-detail",target);
    try {
      const {rows}=await gestion("annees/"+label);
      detail.innerHTML=`<div class="opening-intro"><h3>${e(label)}</h3>${button("CSV","download",'id="export-archive"',"secondary tiny")}</div><div class="archive-roster">${table(["Élève","Classe"],rows.map(row=>`<tr><td>${fullName(row)}</td><td>${e(row.class_name)}</td></tr>`))}</div>`;
      $("#export-archive",detail).addEventListener("click",()=>csv("Archive-CDI-"+label+".csv",[["Nom","Prénom","Classe"],...rows.map(row=>[row.last_name,row.first_name,row.class_name])]));
    } catch(error) {toast(error.message,"error");}
  });
}

export async function renderBackup(target,{section,toast,confirmDialog,canExport,canRestore}) {
  const {rows}=await gestion("sauvegarde");
  const field=(required)=>`<label class="field"><span>Phrase secrète de la sauvegarde</span><input type="password"
    name="phrase" autocomplete="off" maxlength="512" ${required?'required minlength="12"':""}></label>`;
  target.innerHTML=section("Sauvegarde et restauration","Les nouvelles sauvegardes sont chiffrées. Conservez votre phrase secrète séparément.")+
    `<div class="stack">${canExport?`<section class="panel panel-body stack">
      <h2>Créer une sauvegarde chiffrée</h2>
      <form id="create-backup" class="stack">${field(true)}
        <div class="button-row"><button type="submit" class="btn primary" value="backup">Créer et télécharger</button>
        <button type="submit" class="btn secondary" value="guard">Exporter l’état de reprise</button></div></form>
      <h3>Copies locales disponibles</h3>
      <div id="backup-list">${rows.map(row=>`<p>${dateTime(row.created_at)} ·
        ${button("Télécharger","download",`data-backup="${e(row.id)}"`)}</p>`).join("")||"Aucune copie locale."}</div>
      </section>`:""}
      ${canRestore?`<section class="panel panel-body stack">
        <h2>Restaurer une sauvegarde</h2>
        <p>La purge et les suppressions validées seront réappliquées avant la réouverture de l’instance.</p>
        <form id="backup-form" class="stack">
          <label class="field"><span>Fichier de sauvegarde</span><input type="file" name="file" accept=".json,application/json" required></label>
          ${field(false)}
          <div class="button-row"><button class="btn secondary" type="submit" value="backup">Analyser la sauvegarde</button>
          <button class="btn secondary" type="submit" value="guard">Importer l’état de reprise</button></div>
        </form><div id="backup-preview" class="stack" aria-live="polite"></div></section>`:""}</div>`;
  const download=payload=>saveFile("TiceCDI-sauvegarde-"+new Date().toISOString().slice(0,10)+".json","application/json",JSON.stringify(payload));
  $("#create-backup",target)?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget, submit=event.submitter;
    submit.disabled=true;
    try {
      if(submit.value==="guard") {
        const payload=await gestion("sauvegarde/etat/export","POST",{phrase:form.elements.phrase.value});
        saveFile("TiceCDI-etat-de-reprise.json","application/json",JSON.stringify(payload));
        form.reset();
        toast("État de reprise téléchargé.");
        return;
      }
      download(await gestion("sauvegarde/export","POST",{phrase:form.elements.phrase.value}));
      form.reset();
      toast("Sauvegarde chiffrée téléchargée.");
      await renderBackup(target,{section,toast,confirmDialog,canExport,canRestore});
    } catch(error) {toast(error.message,"error");}
    finally{submit.disabled=false;}
  });
  $("#backup-list",target)?.addEventListener("click",async event=>{
    const id=event.target.closest("[data-backup]")?.dataset.backup;
    if(id) try {download(await gestion("sauvegarde/"+id));} catch(error){toast(error.message,"error");}
  });
  const form=$("#backup-form",target), preview=$("#backup-preview",target);
  form?.addEventListener("input",()=>preview.replaceChildren());
  form?.addEventListener("submit",async event=>{
    event.preventDefault();
    const selected=form.elements.file.files[0], phrase=form.elements.phrase.value;
    const submit=event.submitter;
    submit.disabled=true;
    preview.textContent="Analyse en cours…";
    try {
      if(!selected || selected.size>18_900_000) throw new Error("Sélectionnez une sauvegarde de 19 Mo maximum.");
      let backup;
      try {backup=JSON.parse(await selected.text());} catch {throw new Error("Fichier de sauvegarde invalide.");}
      if(submit.value==="guard") {
        preview.replaceChildren();
        confirmDialog("Importer l’état de reprise","L’état de reprise réapplique les purges et effacements. Importez-le avant de restaurer une sauvegarde ancienne.",
          "Importer",()=>gestion("sauvegarde/etat","POST",{backup,phrase}),"État de reprise importé.");
        return;
      }
      const {created_at,counts,token}=await gestion("sauvegarde","POST",{backup,phrase});
      preview.innerHTML=`<h3>Sauvegarde du ${e(dateTime(new Date(created_at).valueOf()))}</h3>
        <p>${counts.students} élèves · ${counts.visits} passages · ${counts.planning} créneaux avant application de la purge.</p>
        ${button("Restaurer cette sauvegarde","previous",'id="backup-restore"',"danger")}`;
      $("#backup-restore",preview).addEventListener("click",()=>confirmDialog("Restaurer les données du CDI",
        "Les données du fichier remplaceront les données actuelles. Les comptes, les réglages de confidentialité et les suppressions validées sont gérés localement.",
        "Restaurer",()=>gestion("sauvegarde","POST",{backup,phrase,token}),"Sauvegarde restaurée."));
    } catch(error) {preview.innerHTML=notice(error.message,"error");}
    finally{submit.disabled=false;}
  });
}
