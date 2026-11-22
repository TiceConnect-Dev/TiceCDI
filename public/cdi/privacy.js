import { api, day, time, e, notice } from "./shared.js";
import { button, saveFile } from "./schedule.js";

const $=(q,root=document)=>root.querySelector(q);
const fields={
  institution:"Nom de l’établissement", contact:"Contact de l’établissement", dpd:"Contact du DPD",
  purpose:"Finalité", basis:"Base légale retenue", source:"Source de l’import",
  recipients:"Destinataires", hosting:"Hébergement", rights:"Modalités d’exercice des droits",
};
function retention(settings) {
  if (!settings.purge_enabled) return "Purge programmée désactivée. La durée doit être validée par l’établissement.";
  return settings.retention_days===0 ? "Jusqu’à la fin de la journée, après expiration du créneau."
    : settings.retention_days+" jour(s) après la journée du passage, après expiration du créneau.";
}
const badge="Nom, prénom, classe et identifiant interne si nécessaire. Les passages et l’appel interne sont liés à la fiche.";
function paragraphs(data) {
  const p=data.profile;
  return [
    [fields.institution,p.institution], [fields.contact,p.contact], [fields.dpd,p.dpd],
    [fields.purpose,p.purpose], [fields.basis,p.basis], ["Données traitées",badge],
    [fields.source,p.source], [fields.recipients,p.recipients], [fields.hosting,p.hosting],
    ["Passages nominatifs",retention(data)],
    ["Journaux d’administration",data.purge_enabled?data.audit_days+" jour(s)":"Purge programmée désactivée."],
    ["Sauvegardes chiffrées",data.backup_days+" jour(s) quand la purge est activée · "+data.backup_limit+" copies locales au maximum"],
    ["Planning sans connexion",data.public_planning?"Horaires et statuts ouvert, fermé et réservé":"Désactivé"],
    [fields.rights,p.rights],
  ];
}
function details(data) {
  return paragraphs(data).map(([label,value])=>`<dt>${e(label)}</dt><dd>${e(value || "À renseigner par l’établissement.")}</dd>`).join("");
}

export async function renderNotice(app,header,footer) {
  app.innerHTML=`${header}<main id="main" class="wrap kiosk"><section class="panel panel-body notice-body">
    <h1>Tes données dans TiceCDI</h1><div id="notice-content" role="status">Chargement de la notice…</div></section></main>${footer}`;
  const target=$("#notice-content");
  try {
    const settings=await api("/notice"), profile=settings.profile;
    target.removeAttribute("role");
    target.innerHTML=`<p>${e(profile.institution || "Ton établissement")} utilise TiceCDI pour gérer les passages au CDI.</p>
      <p>${e(profile.purpose || "La borne enregistre ton arrivée ou ta sortie avec ta carte CDI.")}</p>
      <p><strong>Durée des passages</strong> · ${e(retention(settings))}</p>
      <p>Pour une question ou pour exercer tes droits, contacte ${e(profile.contact || "le personnel de ton établissement")}.</p>
      <details class="privacy-block"><summary>Notice complète pour les élèves et les familles</summary><dl>${details(settings)}</dl></details>`;
  } catch(error) { target.innerHTML=notice(error.message,"error"); }
}

export async function renderPrivacy(target,{section,toast,confirmDialog}) {
  const settings=await api("/gestion/confidentialite");
  const name="Établissement et données personnelles";
  const input=(key,label,min,max)=>`<label class="field"><span>${label}</span>
    <input name="${key}" type="number" min="${min}" max="${max}" value="${settings[key]}" required></label>`;
  const fieldsHtml=Object.entries(fields).map(([key,label])=>`<label class="field"><span>${e(label)}</span>
    <textarea rows="2" name="${key}" maxlength="1500">${e(settings.profile[key]??"")}</textarea></label>`).join("");
  target.innerHTML=section(name,"Renseignez les choix validés par l’établissement et vérifiez les notices avant leur diffusion.")+
    `<form class="panel panel-body stack" id="privacy-form"><h2>Établissement et notice</h2>
      <div class="form-grid">${fieldsHtml}</div>
      <h2>Conservation et affichage</h2><div class="form-grid">
        ${input("retention_days","Jours supplémentaires des passages · 0 pour fin de journée",0,3650)}
        ${input("audit_days","Conservation des journaux · jours",1,3650)}
        ${input("backup_days","Conservation des sauvegardes · jours",1,365)}
        ${input("backup_limit","Nombre maximal de sauvegardes locales",1,30)}
      </div>
      <label class="check-line"><input type="checkbox" name="purge_enabled" ${settings.purge_enabled?"checked":""}> Activer la purge programmée</label>
      <label class="check-line"><input type="checkbox" name="public_planning" ${settings.public_planning?"checked":""}> Afficher le planning sans connexion, limité aux horaires et statuts</label>
      <p id="purge-status"></p>
      <div class="button-row"><button class="btn primary" type="submit">Enregistrer les réglages</button>
        ${button("Exécuter la tâche maintenant","clock",'id="purge-now"')}</div></form>
      <section class="panel panel-body stack notice-body"><h2>Notices et registre</h2>
        <dl class="privacy-block" id="privacy-document"></dl>
        <div class="button-row">${button("Notice complète","download",'id="notice-download"')}
        ${button("Fiche pour le registre des traitements","download",'id="register-download"')}</div>
      </section>`;
  let current=settings;
  const form=$("#privacy-form",target);
  function refresh() {
    $("#privacy-document",target).innerHTML=details(current);
    $("#purge-status",target).textContent=current.last_success
      ? "Dernier passage réussi de la tâche · "+day(current.last_success)+" à "+time(current.last_success)
      : "La tâche de purge n’a pas encore tourné.";
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const formData=new FormData(form);
    const data={
      profile:Object.fromEntries(Object.keys(fields).map(key=>[key,formData.get(key)])),
      purge_enabled:form.elements.purge_enabled.checked, public_planning:form.elements.public_planning.checked,
      ...Object.fromEntries(["retention_days","audit_days","backup_days","backup_limit"].map(key=>[key,Number(formData.get(key))])),
    };
    const save=async(confirm_retention=false)=>{
      current=await api("/gestion/confidentialite","PATCH",{...data,confirm_retention});
      refresh();
    };
    try { await save(); toast("Réglages enregistrés."); }
    catch(error) {
      if(error.status===409) confirmDialog("Appliquer les durées de conservation",
        "La tâche supprimera les données nominatives ayant dépassé les durées définies. Les totaux de fréquentation seront conservés.",
        "Appliquer les durées",()=>save(true),"Durées enregistrées.",()=>{});
      else toast(error.message,"error");
    }
  });
  $("#purge-now",target).addEventListener("click",()=>confirmDialog("Lancer la tâche de purge",
    "La tâche applique les durées actuellement enregistrées.","Lancer",async()=>{
      Object.assign(current,await api("/gestion/confidentialite/purge","POST",{}));
      refresh();
    },"Tâche terminée.",()=>{}));
  const publicText=()=>paragraphs(current).map(([key,value])=>key+"\n"+(value||"À renseigner") + "\n").join("\n");
  $("#notice-download",target).addEventListener("click",()=>saveFile("TiceCDI-notice-familles.txt","text/plain;charset=utf-8",
    "TiceCDI — Notice d’information pour les élèves et les familles\n\n"+publicText()));
  $("#register-download",target).addEventListener("click",()=>saveFile("TiceCDI-fiche-registre.txt","text/plain;charset=utf-8",
    "TiceCDI — Fiche à valider pour le registre des traitements\n\n"+publicText()+
    "\nPersonnes concernées\nÉlèves et agents disposant d’un compte nominatif.\n\nMesures techniques\nHabilitations, poste de pointage activé, sauvegardes chiffrées, purge et statistiques agrégées.\n\nÀ compléter localement\nResponsable, sous-traitants, transferts éventuels, mesures organisationnelles et décision sur l’AIPD.\n"));
  refresh();
}

export async function renderDossier(target,{section,toast,dialogForm,canExport,canRectify,canErase,readOnlyPill}) {
  target.innerHTML=section("Dossiers individuels","Recherchez un élève pour traiter une demande validée par l’établissement.",canRectify||canErase?"":readOnlyPill())+
    `<form id="find-dossier" class="panel panel-body stack"><label class="field"><span>Nom, prénom ou identifiant interne</span>
      <input name="query" type="search" minlength="3" maxlength="90" required></label>
      <button class="btn primary" type="submit">Rechercher</button><div id="dossier-results" aria-live="polite"></div></form>
      <section id="student-dossier" aria-live="polite"></section>`;
  const form=$("#find-dossier",target), list=$("#dossier-results",target), panel=$("#student-dossier",target);
  async function find() {
    panel.replaceChildren();
    const {rows}=await api("/gestion/dossier/recherche","POST",{q:form.elements.query.value.trim()});
    list.innerHTML=rows.length?rows.map(row=>button(e(row.first_name+" "+row.last_name+" · "+row.class_name),"user",`data-student="${e(row.id)}"`)).join(" "):"<p>Aucun résultat.</p>";
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    try { await find(); } catch(error){toast(error.message,"error");}
  });
  async function load(id) {
    const file=await api("/gestion/dossier/"+id);
    const {student,visits,attendance,exclusions,archives}=file;
    const moment=(value)=>day(value)+" "+time(value);
    const subsection=(title,lines)=>`<h3>${e(title)}</h3>${lines.length?"<ul>"+lines.map(line=>"<li>"+e(line)+"</li>").join("")+"</ul>":"<p>Aucune donnée conservée.</p>"}`;
    panel.innerHTML=`<div class="panel panel-body stack notice-body"><h2>${e(student.first_name+" "+student.last_name)}</h2>
      <p>${e(student.class_name)}${student.external_id?" · "+e(student.external_id):""}</p>
      <div class="button-row">${canRectify?button("Rectifier","edit",'id="rectify-student"'):""}
      ${canExport?button("Exporter ce dossier","download",'id="export-student"'):""}
      ${canErase?button("Effacer ce dossier","trash",'id="erase-student"',"danger"):""}</div>
      ${subsection("Passages",visits.map(row=>moment(row.starts_at)+" · "+(row.ended_at?"Sortie enregistrée à "+moment(row.ended_at):
        row.expires_at<=Date.now()?"Créneau expiré à "+moment(row.expires_at):"Échéance prévue à "+moment(row.expires_at))))}
      ${subsection("Fiches d’appel",attendance.map(row=>moment(row.started_at)+" · "+({present:"Présent",retard:"Retard",absent:"Absent",excuse:"Excusé",attente:"En attente",exclu:"Exclu"}[row.status]??row.status)))}
      ${subsection("Exclusions",exclusions.map(row=>row.until_day+" · "+row.reason))}
      ${subsection("Archives scolaires",archives.map(row=>row.year_label+" · "+row.class_name))}</div>`;
    $("#rectify-student",panel)?.addEventListener("click",async()=>{
      try {
        const {rows:classes}=await api("/gestion/classes");
        dialogForm("Rectifier le dossier",`<label class="field"><span>Prénom</span><input name="first_name" value="${e(student.first_name)}" required></label>
          <label class="field"><span>Nom</span><input name="last_name" value="${e(student.last_name)}" required></label>
          <label class="field"><span>Classe</span><select name="class_id">${classes.map(c=>`<option value="${e(c.id)}" ${c.id===student.class_id?"selected":""}>${e(c.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Identifiant interne</span><input name="external_id" value="${e(student.external_id)}"></label>`,"Enregistrer",
          form=>api("/gestion/dossier/"+id,"PATCH",Object.fromEntries(new FormData(form))),{refresh:()=>load(id)});
      }catch(error){toast(error.message,"error");}
    });
    $("#export-student",panel)?.addEventListener("click",async()=>{
      try {
        const data=await api("/gestion/dossier/"+id+"/export");
        saveFile("TiceCDI-dossier-eleve.json","application/json",JSON.stringify(data,null,2));
      }catch(error){toast(error.message,"error");}
    });
    $("#erase-student",panel)?.addEventListener("click",()=>dialogForm("Effacer ce dossier",`
      <p>Seuls les totaux anonymes seront conservés. Les anciennes sauvegardes gardées sur ce serveur seront supprimées.</p>
      <label class="field"><span>Tapez EFFACER pour confirmer</span><input name="confirmation" required pattern="EFFACER"></label>`,
      "Effacer",form=>api("/gestion/dossier/"+id,"DELETE",{confirmation:form.elements.confirmation.value}),{danger:true,refresh:find}));
  }
  list.addEventListener("click",event=>{
    const id=event.target.closest("[data-student]")?.dataset.student;
    if(id) load(id).catch(error=>toast(error.message,"error"));
  });
}
