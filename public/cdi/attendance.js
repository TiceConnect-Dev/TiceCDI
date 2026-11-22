import { api, day, e, icon, notice, today } from "./shared.js";
import { button, names, saveFile, settingsTime, shift, timeNumber, weekStart } from "./schedule.js";
import { statsPdf } from "./planning-pdf.js";

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
const weekdayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
// Moyenne des passages par jour de la semaine (jours ouverts de la période, d’après les totaux quotidiens).
export function weekdayAverages(daily) {
  const buckets=weekdayNames.map(()=>({total:0,days:0}));
  for(const row of daily){const index=(new Date(row.day+"T12:00:00Z").getUTCDay()+6)%7;buckets[index].total+=row.visits;buckets[index].days++;}
  return buckets.map((bucket,index)=>({name:weekdayNames[index],average:bucket.days?bucket.total/bucket.days:0,days:bucket.days})).filter(row=>row.days);
}
// Grille jour × heure : intensité relative, cases de moins de 5 passages masquées.
export function heatGrid(hours) {
  if(!hours?.length) return null;
  const known=hours.map(row=>row.hour);
  const first=Math.min(...known), last=Math.max(...known);
  const days=[...new Set(hours.map(row=>row.weekday))].sort();
  const cell=new Map(hours.map(row=>[row.weekday+"-"+row.hour,row.visits]));
  const max=Math.max(1,...hours.map(row=>row.visits??0));
  const slots=Array.from({length:last-first+1},(_,i)=>first+i);
  return {days,slots,max,value:(weekday,hour)=>cell.has(weekday+"-"+hour)?cell.get(weekday+"-"+hour):0};
}
function heatPanel(hours) {
  const grid=heatGrid(hours);
  if(!grid) return "";
  return `<section class="panel panel-body stat-panel heat-panel"><h2>Affluence par jour et par heure</h2>
    <p class="hint">Passages encore conservés, selon l’heure d’arrivée. « &lt;5 » : moins de cinq passages, non détaillé.</p>
    <div class="scroll-table"><table class="heatmap"><thead><tr><th scope="col">Jour</th>${grid.slots.map(h=>`<th scope="col">${h}h</th>`).join("")}</tr></thead>
    <tbody>${grid.days.map(weekday=>`<tr><th scope="row">${weekdayNames[weekday-1]}</th>${grid.slots.map(hour=>{
      const value=grid.value(weekday,hour);
      const level=value===null?1:value?Math.max(1,Math.round(value/grid.max*5)):0;
      return `<td class="heat-${level}" title="${weekdayNames[weekday-1]} ${hour}h : ${value===null?"moins de 5":value} passage(s)">${value===null?"&lt;5":value||""}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
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
    canExport?button("Rapport PDF","print",'id="stat-pdf" disabled')+button("Exporter en CSV","download",'id="stat-export" disabled'):"")
    +`<form class="panel stat-filters" id="stat-form"><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-range="today"')}${button("Cette semaine","","data-range=week")}${button("30 derniers jours","","data-range=month")}
    </div><label class="field"><span>Du</span><input name="from" type="date" max="${end}" required value="${begin}"></label>
    <label class="field"><span>Au</span><input name="to" type="date" max="${end}" required value="${end}"></label>
    <button class="btn primary" type="submit">${icon("refresh")} Appliquer</button></form><div id="stat-results" aria-live="polite"></div>`;
  const form=$("#stat-form",target), result=$("#stat-results",target), exportButton=$("#stat-export",target), pdfButton=$("#stat-pdf",target);
  let current, version=0;
  async function load() {
    const index=++version;
    if(exportButton) exportButton.disabled=true;
    if(pdfButton) pdfButton.disabled=true;
    try {
      const data=await api("/gestion/statistiques?"+new URLSearchParams(new FormData(form)));
      if(index!==version) return;
      current=data;
      if(data.hidden) {result.innerHTML=notice("Sur cette période, le seuil de "+data.threshold+" élèves distincts n’est pas atteint.");return;}
      if(exportButton) exportButton.disabled=false;
      if(pdfButton) pdfButton.disabled=false;
      const weekdays=weekdayAverages(data.daily);
      result.innerHTML=`<div class="metrics stat-metrics">${metric("Passages",number(data.visits),"scan")}
        ${metric("Durée moyenne observée",Math.round(data.average)+" min","clock")}</div>`+
        (data.daily.length ? barPanel("Passages par jour",data.daily.map(row=>[day(row.day),row.visits]),"Totaux agrégés de l’établissement")
          : notice("Seul le total de la période est affiché pour regrouper les petits effectifs."))
        +(weekdays.length>1 ? barPanel("Moyenne par jour de la semaine",weekdays.map(row=>[row.name,Math.round(row.average*10)/10]),"Passages moyens par jour d’ouverture") : "")
        +heatPanel(data.hours);
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
  pdfButton?.addEventListener("click",async()=>{
    try {
      if(!current || current.hidden) return;
      await api("/gestion/export","POST",{type:"statistiques"});
      saveFile("TiceCDI-rapport-"+current.from+"-"+current.to+".pdf","application/pdf",statsPdf(current,weekdayAverages(current.daily),heatGrid(current.hours)));
    } catch(error) {toast(error.message,"error");}
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
