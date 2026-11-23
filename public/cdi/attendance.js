import { api, day, e, icon, notice, today } from "./shared.js";
import { button, names, saveFile, settingsTime, shift, timeNumber, weekStart } from "./schedule.js";
import { statsPdf } from "./planning-pdf.js";
import { bindTips, columnChart, donutChart, lineChart, rankChart } from "./charts.js";

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
function metric(label,value,mark,detail="") {
  return `<div class="metric"><span class="icon-box">${icon(mark)}</span><div><b>${e(value)}</b><span>${e(label)}</span>${detail?`<small>${e(detail)}</small>`:""}</div></div>`;
}
function panel(title, caption, body, extra="") {
  return `<section class="panel panel-body stat-panel ${extra}"><div class="stat-head"><h3>${e(title)}</h3>${caption?`<p class="hint">${e(caption)}</p>`:""}</div>${body}</section>`;
}
const weekdayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
// Moyenne des passages par jour de la semaine (jours ouverts de la période, d’après les totaux quotidiens).
export function weekdayAverages(daily) {
  const buckets=weekdayNames.map(()=>({total:0,days:0}));
  for(const row of daily){const index=(new Date(row.day+"T12:00:00Z").getUTCDay()+6)%7;buckets[index].total+=row.visits;buckets[index].days++;}
  return buckets.map((bucket,index)=>({name:weekdayNames[index],average:bucket.days?bucket.total/bucket.days:0,total:bucket.total,days:bucket.days})).filter(row=>row.days);
}
// Grille jour × heure : intensité relative, toutes les valeurs affichées. Les jours sont triés du lundi au dimanche.
// Les jours purgés avant la v1.12 n’ont gardé que leur total : il apparaît dans « Heure non conservée » (unknown).
export function heatGrid(hours, daily=[]) {
  const cell=new Map(), byDay=new Map(), known=new Map();
  for(const row of hours??[]) {
    cell.set(row.weekday+"-"+row.hour,(cell.get(row.weekday+"-"+row.hour)??0)+row.visits);
    known.set(row.weekday,(known.get(row.weekday)??0)+row.visits);
  }
  for(const row of daily) { const weekday=(new Date(row.day+"T12:00:00Z").getUTCDay()+6)%7+1; byDay.set(weekday,(byDay.get(weekday)??0)+row.visits); }
  const days=[...new Set([...known.keys(),...[...byDay].filter(([,v])=>v>0).map(([k])=>k)])].sort((a,b)=>a-b);
  if(!days.length) return null;
  const hoursKnown=(hours??[]).map(row=>row.hour);
  const first=hoursKnown.length?Math.min(...hoursKnown):8, last=hoursKnown.length?Math.max(...hoursKnown):8;
  const max=Math.max(1,...cell.values());
  const slots=hoursKnown.length?Array.from({length:last-first+1},(_,i)=>first+i):[];
  const unknown=(weekday)=>Math.max(0,(byDay.get(weekday)??0)-(known.get(weekday)??0));
  return {days,slots,max,value:(weekday,hour)=>cell.get(weekday+"-"+hour)??0,unknown,hasUnknown:days.some(day=>unknown(day)>0),
    total:(weekday)=>Math.max(byDay.get(weekday)??0,known.get(weekday)??0)};
}
// Arrivées cumulées par heure (tous jours confondus).
export function hourTotals(hours) {
  const totals=new Map();
  for(const row of hours??[]) totals.set(row.hour,(totals.get(row.hour)??0)+row.visits);
  if(!totals.size) return [];
  const first=Math.min(...totals.keys()), last=Math.max(...totals.keys());
  return Array.from({length:last-first+1},(_,i)=>first+i).map(hour=>[hour+"h",totals.get(hour)??0,`${hour} h – ${hour+1} h`]);
}
const monthFormat=new Intl.DateTimeFormat("fr-FR",{month:"short",timeZone:"UTC"});
const monthLong=new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"});
export function monthRows(daily) {
  const months=new Map();
  for(const row of daily) months.set(row.day.slice(0,7),(months.get(row.day.slice(0,7))??0)+row.visits);
  return [...months].sort().map(([key,visits])=>{const date=new Date(key+"-15T12:00:00Z");return [monthFormat.format(date),visits,monthLong.format(date)];});
}
// Niveau déduit du nom de classe (6e, 5e… 2de, 1re, Terminale, BTS, CAP…).
export function levelOf(name) {
  const text=String(name??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
  if(/\bbts\b|^bts/.test(text)) return "BTS";
  if(/cpge|prepa|^mp|^pcsi/.test(text)) return "Classes prépa";
  if(/\bcap\b|^cap/.test(text)) return "CAP";
  if(/ulis/.test(text)) return "ULIS";
  if(/segpa/.test(text)) return "SEGPA";
  if(/^(6|six)/.test(text)) return "6e";
  if(/^(5|cinq)/.test(text)) return "5e";
  if(/^(4|quat)/.test(text)) return "4e";
  if(/^(3|trois)/.test(text)) return "3e";
  if(/^(2|sec|sde)/.test(text)) return "2de";
  if(/^(1|prem)/.test(text)) return "1re";
  if(/^(t|term)/.test(text)) return "Terminale";
  return "Autres";
}
const levelOrder=["6e","5e","4e","3e","SEGPA","ULIS","2de","1re","Terminale","CAP","BTS","Classes prépa","Autres"];
export function levelRows(classes) {
  const levels=new Map();
  for(const row of classes) {
    const name=levelOf(row.name), entry=levels.get(name)??{name,visits:0,students:0,size:0,classes:0,partial:false};
    entry.visits+=row.visits; entry.students+=row.students; entry.size+=row.size||0; entry.classes++; entry.partial||=row.partial;
    levels.set(name,entry);
  }
  return [...levels.values()].sort((a,b)=>levelOrder.indexOf(a.name)-levelOrder.indexOf(b.name));
}
// Élèves touchés : au moins la somme des élèves venus par classe (les jours archivés ne gardent qu’un minimum).
export function reach(data) {
  const byClass=data.classes.reduce((total,row)=>total+row.students,0);
  return {students:Math.max(data.students,byClass),partial:data.classes.some(row=>row.partial)};
}
const sourceNames={individuel:"Venue individuelle (borne)",classe:"Venue avec la classe",groupe:"Venue avec un groupe"};
const percent=(part,total)=>total?number(Math.round(part/total*1000)/10)+" %":"—";
const round1=value=>Math.round(value*10)/10;
const one=value=>number(round1(value));
const short=iso=>iso.slice(8,10)+"/"+iso.slice(5,7);
// Au-delà de deux mois, les barres quotidiennes sont regroupées par semaine pour rester lisibles.
export function periodBars(daily) {
  if(daily.length<=62) return {title:"Passages par jour",weekly:false,rows:daily.map(row=>[short(row.day),row.visits,day(row.day)])};
  const weeks=new Map();
  for(const row of daily){const key=weekStart(row.day);weeks.set(key,(weeks.get(key)??0)+row.visits);}
  return {title:"Passages par semaine",weekly:true,rows:[...weeks].map(([key,visits])=>[short(key),visits,"Semaine du "+day(key)])};
}
function evolution(data) {
  if(!data.previous?.visits) return "Pas de passage sur la période précédente";
  const delta=(data.visits-data.previous.visits)/data.previous.visits*100;
  return (delta>=0?"+":"")+Math.round(delta)+" % par rapport à la période précédente ("+number(data.previous.visits)+")";
}
function heatPanel(grid) {
  if(!grid) return "";
  const body=`<div class="scroll-table"><table class="heatmap"><thead><tr><th scope="col">Jour</th>${grid.slots.map(h=>`<th scope="col">${h}h</th>`).join("")}${grid.hasUnknown?`<th scope="col">Sans heure</th>`:""}<th scope="col">Total</th></tr></thead>
    <tbody>${grid.days.map(weekday=>`<tr><th scope="row">${weekdayNames[weekday-1]}</th>${grid.slots.map(hour=>{
      const value=grid.value(weekday,hour);
      const level=value?Math.max(1,Math.round(value/grid.max*5)):0;
      return `<td class="heat-${level}" title="${weekdayNames[weekday-1]} ${hour}h : ${value} passage(s)">${value||""}</td>`;
    }).join("")}${grid.hasUnknown?`<td class="heat-unknown">${grid.unknown(weekday)?number(grid.unknown(weekday)):""}</td>`:""}<td class="heat-total">${number(grid.total(weekday))}</td></tr>`).join("")}</tbody></table></div>`
    +(grid.hasUnknown?`<p class="hint">« Sans heure » : passages de jours purgés avant la mise à jour v1.12, dont seul le total a été gardé.</p>`:"");
  return panel("Affluence par jour et par heure","Nombre d’arrivées selon le jour de la semaine et l’heure, sur toute la période.",body,"stat-wide");
}
export const unattributed=data=>Math.max(0,data.visits-data.classes.reduce((t,row)=>t+row.visits,0));
function classTable(data) {
  if(!data.classes.length) return "";
  const floor=row=>row.partial?"≥ ":"";
  const body=`<div class="scroll-table stat-class-table"><table><thead><tr><th>Classe</th><th>Niveau</th><th>Passages</th><th>Part</th><th>Élèves venus</th><th>Effectif</th><th>Taux de venue</th><th>Passages / élève</th><th>Avec la classe ou un groupe</th></tr></thead>
    <tbody>${data.classes.map(row=>`<tr><td><strong>${e(row.name)}</strong></td><td>${e(levelOf(row.name))}</td><td>${number(row.visits)}</td><td>${percent(row.visits,data.visits)}</td><td>${floor(row)}${number(row.students)}</td>
      <td>${row.size?number(row.size):"—"}</td><td>${row.size?floor(row)+percent(row.students,row.size):"—"}</td><td>${row.students?one(row.visits/row.students):"—"}</td><td>${number(row.group_visits)}</td></tr>`).join("")}</tbody></table></div>`
    +(unattributed(data)?`<p class="hint">${number(unattributed(data))} passage(s) de jours purgés avant la v1.12 ne sont comptés que dans les totaux (classe non conservée).</p>`:"")
    +(data.classes.some(row=>row.partial)?`<p class="hint">« ≥ » : les jours archivés ne conservent que le nombre d’élèves par jour, sans identité ; le total réel peut être supérieur.</p>`:"");
  return panel("Détail par classe",`${number(data.classes.length)} classe(s) venue(s) sur la période.`,body,"stat-wide table-like");
}
function reportCsv(data) {
  const line=cells=>cells.map(cell=>String(cell??"").replaceAll(";",",")).join(";");
  const touched=reach(data);
  const lines=[
    line(["Période",data.from+" au "+data.to]), line(["Passages",data.visits]), line(["Élèves différents"+(touched.partial?" (minimum)":""),touched.students]),
    line(["Élèves inscrits",data.population??""]), line(["Taux de fréquentation",data.population?percent(touched.students,data.population):""]),
    line(["Moyenne par jour avec passages",round1(data.per_day)]), line(["Durée moyenne (min)",Math.round(data.average)]),
    line(["Heures cumulées",round1(data.observed_hours)]), line(["Pic de présence simultanée",data.peak]),
    line(["Venues avec une classe ou un groupe",data.group_visits]), line(["Sorties avant l’échéance",data.early_exits]),
    line(["Période précédente ("+data.previous.from+" au "+data.previous.to+")",data.previous.visits]), "",
    line(["Jour","Passages","Élèves distincts","Avec classe ou groupe","Sorties anticipées"]),
    ...data.daily.map(row=>line([row.day,row.visits,row.students,row.group_visits,row.early_exits])), "",
    line(["Mois","Passages"]), ...monthRows(data.daily).map(row=>line([row[2],row[1]])), "",
    line(["Jour de la semaine","Jours d’ouverture","Passages","Moyenne"]), ...weekdayAverages(data.daily).map(row=>line([row.name,row.days,row.total,round1(row.average)])), "",
    line(["Niveau","Classes","Passages","Élèves venus","Effectif","Taux de venue"]),
    ...levelRows(data.classes).map(row=>line([row.name,row.classes,row.visits,row.students,row.size,row.size?percent(row.students,row.size):""])), "",
    line(["Classe","Niveau","Passages","Élèves venus","Effectif","Taux de venue","Avec classe ou groupe"]),
    ...data.classes.map(row=>line([row.name,levelOf(row.name),row.visits,(row.partial?"≥ ":"")+row.students,row.size,row.size?percent(row.students,row.size):"",row.group_visits])), "",
    line(["Heure d’arrivée","Passages"]), ...hourTotals(data.hours).map(row=>line([row[2],row[1]])), "",
    line(["Jour de la semaine","Heure","Passages"]),
    ...data.hours.map(row=>line([weekdayNames[row.weekday-1],row.hour+"h",row.visits])), "",
    line(["Durée de présence","Passages"]), ...data.durations.map(row=>line([row.label,row.count])), "",
    line(["Assiduité","Élèves"]), ...data.frequency.map(row=>line([row.label,row.count])), "",
    line(["Type de venue","Passages"]), ...data.sources.map(row=>line([sourceNames[row.source]??row.source,row.visits])),
  ];
  return "﻿"+lines.join("\r\n");
}
// Toutes les vues dérivées utilisées par la page, le PDF et le CSV.
export function statsViews(data) {
  const weekdays=weekdayAverages(data.daily);
  const hours=hourTotals(data.hours);
  const busiestDay=weekdays.reduce((best,row)=>!best||row.average>best.average?row:best,null);
  const busiestHour=hours.reduce((best,row)=>!best||row[1]>best[1]?row:best,null);
  return {weekdays,hours,grid:heatGrid(data.hours,data.daily),bars:periodBars(data.daily),months:monthRows(data.daily),levels:levelRows(data.classes),
    reach:reach(data),busiestDay,busiestHour,levelOf,unattributed:unattributed(data)};
}

export async function renderStatistics(target,{section,toast,canExport}) {
  const end=today();
  const begin=shift(end,-29);
  target.innerHTML=section("Statistiques de fréquentation","Évolution, moments d’affluence, publics et modalités de venue. Les totaux incluent les passages archivés.",
    canExport?button("Rapport PDF","print",'id="stat-pdf" disabled')+button("Exporter en CSV","download",'id="stat-export" disabled'):"")
    +`<form class="panel stat-filters" id="stat-form"><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-range="today"')}${button("Cette semaine","","data-range=week")}${button("30 derniers jours","","data-range=month")}
      ${button("Ce trimestre","","data-range=quarter")}${button("Année scolaire","","data-range=year")}
    </div><label class="field"><span>Du</span><input name="from" type="date" max="${end}" required value="${begin}"></label>
    <label class="field"><span>Au</span><input name="to" type="date" max="${end}" required value="${end}"></label>
    <button class="btn primary" type="submit">${icon("refresh")} Appliquer</button></form><div id="stat-results" aria-live="polite"></div>`;
  const form=$("#stat-form",target), result=$("#stat-results",target), exportButton=$("#stat-export",target), pdfButton=$("#stat-pdf",target);
  bindTips(result);
  let current, version=0;
  async function load() {
    const index=++version;
    if(exportButton) exportButton.disabled=true;
    if(pdfButton) pdfButton.disabled=true;
    result.classList.add("is-loading");
    try {
      const data=await api("/gestion/statistiques?"+new URLSearchParams(new FormData(form)));
      if(index!==version) return;
      current=data;
      if(!data.visits) {result.innerHTML=notice("Aucun passage enregistré sur cette période.");return;}
      if(exportButton) exportButton.disabled=false;
      if(pdfButton) pdfButton.disabled=false;
      const v=statsViews(data);
      const totalSources=data.sources.reduce((total,row)=>total+row.visits,0);
      const touched=v.reach, floor=touched.partial?"≥ ":"";
      const evolutionChart=v.bars.weekly||v.bars.rows.length>45 ? lineChart(v.bars.rows) : columnChart(v.bars.rows);
      result.innerHTML=`<div class="metrics stat-metrics">
        ${metric("Passages",number(data.visits),"scan",evolution(data))}
        ${metric("Élèves différents",floor+number(touched.students),"users")}
        ${metric("Taux de fréquentation",data.population?floor+percent(touched.students,data.population):"—","chart",data.population?`sur ${number(data.population)} élèves inscrits`:"")}
        ${metric("Classes venues",number(data.classes.length),"grid")}
        ${metric("Moyenne par jour d’ouverture",number(round1(data.per_day)),"calendar",`${number(data.days)} jour(s) avec passages`)}
        ${metric("Durée moyenne de présence",Math.round(data.average)+" min","clock")}
        ${metric("Heures cumulées au CDI",number(Math.round(data.observed_hours)),"clock")}
        ${metric("Pic d’élèves présents en même temps",number(data.peak),"users")}
        ${metric("Jour le plus fréquenté",v.busiestDay?v.busiestDay.name:"—","calendar",v.busiestDay?`${one(v.busiestDay.average)} passages en moyenne`:"")}
        ${metric("Heure de pointe",v.busiestHour?v.busiestHour[2]:"—","clock",v.busiestHour?`${number(v.busiestHour[1])} arrivées`:"")}
        ${metric("Venues avec la classe ou un groupe",percent(data.group_visits,data.visits),"users")}
        ${metric("Sorties avant l’échéance",percent(data.early_exits,data.visits),"logout")}
      </div>
      ${data.busiest?`<p class="stat-trend">${icon("chart")} Journée la plus chargée : <b>${day(data.busiest.day)}</b> (${number(data.busiest.visits)} passages)${touched.students?` · ${one(data.visits/touched.students)} passage(s) par élève en moyenne`:""}</p>`:""}

      <h2 class="stat-section">Évolution</h2>
      <div class="stat-layout ${v.months.length>1?"stat-split":""}">
        ${panel(v.bars.title,"Totaux de l’établissement, passages archivés compris",evolutionChart)}
        ${v.months.length>1?panel("Passages par mois","",columnChart(v.months,{width:380,height:250})):""}
      </div>

      <h2 class="stat-section">Moments de fréquentation</h2>
      <div class="stat-layout">
        ${panel("Moyenne par jour de la semaine","Passages moyens par jour d’ouverture",columnChart(v.weekdays.map(row=>[row.name.slice(0,3)+".",round1(row.average),row.name]),{unit:"passage(s) en moyenne"}))}
        ${panel("Arrivées par heure","Tous jours confondus",columnChart(v.hours,{unit:"arrivée(s)"}))}
      </div>
      ${heatPanel(v.grid)}

      <h2 class="stat-section">Publics</h2>
      <div class="stat-layout">
        ${panel("Passages par niveau",`${v.levels.length} niveau(x)`,donutChart(v.levels.map(row=>[row.name,row.visits])))}
        ${panel("Classes les plus présentes","Les 10 premières classes en nombre de passages",rankChart(data.classes.map(row=>[row.name,row.visits,`${floor}${row.students} élève(s)`])))}
      </div>
      <div class="stat-layout">
        ${panel("Taux de venue par niveau","Part des élèves inscrits venus au moins une fois",rankChart(v.levels.filter(row=>row.size).map(row=>[row.name,round1(row.students/row.size*100),`${row.partial?"≥ ":""}${row.students} / ${row.size} élèves`]),{unit:"%",limit:13,suffix:" %"}))}
        ${panel("Assiduité des élèves","Nombre d’élèves selon leurs passages sur la période (passages conservés)",columnChart(data.frequency.map(row=>[row.label.replace(" passages","").replace(" passage",""),row.count,row.label]),{unit:"élève(s)",highlightMax:false}))}
      </div>

      <h2 class="stat-section">Modalités de venue</h2>
      <div class="stat-layout">
        ${panel("Type de venue",`${percent(data.group_visits,data.visits)} des venues se font avec une classe ou un groupe`,donutChart(data.sources.map(row=>[sourceNames[row.source]??row.source,row.visits])))}
        ${panel("Durée de présence","Nombre de passages selon le temps passé au CDI",columnChart(data.durations.map(row=>[row.label.replace("Moins de ","< ").replace("Plus de ","> "),row.count,row.label]),{highlightMax:false}))}
      </div>
      ${classTable(data)}
      <p class="hint">Totaux de passages : tous les jours de la période. Répartitions (heures, niveaux, classes, durées, types) : passages conservés et jours archivés en compteurs anonymes. Assiduité : passages encore conservés${data.retained_from?` (depuis le ${day(data.retained_from)})`:""}.${totalSources!==data.visits?" Les jours purgés avant la mise à jour v1.12 ne figurent que dans les totaux.":""}</p>`;
    } catch(error) {
      if(index!==version) return;
      result.innerHTML=notice(error.message,"error");
      toast(error.message,"error");
    } finally { if(index===version) result.classList.remove("is-loading"); }
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
      saveFile("TiceCDI-rapport-"+current.from+"-"+current.to+".pdf","application/pdf",statsPdf(current,statsViews(current)));
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
