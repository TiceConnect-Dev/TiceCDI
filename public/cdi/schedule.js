import { api, urlFor, brand, day, e, icon, notice, today } from "./shared.js";
import { timelineBounds, timelineForDay, weekPdf } from "./planning-pdf.js";

const names = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const kinds = { cours:"Cours",atelier:"Atelier",reservation:"Réservation",fermeture:"Fermeture exceptionnelle",autre:"Autre" };
const timeLabel = (n) => String(Math.floor(n/60)).padStart(2,"0") + ":" + String(n%60).padStart(2,"0");
const timeNumber = (text) => text ? Number(text.slice(0,2))*60 + Number(text.slice(3,5)) : NaN;
const shift = (date, delta) => new Date(Date.parse(date+"T12:00:00Z")+delta*86_400_000).toISOString().slice(0,10);
const weekStart = (date) => shift(date,-((new Date(date+"T12:00:00Z").getUTCDay()+6)%7));
const shortDate = (date) => day(date).slice(0,5);
const $ = (q,root=document) => root.querySelector(q);
const $$ = (q,root=document) => [...root.querySelectorAll(q)];
const button = (label, glyph, attrs="", mode="secondary") => `<button class="btn ${mode}" type="button" ${attrs}>${glyph ? icon(glyph) : ""}${label}</button>`;
const span = (slot) => timeLabel(slot.start_min)+"–"+timeLabel(slot.end_min);
function dateField(value) { return `<input type="date" id="week-start" class="input" min="2000-01-01" max="2199-12-25" aria-label="Choisir une semaine" value="${e(value)}">`; }
function weekLabel(data, last=data.end) { return day(data.start) + " – " + day(last); }
function saveFile(name,type,bytes) {
  const url = URL.createObjectURL(new Blob([bytes],{type}));
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function settingsTime(value) { return value===1440 ? "23:59" : timeLabel(value); }
function typePill(kind) { return `<span class="cal-dot cal-${e(kind)}"></span>${e(kinds[kind])}`; }
function dates(data, hideWeekend=data.hide_weekend) { return names.slice(0,hideWeekend?5:7).map((name,i)=>({name,date:shift(data.start,i),weekday:i+1})); }
function ticks(data, eligible) {
  const {first,last}=timelineBounds(data,eligible);
  return { first,last,steps:Array.from({length:(last-first)/60+1},(_,i)=>first+i*60) };
}
function calendar(data,{editor=false,oneDay=false,hideWeekend=data.hide_weekend}={}) {
  const eligible = dates(data,oneDay?false:hideWeekend).filter(item=>!oneDay || item.date===data.now.day);
  const {first,last,steps}=ticks(data,eligible);
  const range=last-first;
  const marker=(minute)=>(minute-first)/range*100;
  const cells=eligible.map(({name,date,weekday})=>{
    const isToday=date===data.now.day;
    const hours=data.hours.filter(row=>row.weekday===weekday);
    const available=hours.length ? hours.map(span).join(" · ") : data.use_hours || data.hours.length ? "Fermé" : "Horaires à définir";
    const rows=data.rows.filter(row=>row.day===date);
    const head=`<div class="cal-day${isToday?" cal-today":""}"><strong>${name} ${shortDate(date)}</strong><small>${e(available)}</small></div>`;
    const windows=hours.map(row=>`<div class="cal-open" data-y="${marker(row.start_min)}" data-height="${(row.end_min-row.start_min)/range*100}" aria-hidden="true"></div>`).join("");
    const slots=rows.map(row=>{
      const title=`${span(row)} · ${row.title}${row.class_name ? " · "+row.class_name : ""}`;
      const contained=`<div class="cal-meta"><time>${span(row)}</time>${row.class_name?`<span>${e(row.class_name)}</span>`:""}</div><strong>${e(row.title)}</strong>`;
      const attrs=`class="cal-slot cal-${row.kind}" data-y="${marker(row.start_min)}" data-height="${(row.end_min-row.start_min)/range*100}" title="${e(title)}"`;
      return editor ? `<button type="button" draggable="true" data-slot="${e(row.id)}" aria-label="${e(title)}" ${attrs}>${contained}</button>` : `<article ${attrs}>${contained}</article>`;
    }).join("");
    const now=isToday && data.now.minute>=first && data.now.minute<=last ? `<div class="cal-now" data-y="${marker(data.now.minute)}" aria-hidden="true"></div>` : "";
    return {head,col:`<div class="cal-column${isToday?" cal-today":""}" data-day="${date}" aria-label="${e(name+" "+day(date))}">${windows}${slots}${now}</div>`};
  });
  return {first,last,html:`<div class="cal-scroll"><div class="calendar-grid ${oneDay?"cal-single":""}" data-hours="${range/60}" data-days="${eligible.length}">
    <div class="cal-corner" aria-hidden="true">${icon("clock")}</div>${cells.map(cell=>cell.head).join("")}
    <div class="cal-ruler" aria-hidden="true">${steps.map(minute=>`<span data-y="${marker(minute)}">${timeLabel(minute)}</span>`).join("")}</div>${cells.map(cell=>cell.col).join("")}
  </div></div><div class="cal-legend" aria-label="Légende">${Object.keys(kinds).map(kind=>`<span>${typePill(kind)}</span>`).join("")}</div>`};
}
function accessiblePlanning(data,days,includeDetails) {
  const {first,last}=timelineBounds(data,days);
  const rows=days.flatMap(item=>timelineForDay(data,item,first,last).map(row=>{
    const state=row.event ? row.event.kind==="fermeture"?"Fermé":"Réservé" : {open:"Ouvert",closed:"Fermé",unknown:"Horaires à définir"}[row.state];
    const details=includeDetails && row.event ? " · "+row.event.title+(row.event.class_name?" · "+row.event.class_name:"") : "";
    return `<tr><th scope="row">${item.name} ${shortDate(item.date)}</th><td>${span(row)}</td><td>${e(state+details)}</td></tr>`;
  }));
  return `<details class="accessible-planning"><summary>Version tableau du planning</summary><div class="scroll-table"><table>
    <caption>Plages du CDI · heure de Paris</caption><thead><tr><th scope="col">Jour</th><th scope="col">Horaire</th><th scope="col">Statut</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div></details>`;
}
function sizeCalendar(target) {
  const grid=$(".calendar-grid",target);
  grid.style.setProperty("--hours",grid.dataset.hours);
  grid.style.setProperty("--days",grid.dataset.days);
  $$("[data-y]",grid).forEach(item=>{
    item.style.top=item.dataset.y+"%";
    if (item.dataset.height) item.style.height=item.dataset.height+"%";
  });
}

export async function renderPlanning(target, context) {
  const { section, dialogForm, confirmDialog, toast, openClassArrival, showScreenLink, canExport } = context;
  const [{rows:classes},{rows:groups}] = await Promise.all([api("/gestion/classes"),api("/gestion/groupes")]);
  const params=new URLSearchParams(location.search);
  let start=params.get("week") || weekStart(today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))) start=weekStart(today());
  else start=weekStart(start);
  target.innerHTML=section("Planning du CDI","Planifiez les cours et les réservations. Faites glisser un créneau ou ouvrez-le pour le modifier.",
      (showScreenLink?`<a class="btn secondary" href="${urlFor("/planning-ecran")}" target="_blank" rel="noopener">${icon("wide")} Vue écran</a>`:"")+
      button("Ajouter un créneau","plus",'data-plan="new"',"primary"))
    + `<section class="panel planning-panel"><div class="planning-toolbar">
      <div class="planning-navigation">${button("Précédente","previous",'data-plan="prev" aria-label="Semaine précédente"')}${dateField(start)}
      ${button("Suivante","chevron",'data-plan="next" aria-label="Semaine suivante"')}${button("Aujourd’hui","calendar",'data-plan="today"')}</div>
      <div class="head-actions">${button("Copier la semaine","copy",'data-plan="copy"')}${canExport?button("PDF d’une journée","download",'data-plan="day-pdf"')+button("PDF de la semaine","download",'data-plan="pdf"',"primary"):""}</div>
    </div><div class="planning-period"><div><h2 id="week-label"></h2><span class="hint" id="week-count"></span></div>
    <label class="check-line"><input type="checkbox" id="hide-weekend"> Masquer le week-end</label></div><div id="calendar-grid" class="planning-grid"></div></section>`;
  const board=$("#calendar-grid",target);
  const dateInput=$("#week-start",target);
  const weekend=$("#hide-weekend",target);
  let data, activeDrag, weekendOverride=null, ticket=0;
  async function load(date=start, writeHistory=false) {
    const sequence=++ticket;
    const next=weekStart(date);
    const result=await api("/gestion/planning?week="+encodeURIComponent(next));
    if (sequence!==ticket) return;
    data=result;
    start=next;
    dateInput.value=start;
    if (writeHistory) history.replaceState(null,"",urlFor("/gestion/planning?week="+start));
    weekend.checked=weekendOverride??data.hide_weekend;
    redraw();
  }
  function redraw() {
    const days=dates(data,weekend.checked);
    $("#week-label",target).textContent=weekLabel(data,days.at(-1).date);
    const count=data.rows.filter(row=>days.some(day=>day.date===row.day)).length;
    $("#week-count",target).textContent=count+" créneau"+(count>1?"x":"");
    const grid=calendar(data,{editor:true,hideWeekend:weekend.checked});
    board.innerHTML=grid.html+accessiblePlanning(data,days,true);
    sizeCalendar(board);
    bindBoard(grid.first,grid.last);
  }
  function bindBoard(first,last) {
    board.ondragstart=(event)=>{
      const item=event.target.closest("[data-slot]");
      const slot=item&&data.rows.find(row=>row.id===item.dataset.slot);
      if(!slot) return;
      const column=item.closest("[data-day]");
      const rect=column.getBoundingClientRect();
      const position=first+(event.clientY-rect.top)/rect.height*(last-first);
      activeDrag={slot,grab:Math.max(0,Math.min(slot.end_min-slot.start_min,position-slot.start_min))};
      event.dataTransfer.setData("text/plain",slot.id);
      event.dataTransfer.effectAllowed="move";
      item.classList.add("dragging");
    };
    board.ondragover=(event)=>{
      if(!activeDrag || !event.target.closest("[data-day]")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect="move";
    };
    board.ondragend=()=>{
      activeDrag=null;
      $(".dragging",board)?.classList.remove("dragging");
    };
    board.ondrop=async(event)=>{
      const column=event.target.closest("[data-day]");
      if (!activeDrag || !column) return;
      event.preventDefault();
      const {slot,grab}=activeDrag;
      activeDrag=null;
      $(".dragging",board)?.classList.remove("dragging");
      const rect=column.getBoundingClientRect();
      const duration=slot.end_min-slot.start_min;
      const value=first+(event.clientY-rect.top)/rect.height*(last-first)-grab;
      const start_min=Math.max(0,Math.min(1440-duration,Math.round(value/15)*15));
      const date=column.dataset.day;
      if (date===slot.day && start_min===slot.start_min) return;
      try {
        await api("/gestion/planning/"+slot.id,"PATCH",{...slot,day:date,start_min,end_min:start_min+duration});
        await load();
        toast("Créneau déplacé.");
      } catch(error) {toast(error.message,"error");}
    };
  }
  function edit(slot) {
    const options=Object.entries(kinds).map(([key,name])=>`<option value="${key}" ${slot?.kind===key?"selected":""}>${name}</option>`).join("");
    const classChoices=classes.map(row=>`<option value="classe:${e(row.id)}" ${slot?.class_id===row.id?"selected":""}>${e(row.name)}</option>`).join("");
    const selectable=groups.filter(row=>row.active || row.id===slot?.group_id);
    const groupChoices=selectable.map(row=>`<option value="groupe:${e(row.id)}" ${slot?.group_id===row.id?"selected":""}>${e(row.name)}${row.active?"":" · archivé"}</option>`).join("")
      + (slot?.group_id&&!selectable.some(row=>row.id===slot.group_id)?`<option selected value="groupe:${e(slot.group_id)}">${e(slot.class_name)} · archivé</option>`:"");
    const initialDate=slot?.day ?? (today()>=data.start && today()<=data.end ? today():data.start);
    const canCheckIn = openClassArrival && (slot?.attendance_id || (slot?.kind!=="fermeture" && (slot?.class_id||slot?.group_id) && slot.day===today()));
    dialogForm(slot?"Modifier le créneau":"Ajouter un créneau",`
      <label class="field"><span>Titre du créneau</span><input name="title" maxlength="80" required value="${e(slot?.title)}" placeholder="Ex. Recherche documentaire"><small>Ces détails sont réservés au planning interne et aux exports habilités.</small></label>
      <div class="form-grid">
        <label class="field"><span>Type</span><select name="kind">${options}</select></label>
        <label class="field"><span>Classe ou groupe</span><select name="roster"><option value="">Sans groupe associé</option><optgroup label="Classes">${classChoices}</optgroup><optgroup label="Groupes hors classe">${groupChoices}</optgroup></select></label>
      </div>
      <label class="field"><span>Date</span><input type="date" name="day" min="2000-01-01" max="2199-12-31" required value="${initialDate}"></label>
      <div class="form-grid">
        <label class="field"><span>Début</span><input type="time" name="start" required value="${timeLabel(slot?.start_min ?? 540)}"></label>
        <label class="field"><span>Fin</span><input type="time" name="end" required value="${settingsTime(slot?.end_min ?? 600)}"></label></div>
      <p class="hint">Un créneau de fermeture exceptionnelle bloque le pointage sur la borne pendant cette plage.</p>
      <label class="field"><span>Notes internes</span><textarea name="notes" maxlength="600">${e(slot?.notes)}</textarea><small>Visibles uniquement dans l’espace de gestion.</small></label>
      ${slot ? `<div class="button-row">${canCheckIn ? button(slot.attendance_id?"Ouvrir la fiche d’appel":"Faire l’appel","users",'data-checkin') : ""}
        ${button("Supprimer le créneau","trash",'data-remove',"danger")}</div>` : ""}`,slot?"Enregistrer":"Ajouter",async form=>{
        const fields=Object.fromEntries(new FormData(form));
        const [kind,id]=fields.roster.split(":");
        await api("/gestion/planning"+(slot?"/"+slot.id:""),slot?"PATCH":"POST",
          {...fields,class_id:kind==="classe"?id:null,group_id:kind==="groupe"?id:null,start_min:timeNumber(fields.start),end_min:slot?.end_min===1440 && fields.end==="23:59" ? 1440 : timeNumber(fields.end)});
        start=weekStart(fields.day);
      },{
        success:slot?"Créneau modifié.":"Créneau ajouté.",refresh:()=>load(start,true),
        ready:form=>{
          const checkIn=$("[data-checkin]",form);
          checkIn?.addEventListener("click",()=>{
            form.closest("dialog").close();
            Promise.resolve(openClassArrival(classes,{
              kind:slot.group_id?"groupe":"classe",roster_id:slot.group_id??slot.class_id,
              plan_id:slot.id,attendance_id:slot.attendance_id,duration:Math.min(240,slot.end_min-slot.start_min),
            })).catch(error=>toast(error.message,"error"));
          });
          const remove=$("[data-remove]",form); if(remove) remove.addEventListener("click",()=>{
          form.closest("dialog").close();
          confirmDialog("Supprimer le créneau",slot.title+" · "+day(slot.day)+" · "+span(slot),"Supprimer",()=>api("/gestion/planning/"+slot.id,"DELETE"),"Créneau supprimé.",load);
        });},
      });
  }
  target.addEventListener("change",event=>{
    if(event.target===dateInput&&dateInput.value) load(dateInput.value,true).catch(error=>toast(error.message,"error"));
    if(event.target===weekend&&data){weekendOverride=weekend.checked;redraw();}
  });
  target.addEventListener("click",async event=>{
    if(!target.contains(board)||!data) return;
    const slotNode=event.target.closest("[data-slot]");
    if(slotNode) { const slot=data.rows.find(row=>row.id===slotNode.dataset.slot); if(slot) edit(slot); return; }
    const action=event.target.closest("[data-plan]")?.dataset.plan;
    try {
      if(action==="new") edit();
      if(action==="prev" || action==="next") await load(shift(start,action==="prev"?-7:7),true);
      if(action==="today") await load(today(),true);
      if(action==="pdf" && canExport) {
        await api("/gestion/export","POST",{type:"planning"});
        saveFile("Planning-CDI-"+start+".pdf","application/pdf",weekPdf(data,dates(data,weekend.checked),kinds));
      }
      if(action==="day-pdf" && canExport) {
        const snapshot=data;
        const visibleDays=dates(snapshot,weekend.checked);
        dialogForm("Télécharger le PDF d’une journée",`
          <label class="field"><span>Journée du planning</span><select name="pdf_day" required>
            ${visibleDays.map(item=>`<option value="${item.date}" ${item.date===today()?"selected":""}>${item.name} ${day(item.date)}</option>`).join("")}
          </select></label>`,"Télécharger le PDF",async form=>{
            await api("/gestion/export","POST",{type:"planning"});
            const picked=visibleDays.find(item=>item.date===form.elements.pdf_day.value);
            if(picked) saveFile("Planning-CDI-"+picked.date+".pdf","application/pdf",weekPdf(snapshot,[picked],kinds));
          },{success:"PDF de la journée téléchargé."});
      }
      if(action==="copy") {
        const date=start;
        confirmDialog("Copier vers la semaine suivante","Les créneaux en conflit seront ignorés.","Copier",async()=>{
          const result=await api("/gestion/planning/copier","POST",{start:date});
          start=shift(date,7);
          return `${result.added} créneau(x) copié(s) · ${result.skipped} ignoré(s).`;
        },"Copie terminée.",()=>load(start,true),false);
      }
    } catch(error) {toast(error.message,"error");}
  });
  await load(start);
}

export function renderScreen(app) {
  app.innerHTML=`<main id="main" class="display-page"><header class="display-head">
    <div>${brand()}<h1>Planning du CDI</h1><p id="display-date"></p><p class="display-gauge" id="display-occupancy" role="status" hidden></p></div>
    <div class="display-tools"><time id="display-clock"></time><div class="button-row">
      ${button("Aujourd’hui","calendar",'data-screen="day" aria-pressed="false"')}
      ${button("Vue semaine","grid",'data-screen="week" aria-pressed="true"')}
      ${button("Plein écran","fullscreen",'data-screen="fullscreen"')}
    </div></div></header><div id="screen-notice" role="status"></div><div id="screen-planning"></div></main>`;
  const target=$("#screen-planning",app);
  const warning=$("#screen-notice",app);
  let oneDay=false;
  let pending=false;
  let data, lastGrid="";
  function draw() {
    if (!data) return;
    $("#display-date",app).textContent=oneDay ? day(data.now.day) : weekLabel(data,dates(data).at(-1).date);
    const fingerprint=JSON.stringify([oneDay,data.start,data.rows,data.hours,data.use_hours,data.hide_weekend,data.now]);
    if(fingerprint===lastGrid) return;
    lastGrid=fingerprint;
    const scroll=$(".cal-scroll",target)?.scrollLeft??0;
    const {html}=calendar(data,{oneDay});
    const tableOpen=$("details",target)?.open;
    const eligible=dates(data,oneDay?false:data.hide_weekend).filter(item=>!oneDay||item.date===data.now.day);
    target.innerHTML=html+accessiblePlanning(data,eligible,false);
    $("details",target).open=Boolean(tableOpen);
    sizeCalendar(target);
    $(".cal-scroll",target).scrollLeft=scroll;
  }
  const clockFormatter=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit"});
  function clock() { $("#display-clock",app).textContent=clockFormatter.format(new Date()); }
  async function refresh() {
    if(pending) return;
    pending=true;
    try {
      data=await api("/planning?week="+weekStart(today()));
      draw();
      // Places libres en temps réel (nombres agrégés uniquement).
      const seats=$("#display-occupancy",app), live=data.occupancy;
      seats.hidden=!live;
      if(live) seats.textContent=live.capacity===null
        ? `${live.occupied} élève${live.occupied>1?"s":""} au CDI`
        : live.places===0 ? `CDI complet · ${live.capacity} places` : `${live.places} place${live.places>1?"s":""} libre${live.places>1?"s":""} sur ${live.capacity}`;
      warning.innerHTML="";
    } catch(error) {target.replaceChildren();lastGrid="";warning.innerHTML=notice(error.message,"error");}
    finally{pending=false;}
  }
  app.addEventListener("click",async event=>{
    const action=event.target.closest("[data-screen]")?.dataset.screen;
    if (action==="day"||action==="week") {
      oneDay=action==="day";
      $$("[data-screen=day],[data-screen=week]",app).forEach(node=>node.setAttribute("aria-pressed",String(node.dataset.screen===action)));
      draw();
    }
    if(action==="fullscreen") {
      try{
        if(document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      }catch{warning.innerHTML=notice("Utilise l’option Plein écran de ton navigateur.");}
    }
  });
  clock();
  refresh();
  setInterval(clock,10_000);
  setInterval(refresh,10_000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){clock();refresh();}});
  window.addEventListener("online",refresh);
}

export { names, saveFile, shift, timeLabel, timeNumber, weekStart, button, settingsTime, span };
