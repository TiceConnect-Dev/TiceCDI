import { api, day, e, icon, notice, today } from "./shared.js";
import { button, names, saveFile, settingsTime, shift, timeNumber, weekStart } from "./schedule.js";

const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];

export async function openingForm(target, toast) {
  const data=await api("/gestion/horaires");
  const preset=[1,2,3,4,5].flatMap(weekday=>[
    {weekday,start_min:480,end_min:720},{weekday,start_min:780,end_min:1020},
  ]);
  const form=document.createElement("form");
  form.className="panel panel-body stack opening-form";
  form.innerHTML=`<div class="opening-intro"><div><h2>Horaires d’ouverture du CDI</h2>
    <p class="subtle">Ajoutez plusieurs plages si le CDI ferme le midi. Fuseau horaire Europe/Paris.</p></div>
    ${button("Horaires types","calendar",'data-hours="preset"')}</div>
    <label class="check-line"><input type="checkbox" name="use_hours" ${data.use_hours?"checked":""}> Appliquer automatiquement les horaires à la borne</label>
    <div id="hours-grid"></div>
    <div class="form-actions"><button type="submit" class="btn primary">${icon("check")} Enregistrer les horaires</button></div>`;
  target.append(form);
  const grid=$("#hours-grid",form);
  const windowRow=(weekday,row)=>`<div class="hours-window">
    <label class="field"><span>Ouverture</span><input type="time" name="start" required aria-label="Ouverture ${names[weekday-1]}" value="${settingsTime(row?.start_min??480)}"></label>
    <label class="field"><span>Fermeture</span><input type="time" name="end" required aria-label="Fermeture ${names[weekday-1]}" value="${settingsTime(row?.end_min??720)}" ${row?.end_min===1440?'data-midnight="true"':""}></label>
    ${button("Retirer","close",'data-hours="remove"',"quiet tiny")}
  </div>`;
  function render(rows) {
    grid.innerHTML=names.map((name,i)=>{
      const weekday=i+1, hours=rows.filter(row=>row.weekday===weekday);
      return `<div class="hours-day" data-weekday="${weekday}"><strong>${name}</strong><div class="hours-windows">${hours.map(row=>windowRow(weekday,row)).join("")}</div>
        ${button("Ajouter une plage","plus",'data-hours="add"',"secondary tiny")}</div>`;
    }).join("");
  }
  render(data.hours);
  form.addEventListener("click",event=>{
    const action=event.target.closest("[data-hours]")?.dataset.hours;
    if(action==="preset") {render(preset); return;}
    if(action==="remove") event.target.closest(".hours-window").remove();
    if(action==="add") {
      const zone=event.target.closest(".hours-day");
      const windows=$(".hours-windows",zone);
      if(windows.children.length>=4) {toast("Quatre plages maximum par jour.","error");return;}
      windows.insertAdjacentHTML("beforeend",windowRow(Number(zone.dataset.weekday),null));
      windows.lastElementChild.querySelector("input").focus();
    }
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=$("[type=submit]",form);
    submit.disabled=true;
    try {
      const hours=$$(".hours-day",grid).flatMap(block=>$$(".hours-window",block).map(row=>{
        const end=$("[name=end]",row);
        return {
          weekday:Number(block.dataset.weekday),
          start_min:timeNumber($("[name=start]",row).value),
          end_min:end.dataset.midnight&&end.value==="23:59"?1440:timeNumber(end.value),
        };
      }));
      const saved=await api("/gestion/horaires","PATCH",{use_hours:form.elements.use_hours.checked,hours});
      render(saved.hours);
      toast("Horaires d’ouverture enregistrés.");
    } catch(error){toast(error.message,"error");}
    finally{submit.disabled=false;}
  });
}

const displayNumber=new Intl.NumberFormat("fr-FR");
function number(value) { return displayNumber.format(value); }
function metric(label,value,mark) {
  return `<div class="metric"><span class="icon-box">${icon(mark)}</span><div><b>${e(value)}</b><span>${e(label)}</span></div></div>`;
}
function barPanel(title, rows, caption) {
  const max=Math.max(1,...rows.map(([,value])=>value));
  return `<section class="panel panel-body stat-panel"><h2>${title}</h2><p class="hint">${caption}</p>
    <div class="stat-bars">${rows.map(([label,count])=>`<div class="stat-bar"><span>${e(label)}</span><progress max="${max}" value="${count}" aria-label="${e(label+" · "+count+" passage(s)")}"></progress><strong>${number(count)}</strong></div>`).join("")}</div></section>`;
}
function reportCsv(data) {
  return "\uFEFFPériode;Passages;Durée moyenne (min)\r\n"+
    [data.from+" au "+data.to,data.visits,Math.round(data.average)].join(";")+"\r\n"+
    data.daily.map(row=>row.day+";"+row.visits).join("\r\n");
}

export async function renderStatistics(target,{section,toast,canExport}) {
  const end=today();
  const begin=shift(end,-29);
  target.innerHTML=section("Statistiques de fréquentation","Les petits effectifs sont regroupés. Les totaux incluent les passages archivés.",
    canExport?button("Exporter en CSV","download",'id="stat-export" disabled'):"")
    +`<form class="panel stat-filters" id="stat-form"><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-range="today"')}${button("Cette semaine","","data-range=week")}${button("30 derniers jours","","data-range=month")}
    </div><label class="field"><span>Du</span><input name="from" type="date" max="${end}" required value="${begin}"></label>
    <label class="field"><span>Au</span><input name="to" type="date" max="${end}" required value="${end}"></label>
    <button class="btn primary" type="submit">${icon("refresh")} Appliquer</button></form><div id="stat-results" aria-live="polite"></div>`;
  const form=$("#stat-form",target), result=$("#stat-results",target), exportButton=$("#stat-export",target);
  let current, version=0;
  async function load() {
    const index=++version;
    if(exportButton) exportButton.disabled=true;
    try {
      const data=await api("/gestion/statistiques?"+new URLSearchParams(new FormData(form)));
      if(index!==version) return;
      current=data;
      if(data.hidden) {result.innerHTML=notice("Sur cette période, le seuil de "+data.threshold+" élèves distincts n’est pas atteint.");return;}
      if(exportButton) exportButton.disabled=false;
      result.innerHTML=`<div class="metrics stat-metrics">${metric("Passages",number(data.visits),"scan")}
        ${metric("Durée moyenne observée",Math.round(data.average)+" min","clock")}</div>`+
        (data.daily.length ? barPanel("Passages par jour",data.daily.map(row=>[day(row.day),row.visits]),"Totaux agrégés de l’établissement")
          : notice("Seul le total de la période est affiché pour regrouper les petits effectifs."));
    } catch(error) {
      if(index!==version) return;
      result.innerHTML=notice(error.message,"error");
      toast(error.message,"error");
    }
  }
  form.addEventListener("submit",event=>{event.preventDefault();load();});
  form.addEventListener("click",event=>{
    const range=event.target.closest("[data-range]")?.dataset.range;
    if(!range)return;
    form.elements.from.value=range==="today"?end:range==="week"?weekStart(end):begin;
    form.elements.to.value=end;
    load();
  });
  exportButton?.addEventListener("click",async()=>{
    try {
      if(!current || current.hidden) return;
      await api("/gestion/export","POST",{type:"statistiques"});
      saveFile("TiceCDI-frequentation-"+current.from+"-"+current.to+".csv","text/csv;charset=utf-8",reportCsv(current));
    } catch(error) {toast(error.message,"error");}
  });
  await load();
}
