// Graphiques SVG sans dépendance pour les statistiques : colonnes, courbe, anneau et barres horizontales.
// Chaque marque porte une infobulle (survol ou focus) ; les couleurs viennent des variables CSS --series-*.
import { e } from "./shared.js";

const fmt=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
const n=value=>fmt.format(value);
const r=value=>Math.round(value*10)/10;

// Graduations lisibles : 0, puis 3 ou 4 paliers ronds.
function ticks(max) {
  if(max<=0) return [0,1];
  const raw=max/4, power=10**Math.floor(Math.log10(raw));
  const step=[1,2,2.5,5,10].map(f=>f*power).find(s=>s>=raw) ?? 10*power;
  const step2=Math.max(step, Number.isInteger(max)?1:step);
  const top=Math.ceil(max/step2)*step2;
  return Array.from({length:Math.round(top/step2)+1},(_,i)=>r(i*step2));
}
// Barre aux extrémités arrondies côté valeur, posée sur la ligne de base.
function column(x,y,w,h,radius=4) {
  const rad=Math.min(radius,w/2,h);
  return `M${r(x)},${r(y+h)}V${r(y+rad)}Q${r(x)},${r(y)} ${r(x+rad)},${r(y)}H${r(x+w-rad)}Q${r(x+w)},${r(y)} ${r(x+w)},${r(y+rad)}V${r(y+h)}Z`;
}

/** Histogramme vertical. rows : [[libellé, valeur, libellé long?]]. */
export function columnChart(rows, {unit="passage(s)", height=220, labelEvery=0, highlightMax=true, width=640}={}) {
  if(!rows.length) return `<p class="hint">Aucune donnée sur la période.</p>`;
  const left=34, right=8, top=12, bottom=26, plotH=height-top-bottom, plotW=width-left-right;
  const max=Math.max(...rows.map(row=>row[1]),0), scale=ticks(max), topValue=scale.at(-1)||1;
  const step=plotW/rows.length, bar=Math.max(2,Math.min(42,step*.68));
  const every=labelEvery || Math.max(1,Math.ceil(rows.length/12));
  const best=highlightMax ? Math.max(...rows.map(row=>row[1])) : Infinity;
  let svg=scale.map(value=>{
    const y=top+plotH-value/topValue*plotH;
    return `<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${r(y)}" y2="${r(y)}"/><text class="chart-axis" x="${left-6}" y="${r(y+4)}" text-anchor="end">${n(value)}</text>`;
  }).join("");
  rows.forEach(([label,value,long],i)=>{
    const h=value/topValue*plotH, x=left+i*step+(step-bar)/2, y=top+plotH-h;
    const tip=`${long??label} : ${n(value)} ${unit}`;
    svg+=`<g class="chart-mark" tabindex="0" data-tip="${e(tip)}"><rect class="chart-hit" x="${r(left+i*step)}" y="${top}" width="${r(step)}" height="${plotH}"/>`
      +(h>0?`<path class="chart-bar${value===best&&value>0?" is-max":""}" d="${column(x,y,bar,h)}"/>`:"")+`</g>`;
    if(i%every===0) svg+=`<text class="chart-axis" x="${r(left+i*step+step/2)}" y="${height-8}" text-anchor="middle">${e(label)}</text>`;
  });
  svg+=`<line class="chart-base" x1="${left}" x2="${width-right}" y1="${top+plotH}" y2="${top+plotH}"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(rows.map(row=>`${row[2]??row[0]} ${row[1]}`).join(", "))}">${svg}</svg><div class="chart-tip" hidden></div></div>`;
}

/** Courbe avec aire (longues périodes). */
export function lineChart(rows, {unit="passage(s)", height=220}={}) {
  if(rows.length<2) return columnChart(rows,{unit,height});
  const width=640, left=34, right=10, top=12, bottom=26, plotH=height-top-bottom, plotW=width-left-right;
  const max=Math.max(...rows.map(row=>row[1]),0), scale=ticks(max), topValue=scale.at(-1)||1;
  const x=i=>left+i*plotW/(rows.length-1), y=v=>top+plotH-v/topValue*plotH;
  const points=rows.map(([,v],i)=>`${r(x(i))},${r(y(v))}`);
  const every=Math.max(1,Math.ceil(rows.length/8));
  let svg=scale.map(value=>`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${r(y(value))}" y2="${r(y(value))}"/><text class="chart-axis" x="${left-6}" y="${r(y(value)+4)}" text-anchor="end">${n(value)}</text>`).join("");
  svg+=`<path class="chart-area" d="M${left},${top+plotH}L${points.join("L")}L${r(x(rows.length-1))},${top+plotH}Z"/><polyline class="chart-line" points="${points.join(" ")}"/>`;
  const slot=plotW/(rows.length-1);
  rows.forEach(([label,value,long],i)=>{
    svg+=`<g class="chart-mark" tabindex="0" data-tip="${e(`${long??label} : ${n(value)} ${unit}`)}"><rect class="chart-hit" x="${r(x(i)-slot/2)}" y="${top}" width="${r(slot)}" height="${plotH}"/><circle class="chart-dot" cx="${r(x(i))}" cy="${r(y(value))}" r="4"/></g>`;
    if(i%every===0||i===rows.length-1) svg+=`<text class="chart-axis" x="${r(x(i))}" y="${height-8}" text-anchor="${i===0?"start":i===rows.length-1?"end":"middle"}">${e(label)}</text>`;
  });
  svg+=`<line class="chart-base" x1="${left}" x2="${width-right}" y1="${top+plotH}" y2="${top+plotH}"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution des passages">${svg}</svg><div class="chart-tip" hidden></div></div>`;
}

/** Anneau + légende chiffrée. Au-delà de 7 parts, les plus petites sont regroupées dans « Autres ». */
export function donutChart(rows, {unit="passage(s)", center="passages"}={}) {
  let list=rows.filter(row=>row[1]>0).sort((a,b)=>b[1]-a[1]);
  if(!list.length) return `<p class="hint">Aucune donnée sur la période.</p>`;
  if(list.length>7) list=[...list.slice(0,6),["Autres",list.slice(6).reduce((t,row)=>t+row[1],0)]];
  const total=list.reduce((t,row)=>t+row[1],0), radius=70, stroke=26, length=2*Math.PI*radius;
  let offset=0, arcs="";
  list.forEach(([label,value],i)=>{
    const part=value/total*length, gap=list.length>1?2:0;
    arcs+=`<circle class="chart-slice series-${i+1}" tabindex="0" data-tip="${e(`${label} : ${n(value)} ${unit} (${n(value/total*100)} %)`)}" r="${radius}" cx="90" cy="90"
      stroke-dasharray="${r(Math.max(0,part-gap))} ${r(length)}" stroke-dashoffset="${r(-offset)}" transform="rotate(-90 90 90)" stroke-width="${stroke}"/>`;
    offset+=part;
  });
  const legend=list.map(([label,value],i)=>`<li><i class="series-${i+1}"></i><span>${e(label)}</span><b>${n(value)}</b><em>${n(value/total*100)} %</em></li>`).join("");
  return `<div class="chart chart-donut"><svg viewBox="0 0 180 180" role="img" aria-label="${e(list.map(row=>`${row[0]} ${row[1]}`).join(", "))}">${arcs}
    <text class="donut-total" x="90" y="92" text-anchor="middle">${n(total)}</text><text class="donut-caption" x="90" y="112" text-anchor="middle">${e(center)}</text></svg>
    <ul class="chart-legend">${legend}</ul><div class="chart-tip" hidden></div></div>`;
}

/** Barres horizontales classées (top N). rows : [[libellé, valeur, détail?]]. */
export function rankChart(rows, {unit="passage(s)", limit=10, suffix=""}={}) {
  const list=rows.slice(0,limit);
  if(!list.length) return `<p class="hint">Aucune donnée sur la période.</p>`;
  const max=Math.max(1,...list.map(row=>row[1]));
  // Barres en <progress> : aucune largeur en style en ligne (politique CSP stricte).
  return `<div class="chart"><ol class="rank-chart">${list.map(([label,value,detail])=>`<li tabindex="0" data-tip="${e(`${label} : ${n(value)} ${unit}${detail?" · "+detail:""}`)}">
    <span class="rank-label">${e(label)}</span><progress max="${max}" value="${value}" aria-hidden="true"></progress><b>${n(value)}${suffix}</b></li>`).join("")}</ol><div class="chart-tip" hidden></div></div>`;
}

// Infobulle partagée : survol à la souris et focus au clavier.
export function bindTips(root) {
  const show=(event)=>{
    const mark=event.target.closest?.("[data-tip]");
    const chart=mark?.closest(".chart");
    const tip=chart?.querySelector(".chart-tip");
    if(!tip) return;
    tip.textContent=mark.dataset.tip;
    tip.hidden=false;
    const box=chart.getBoundingClientRect(), at=mark.getBoundingClientRect();
    tip.style.left=Math.min(Math.max(8,at.left-box.left+at.width/2),box.width-8)+"px";
    tip.style.top=Math.max(0,at.top-box.top)+"px";
  };
  const hide=(event)=>{ const tip=event.target.closest?.(".chart")?.querySelector(".chart-tip"); if(tip) tip.hidden=true; };
  root.addEventListener("pointerover",show);
  root.addEventListener("focusin",show);
  root.addEventListener("pointerout",hide);
  root.addEventListener("focusout",hide);
}
