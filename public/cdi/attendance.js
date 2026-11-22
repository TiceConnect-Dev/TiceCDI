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
// Grille jour × heure : intensité relative, toutes les valeurs affichées.
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
    <p class="hint">Passages conservés, selon l’heure d’arrivée. Toutes les valeurs sont affichées.</p>
    <div class="scroll-table"><table class="heatmap"><thead><tr><th scope="col">Jour</th>${grid.slots.map(h=>`<th scope="col">${h}h</th>`).join("")}</tr></thead>
    <tbody>${grid.days.map(weekday=>`<tr><th scope="row">${weekdayNames[weekday-1]}</th>${grid.slots.map(hour=>{
      const value=grid.value(weekday,hour);
      const level=value?Math.max(1,Math.round(value/grid.max*5)):0;
      return `<td class="heat-${level}" title="${weekdayNames[weekday-1]} ${hour}h : ${value} passage(s)">${value||""}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}
const sourceNames={individuel:"Venue individuelle (borne)",classe:"Venue avec la classe",groupe:"Venue avec un groupe"};
const percent=(part,total)=>total?number(Math.round(part/total*1000)/10)+" %":"—";
const round1=value=>Math.round(value*10)/10;
const one=value=>number(round1(value));
// Au-delà de deux mois, les barres quotidiennes sont regroupées par semaine pour rester lisibles.
export function periodBars(daily) {
  if(daily.length<=62) return {title:"Passages par jour",rows:daily.map(row=>[day(row.day),row.visits])};
  const weeks=new Map();
  for(const row of daily){const key=weekStart(row.day);weeks.set(key,(weeks.get(key)??0)+row.visits);}
  return {title:"Passages par semaine",rows:[...weeks].map(([key,visits])=>["Sem. du "+day(key),visits])};
}
function evolution(data) {
  if(!data.previous?.visits) return "Pas de passage sur la période précédente";
  const delta=(data.visits-data.previous.visits)/data.previous.visits*100;
  return (delta>=0?"+":"")+Math.round(delta)+" % par rapport à la période précédente ("+number(data.previous.visits)+")";
}
function classTable(data) {
  if(!data.classes.length) return "";
  return `<section class="panel table-panel stat-panel"><div class="table-top"><h2>Fréquentation par classe</h2></div>
    <div class="scroll-table stat-class-table"><table><thead><tr><th>Classe</th><th>Passages</th><th>Élèves venus</th><th>Effectif</th><th>Taux de venue</th><th>Passages / élève</th><th>Avec la classe ou un groupe</th></tr></thead>
    <tbody>${data.classes.map(row=>`<tr><td><strong>${e(row.name)}</strong></td><td>${number(row.visits)}</td><td>${number(row.students)}</td>
      <td>${row.size?number(row.size):"—"}</td><td>${row.size?percent(row.students,row.size):"—"}</td><td>${one(row.visits/row.students)}</td><td>${number(row.group_visits)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function reportCsv(data) {
  const line=cells=>cells.map(cell=>String(cell??"").replaceAll(";",",")).join(";");
  const lines=[
    line(["Période",data.from+" au "+data.to]), line(["Passages",data.visits]), line(["Élèves distincts (passages conservés)",data.students]),
    line(["Moyenne par jour avec passages",round1(data.per_day)]), line(["Durée moyenne (min)",Math.round(data.average)]),
    line(["Heures cumulées",round1(data.observed_hours)]), line(["Pic de présence simultanée",data.peak]),
    line(["Venues avec une classe ou un groupe",data.group_visits]), line(["Sorties avant l’échéance",data.early_exits]),
    line(["Période précédente ("+data.previous.from+" au "+data.previous.to+")",data.previous.visits]), "",
    line(["Jour","Passages","Élèves distincts","Avec classe ou groupe","Sorties anticipées"]),
    ...data.daily.map(row=>line([row.day,row.visits,row.students,row.group_visits,row.early_exits])), "",
    line(["Classe","Passages","Élèves venus","Effectif","Taux de venue","Avec classe ou groupe"]),
    ...data.classes.map(row=>line([row.name,row.visits,row.students,row.size,row.size?percent(row.students,row.size):"",row.group_visits])), "",
    line(["Jour de la semaine","Heure","Passages"]),
    ...data.hours.map(row=>line([weekdayNames[row.weekday-1],row.hour+"h",row.visits])), "",
    line(["Durée de présence","Passages"]), ...data.durations.map(row=>line([row.label,row.count])), "",
    line(["Assiduité","Élèves"]), ...data.frequency.map(row=>line([row.label,row.count])), "",
    line(["Type de venue","Passages"]), ...data.sources.map(row=>line([sourceNames[row.source]??row.source,row.visits])),
  ];
  return "﻿"+lines.join("\r\n");
}

export async function renderStatistics(target,{section,toast,canExport}) {
  const end=today();
  const begin=shift(end,-29);
  target.innerHTML=section("Statistiques de fréquentation","Toutes les valeurs sont affichées, même les plus petites. Les totaux incluent les passages archivés.",
    canExport?button("Rapport PDF","print",'id="stat-pdf" disabled')+button("Exporter en CSV","download",'id="stat-export" disabled'):"")
    +`<form class="panel stat-filters" id="stat-form"><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-range="today"')}${button("Cette semaine","","data-range=week")}${button("30 derniers jours","","data-range=month")}
      ${button("Ce trimestre","","data-range=quarter")}${button("Année scolaire","","data-range=year")}
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
      if(!data.visits) {result.innerHTML=notice("Aucun passage enregistré sur cette période.");return;}
      if(exportButton) exportButton.disabled=false;
      if(pdfButton) pdfButton.disabled=false;
      const weekdays=weekdayAverages(data.daily);
      const bars=periodBars(data.daily);
      const totalSources=data.sources.reduce((total,row)=>total+row.visits,0);
      const detailNote=data.retained_from && data.daily.some(row=>row.day<data.retained_from)
        ? `Répartitions détaillées calculées sur les passages conservés depuis le ${day(data.retained_from)} (les plus anciens sont archivés en totaux).`
        : "Répartitions calculées sur les passages de la période.";
      result.innerHTML=`<div class="metrics stat-metrics">
        ${metric("Passages",number(data.visits),"scan")}
        ${metric("Élèves différents",number(data.students),"users")}
        ${metric("Moyenne par jour d’ouverture",number(round1(data.per_day)),"calendar")}
        ${metric("Durée moyenne de présence",Math.round(data.average)+" min","clock")}
        ${metric("Heures cumulées au CDI",number(Math.round(data.observed_hours)),"clock")}
        ${metric("Pic d’élèves présents en même temps",number(data.peak),"chart")}
        ${metric("Venues avec la classe ou un groupe",percent(data.group_visits,data.visits),"users")}
        ${metric("Sorties avant l’échéance",percent(data.early_exits,data.visits),"logout")}
      </div>
      <p class="stat-trend">${icon("chart")} ${e(evolution(data))}${data.busiest?` · Journée la plus chargée : <b>${day(data.busiest.day)}</b> (${number(data.busiest.visits)} passages)`:""}
        · ${number(data.days)} jour(s) avec passages${data.students?` · ${one(data.retained_visits/data.students)} passage(s) par élève en moyenne`:""}</p>
      <div class="stat-layout">
        ${barPanel(bars.title,bars.rows,"Totaux de l’établissement, passages archivés compris")}
        ${weekdays.length ? barPanel("Moyenne par jour de la semaine",weekdays.map(row=>[row.name,round1(row.average)]),"Passages moyens par jour d’ouverture") : ""}
      </div>
      ${heatPanel(data.hours)}
      ${classTable(data)}
      <div class="stat-layout stat-three">
        ${barPanel("Durée de présence",data.durations.map(row=>[row.label,row.count]),"Nombre de passages")}
        ${barPanel("Assiduité des élèves",data.frequency.map(row=>[row.label,row.count]),"Nombre d’élèves selon leurs passages sur la période")}
        ${barPanel("Type de venue",data.sources.map(row=>[(sourceNames[row.source]??row.source)+" · "+percent(row.visits,totalSources),row.visits]),"Nombre de passages")}
      </div>
      <p class="hint">${e(detailNote)}</p>`;
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
    const [year,month]=end.split("-").map(Number);
    // Trimestre civil en cours ; année scolaire à partir du 1er septembre.
    const quarter=`${year}-${String(Math.floor((month-1)/3)*3+1).padStart(2,"0")}-01`;
    const school=`${month>=9?year:year-1}-09-01`;
    form.elements.from.value=range==="today"?end:range==="week"?weekStart(end):range==="quarter"?quarter:range==="year"?(shift(end,-365)>school?shift(end,-365):school):begin;
    form.elements.to.value=end;
    load();
  });
  pdfButton?.addEventListener("click",async()=>{
    try {
      if(!current?.visits) return;
      await api("/gestion/export","POST",{type:"statistiques"});
      saveFile("TiceCDI-rapport-"+current.from+"-"+current.to+".pdf","application/pdf",statsPdf(current,weekdayAverages(current.daily),heatGrid(current.hours),periodBars(current.daily)));
    } catch(error) {toast(error.message,"error");}
  });
  exportButton?.addEventListener("click",async()=>{
    try {
      if(!current?.visits) return;
      await api("/gestion/export","POST",{type:"statistiques"});
      saveFile("TiceCDI-frequentation-"+current.from+"-"+current.to+".csv","text/csv;charset=utf-8",reportCsv(current));
    } catch(error) {toast(error.message,"error");}
  });
  await load();
}
