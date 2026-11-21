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
  const cell=value=>{
    const text=String(value??"");
    const safe=typeof value==="string" && /^[=+\-@\t\r]/.test(text) ? "'"+text : text;
    return '"'+safe.replace(/"/g,'""')+'"';
  };
  const rows=[
    ["Type","Période ou groupe","Passages","Élèves distincts","Passages en classe"],
    ["Période",data.from+" au "+data.to,data.visits,data.students,data.group_visits],
    ["Indicateur","Pic simultané",data.peak],["Indicateur","Durée moyenne en minutes",Math.round(data.average)],
    ["Indicateur","Sorties avant l’échéance",data.early_exits],
    ...data.daily.map(row=>["Date",row.day,row.visits]),
    ...data.weekdays.map((value,i)=>["Jour",names[i],value]),
    ...data.hours.map((value,i)=>["Heure",String(i).padStart(2,"0")+" h",value]),
    ...data.classes.map(row=>["Classe",row.name,row.visits,row.students,row.group_visits]),
  ];
  return "\uFEFF"+rows.map(row=>row.map(cell).join(";")).join("\r\n");
}

export async function renderStatistics(target,{section,toast}) {
  const end=today();
  const begin=shift(end,-29);
  target.innerHTML=section("Statistiques de fréquentation","Analysez les passages enregistrés au CDI, sur la période de votre choix.",
    button("Exporter en CSV","download",'id="stat-export" disabled'))
    +`<form class="panel stat-filters" id="stat-form"><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-range="today"')}${button("Cette semaine","","data-range=week")}${button("30 derniers jours","","data-range=month")}
    </div><label class="field"><span>Du</span><input name="from" type="date" max="${end}" required value="${begin}"></label>
    <label class="field"><span>Au</span><input name="to" type="date" max="${end}" required value="${end}"></label>
    <button class="btn primary" type="submit">${icon("refresh")} Appliquer</button></form><div id="stat-results" aria-live="polite"></div>`;
  const form=$("#stat-form",target), result=$("#stat-results",target), exportButton=$("#stat-export",target);
  let current, version=0;
  async function load() {
    const index=++version;
    exportButton.disabled=true;
    const query=new URLSearchParams(new FormData(form));
    try {
      const data=await api("/gestion/statistiques?"+query);
      if(index!==version) return;
      current=data;
      exportButton.disabled=false;
      const hours=data.hours.map((value,i)=>[String(i).padStart(2,"0")+" h",value]).filter(([label,count])=>count>0);
      const dailyMap=new Map(data.daily.map(row=>[row.day,row.visits]));
      const dailyCount=Math.round((Date.parse(data.to)-Date.parse(data.from))/86_400_000)+1;
      const daily=Array.from({length:dailyCount},(_,i)=>{const date=shift(data.from,i);return [day(date),dailyMap.get(date)??0];});
      result.innerHTML=`<div class="metrics stat-metrics">${[
        metric("Passages",number(data.visits),"scan"), metric("Élèves différents",number(data.students),"users"),
        metric("Durée moyenne observée",Math.round(data.average)+" min","clock"),
        metric("Passages en classe",number(data.group_visits),"grid"),metric("Pic simultané",number(data.peak),"users"),
        metric("Sorties avant l’échéance",number(data.early_exits),"logout"),
      ].join("")}</div><div class="stat-layout">
        ${barPanel("Par jour de la semaine",data.weekdays.map((total,i)=>[names[i],total]),"Nombre d’arrivées du lundi au dimanche")}
        ${barPanel("Par heure d’arrivée",hours.length?hours:[["Aucune arrivée",0]],"Heure locale de Paris")}
        ${barPanel("Évolution jour par jour",daily,"Passages par date, y compris les jours à zéro")}
        <section class="panel table-panel stat-panel"><div class="table-top"><h2>Par classe</h2></div>${data.classes.length?`<div class="scroll-table stat-class-table"><table>
          <thead><tr><th scope="col">Classe</th><th scope="col">Passages</th><th scope="col">Élèves distincts</th><th scope="col">En groupe</th></tr></thead>
          <tbody>${data.classes.map(row=>`<tr><td><strong>${e(row.name)}</strong></td><td>${number(row.visits)}</td><td>${number(row.students)}</td><td>${number(row.group_visits)}</td></tr>`).join("")}</tbody></table></div>`
          :'<p class="empty">Aucun passage sur cette période.</p>'}</section></div>`;
    } catch(error) {
      if(index!==version) return;
      result.innerHTML=notice(error.message,"error");
      toast(error.message,"error");
    }
  }
  form.addEventListener("submit",event=>{event.preventDefault(); load();});
  form.addEventListener("click",event=>{
    const range=event.target.closest("[data-range]")?.dataset.range;
    if(!range) return;
    form.elements.to.value=end;
    form.elements.from.value=range==="today"?end:range==="week"?weekStart(end):begin;
    load();
  });
  exportButton.addEventListener("click",()=>{if(current) saveFile("frequentation-CDI-"+current.from+"-"+current.to+".csv","text/csv;charset=utf-8",reportCsv(current));});
  await load();
}
