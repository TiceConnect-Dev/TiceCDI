const width=841.89, height=595.28;
const ink="0.10 0.12 0.24", blue="0 0 0.56", muted="0.33 0.36 0.45";
const palette={
  cours:["0.92 0.93 1","0.26 0.31 0.73"],
  atelier:["0.80 0.92 0.86","0.16 0.47 0.34"],
  reservation:["1 0.95 0.86","0.55 0.35 0.10"],
  fermeture:["1 0.92 0.92","0.62 0.20 0.23"],
  autre:["0.94 0.94 0.97","0.38 0.38 0.49"],
};
const cp1252={"€":128,"…":133,"‘":145,"’":146,"“":147,"”":148,"•":149,"–":150,"—":151,"Œ":140,"œ":156,"Ÿ":159};
function literal(text) {
  const bytes=[...String(text)].map(char=>{
    const code=cp1252[char]??char.codePointAt(0);
    return (code>=32&&code<=126 || code>=128&&code<=255 ? code:63).toString(16).padStart(2,"0");
  });
  return "<"+bytes.join("")+">";
}
const num=value=>Number(value.toFixed(2));
function label(x,y,text,{size=10,bold=false,color=ink}={}) {
  return `${color} rg BT /${bold?"F2":"F1"} ${size} Tf 1 0 0 1 ${num(x)} ${num(height-y)} Tm ${literal(text)} Tj ET\n`;
}
function box(x,y,w,h,color) {
  return `${color} rg ${num(x)} ${num(height-y-h)} ${num(w)} ${num(h)} re f\n`;
}
const time=n=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
const span=row=>time(row.start_min)+"–"+time(row.end_min);
const date=iso=>iso.split("-").reverse().join("/");
function wrap(text,lineWidth,size) {
  const output=[];
  let line="", used=0;
  for(const word of String(text).split(/\s+/)) {
    for(const [index,char] of [...word].entries()) {
      if(index===0 && line) {
        const weight=[...word].reduce((total,letter)=>total+charWidth(letter),0)*size;
        if(used+size*.32+weight>lineWidth){output.push(line);line="";used=0;}
        else{line+=" ";used+=size*.32;}
      }
      const cost=charWidth(char)*size;
      if(used+cost>lineWidth&&line){output.push(line);line="";used=0;}
      line+=char;
      used+=cost;
    }
  }
  if(line) output.push(line);
  return output;
}
function charWidth(char) {
  if(/[ilI1.,:'!|]/.test(char)) return .31;
  if(/[mMW@%Œœ]/.test(char)) return .92;
  if(/[A-ZÀ-ÖØ-Þ]/.test(char)) return .76;
  return .62;
}
function makePdf(pages) {
  const font=(name)=>`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    font("Helvetica"),font("Helvetica-Bold"),
  ];
  pages.forEach((stream,i)=>{
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6+i*2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  });
  let pdf="%PDF-1.4\n";
  const offsets=objects.map((source,i)=> {
    const offset=pdf.length;
    pdf+=`${i+1} 0 obj\n${source}\nendobj\n`;
    return offset;
  });
  const table=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(at=>String(at).padStart(10,"0")+" 00000 n \n").join("")
    +`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const margin=24;
const gridTop=121;
const maxGridHeight=421;
const hourGutter=41;
const shade="0.88 0.90 0.94";
const accessColors={
  open:["Ouvert","0.94 0.98 0.95","0.13 0.38 0.26"],
  closed:["Fermé","0.94 0.95 0.97","0.30 0.34 0.43"],
  unknown:["Horaires à définir","0.98 0.98 0.99",muted],
};

export function timelineBounds(data, days) {
  const events=data.rows.filter(row=>days.some(item=>item.date===row.day));
  const hours=data.hours.filter(row=>days.some(item=>item.weekday===row.weekday));
  const rows=[...hours,...events];
  const first=Math.max(0,Math.floor(Math.min(480,...rows.map(row=>row.start_min))/60)*60);
  const last=Math.min(1440,Math.ceil(Math.max(1080,...rows.map(row=>row.end_min))/60)*60);
  return { first,last };
}

export function timelineForDay(data,item,first,last) {
  const events=data.rows.filter(row=>row.day===item.date);
  const windows=data.hours.filter(row=>row.weekday===item.weekday);
  const hasSchedule=data.use_hours || data.hours.length>0;
  const points=[...new Set([first,last,...[...windows,...events].flatMap(row=>[row.start_min,row.end_min])
    .filter(minute=>minute>first && minute<last)])].sort((a,b)=>a-b);
  const bands=[];
  for (let i=1;i<points.length;i++) {
    const start_min=points[i-1], end_min=points[i];
    const covers=row=>row.start_min<=start_min && row.end_min>=end_min;
    const event=events.find(covers);
    const state=event ? null : windows.some(covers) ? "open" : hasSchedule ? "closed" : "unknown";
    const previous=bands.at(-1);
    if(previous && previous.event===event && previous.state===state) previous.end_min=end_min;
    else bands.push({start_min,end_min,event,state});
  }
  return bands;
}

function header(heading,subtitle) {
  return box(0,0,width,83,blue)
    +label(margin,20,"CITÉ SCOLAIRE CAMILLE CLAUDEL · FOURMIES",{size:9,bold:true,color:"0.93 0.93 1"})
    +label(margin,48,heading,{size:24,bold:true,color:"1 1 1"})
    +label(margin,69,subtitle,{size:11,color:"0.96 0.96 1"});
}

function footer(page,kinds,hasDetails,unknown) {
  const legend=[["Ouvert",accessColors.open[2]],["Fermé",accessColors.closed[2]],
    ...(unknown?[["Horaires à définir",accessColors.unknown[2]]]:[]),
    ...Object.entries(kinds).map(([key,name])=>[key==="fermeture"?"Fermeture exceptionnelle":name,(palette[key]??palette.autre)[1]])];
  let x=margin;
  let content="";
  for (const [name,color] of legend) {
    content+=box(x,height-29,7,7,color)+label(x+11,height-22,name,{size:8,color:muted});
    x+=name.length*4.55+24;
  }
  content+=label(margin,height-10,hasDetails
    ?"Les créneaux trop courts pour porter un libellé complet sont repris dans le détail."
    :"Horaires prévus et fermetures exceptionnelles inscrites au planning.",{size:7.5,color:muted});
  return content+label(width-72,height-22,"Page "+page,{size:8,color:muted});
}

function drawBand(row,x,y,w,h) {
  const event=row.event;
  const exceptional=event?.kind==="fermeture";
  const [status,fill,accent]=event
    ? ["",...(palette[event.kind]??palette.autre)] : accessColors[row.state];
  const inset=h>=10?0.8:0.2;
  const bottom=y+h-0.7;
  const spacious=w>300 && h>=29;
  const size=spacious?10.5:8.5;
  const secondary=spacious?8:7;
  let content=box(x+1,y+inset,w-2,Math.max(0.7,h-inset*2),fill)
    +box(x+1,y+inset,2,Math.max(0.7,h-inset*2),accent);
  const title=event ? (exceptional ? "Fermé · "+event.title : event.title) : status;
  const subtitle=event ? span(event)+(event.class_name?" · "+event.class_name:"") : span(row);
  const lines=wrap(title,w-12,size);
  const subtitleLines=wrap(subtitle,w-12,secondary);
  let current=y+size+1.5;
  const writeLines=(values,style,step)=>{
    let rendered=0;
    for(const line of values) {
      if(current>bottom-0.8) break;
      content+=label(x+7,current,line,style);
      current+=step;
      rendered++;
    }
    return rendered;
  };
  const titleFit=writeLines(lines,{size,bold:true,color:accent},size+1);
  const subtitleFit=writeLines(subtitleLines,{size:secondary,color:muted},secondary+1);
  return {content,complete:titleFit===lines.length && subtitleFit===subtitleLines.length,title,subtitle};
}

function detailPages(entries, firstPage) {
  const pages=[];
  let content="";
  let y=0;
  function begin() {
    content=header("Détail des créneaux","Libellés et horaires des cases compactes de la grille.");
    y=108;
  }
  function end() {
    pages.push(content+label(width-72,height-22,"Page "+(firstPage+pages.length),{size:8,color:muted}));
  }
  begin();
  entries.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start).forEach((row,i)=>{
    const lines=wrap(row.title,width-2*margin-212,9);
    const cardHeight=25+12*(lines.length-1)+(row.group?11:0);
    if(y+cardHeight>height-38) {end();begin();}
    content+=box(margin,y,width-2*margin,cardHeight,i%2===0?"0.94 0.95 0.98":"0.98 0.98 0.99")
      +label(margin+8,y+15,row.day+" "+date(row.date),{size:9,bold:true})
      +label(margin+120,y+15,row.time,{size:9,bold:true,color:row.color});
    lines.forEach((line,index)=>{content+=label(margin+210,y+15+12*index,line,{size:9,bold:true});});
    if(row.group) content+=label(margin+210,y+15+12*lines.length,row.group,{size:8,color:muted});
    y+=cardHeight+3;
  });
  end();
  return pages;
}

export function weekPdf(data,days,kinds) {
  const {first,last}=timelineBounds(data,days);
  const timeBlocks=Math.ceil((last-first)/600);
  const blockDuration=60*Math.ceil((last-first)/60/timeBlocks);
  const scale=maxGridHeight/blockDuration;
  const columns=days.map(day=>timelineForDay(data,day,first,last));
  const columnWidth=(width-margin*2-hourGutter)/days.length;
  const detail=new Map();
  const panels=[];
  const subtitle=days.length===1
    ? days[0].name+" "+date(days[0].date)+" · Heure de Paris"
    : "Du "+date(days[0].date)+" au "+date(days.at(-1).date)+" · Heure de Paris";
  for(let from=first;from<last;from+=blockDuration) {
    const until=Math.min(last,from+blockDuration);
    const gridHeight=(until-from)*scale;
    let stream=header("Planning du CDI",subtitle+(timeBlocks>1?" · "+span({start_min:from,end_min:until}):""));
    stream+=box(margin,93,width-2*margin,27,"0.93 0.94 0.98")
      +label(margin+5,110,"Heure",{size:8,bold:true,color:muted});
    days.forEach((item,i)=>{
      const x=margin+hourGutter+i*columnWidth;
      stream+=label(x+6,110,item.name+" "+date(item.date).slice(0,5),{size:9,bold:true});
    });
    for(let minute=from;minute<=until;minute+=30) {
      const y=gridTop+(minute-from)*scale;
      stream+=box(margin+hourGutter,y,width-2*margin-hourGutter,minute%60===0?0.55:0.25,shade);
      if (minute%60===0) {
        const baseline=minute===from?y+9:minute===until?y-2:y+3;
        stream+=label(margin+5,baseline,time(minute),{size:8,color:muted});
      }
    }
    days.forEach((item,i)=>{
      const x=margin+hourGutter+i*columnWidth;
      stream+=box(x,93,0.45,28+gridHeight,shade);
      columns[i].forEach(row=>{
        const start=Math.max(row.start_min,from);
        const end=Math.min(row.end_min,until);
        if(start>=end) return;
        const y=gridTop+(start-from)*scale;
        const {content,complete,title}=drawBand(row,x,y,columnWidth,(end-start)*scale);
        stream+=content;
        if(!complete) {
          const key=item.date+":"+row.start_min+":"+row.end_min;
          const event=row.event;
          const color=event ? (palette[event.kind]??palette.autre)[1] : accessColors[row.state][2];
          detail.set(key,{ day:item.name,date:item.date,start:row.start_min,time:span(event??row),title,group:event?.class_name,color });
        }
      });
    });
    stream+=box(width-margin-0.45,93,0.45,28+gridHeight,shade);
    panels.push(stream);
  }
  const entries=[...detail.values()];
  const unknown=columns.some(rows=>rows.some(row=>row.state==="unknown"));
  const pages=panels.map((panel,i)=>panel+footer(i+1,kinds,entries.length>0,unknown));
  if(entries.length) pages.push(...detailPages(entries,pages.length+1));
  return makePdf(pages);
}

// Rapport de fréquentation (A4 paysage) : totaux, passages par jour, moyenne par jour de semaine et affluence jour × heure.
export function statsPdf(data, weekdays, grid, bars) {
  const fmt=new Intl.NumberFormat("fr-FR");
  const pct=(part,total)=>total?(Math.round(part/total*1000)/10).toLocaleString("fr-FR")+" %":"—";
  const one=value=>(Math.round(value*10)/10).toLocaleString("fr-FR");
  const stamp=label(margin,height-18,"TiceCDI · rapport généré le "+new Date().toLocaleDateString("fr-FR"),{size:8,color:muted});
  let page=header("Rapport de fréquentation du CDI",`Du ${date(data.from)} au ${date(data.to)} · toutes les valeurs sont détaillées`);
  const cardW=(width-2*margin-36)/4;
  const cards=[["Passages",fmt.format(data.visits)],["Élèves différents",fmt.format(data.students)],["Moyenne par jour d’ouverture",one(data.per_day)],
    ["Durée moyenne de présence",Math.round(data.average)+" min"],["Heures cumulées au CDI",fmt.format(Math.round(data.observed_hours))],
    ["Pic de présence simultanée",fmt.format(data.peak)],["Venues avec classe ou groupe",pct(data.group_visits,data.visits)],["Sorties avant l’échéance",pct(data.early_exits,data.visits)]];
  cards.forEach(([title,value],i)=>{
    const x=margin+(i%4)*(cardW+12), y=96+Math.floor(i/4)*56;
    page+=box(x,y,cardW,48,"0.94 0.95 0.99")+label(x+10,y+20,value,{size:16,bold:true,color:blue})+label(x+10,y+38,title,{size:8.5,color:muted});
  });
  const trend=data.previous?.visits?`Période précédente : ${fmt.format(data.previous.visits)} passages (${data.visits>=data.previous.visits?"+":""}${Math.round((data.visits-data.previous.visits)/data.previous.visits*100)} %)`:"Pas de passage sur la période précédente";
  page+=label(margin,222,trend+(data.busiest?` · Journée la plus chargée : ${date(data.busiest.day)} (${fmt.format(data.busiest.visits)})`:""),{size:9.5,color:muted});
  // Passages par jour (ou par semaine sur une longue période), en barres verticales.
  const chartX=margin, chartY=246, chartW=width/2-margin-12, chartH=250;
  page+=label(chartX,chartY,bars.title,{size:12,bold:true});
  if(bars.rows.length) {
    const max=Math.max(1,...bars.rows.map(([,v])=>v));
    const step=chartW/bars.rows.length, bar=Math.max(1,Math.min(18,step*.7));
    page+=box(chartX,chartY+12+chartH,chartW,.6,"0.75 0.77 0.85");
    bars.rows.forEach(([,v],i)=>{
      const h=v/max*(chartH-14);
      page+=box(chartX+i*step+(step-bar)/2,chartY+12+chartH-h,bar,h,"0.32 0.33 0.76");
      if(bars.rows.length<=31&&v) page+=label(chartX+i*step+step/2-String(v).length*2.3,chartY+8+chartH-h,String(v),{size:7,color:muted});
    });
    page+=label(chartX,chartY+chartH+28,bars.rows[0][0],{size:8,color:muted})
      +label(chartX+chartW-60,chartY+chartH+28,bars.rows.at(-1)[0],{size:8,color:muted});
  }
  const sideX=width/2+12;
  page+=label(sideX,chartY,"Moyenne par jour de la semaine",{size:12,bold:true});
  const best=Math.max(1,...weekdays.map(row=>row.average));
  weekdays.forEach((row,i)=>{
    const y=chartY+18+i*26, w=(width-sideX-margin-130)*row.average/best;
    page+=label(sideX,y+12,row.name,{size:10})+box(sideX+80,y+2,width-sideX-margin-130,13,"0.93 0.94 0.98")+box(sideX+80,y+2,w,13,"0.32 0.33 0.76")
      +label(width-margin-44,y+12,one(row.average),{size:10,bold:true});
  });
  const pages=[page+stamp];
  if(grid) {
    let heat=header("Affluence par jour et par heure",`Du ${date(data.from)} au ${date(data.to)} · passages conservés, selon l’heure d’arrivée`);
    const left=margin+80, cellW=Math.min(48,(width-left-margin)/grid.slots.length), cellH=34, top=112;
    const names=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
    grid.slots.forEach((hour,i)=>{heat+=label(left+i*cellW+cellW/2-8,top,hour+"h",{size:9,bold:true,color:muted});});
    grid.days.forEach((weekday,row)=>{
      const y=top+10+row*cellH;
      heat+=label(margin,y+cellH/2+4,names[weekday-1],{size:10,bold:true});
      grid.slots.forEach((hour,i)=>{
        const value=grid.value(weekday,hour);
        const ratio=value/grid.max;
        const mix=[[.94,.29],[.95,.32],[1,.81]].map(([a,b])=>(a+(b-a)*ratio).toFixed(3)).join(" ");
        heat+=box(left+i*cellW+1,y+1,cellW-2,cellH-2,value?mix:"0.97 0.97 0.99");
        const text=value?String(value):"";
        if(text) heat+=label(left+i*cellW+cellW/2-text.length*2.6,y+cellH/2+4,text,{size:9,bold:ratio>.5,color:ratio>.55?"1 1 1":ink});
      });
    });
    pages.push(heat+stamp);
  }
  // Détail : classes, durées, assiduité, type de venue.
  let detail=header("Détail de la fréquentation",`Du ${date(data.from)} au ${date(data.to)} · passages conservés de la période`);
  const cols=[["Classe",0],["Passages",130],["Élèves venus",200],["Effectif",280],["Taux de venue",345],["Passages / élève",430]];
  let y=108;
  detail+=label(margin,y,"Fréquentation par classe",{size:12,bold:true});
  y+=18;
  cols.forEach(([title,x])=>{detail+=label(margin+x,y,title,{size:8.5,bold:true,color:muted});});
  const rows=data.classes.slice(0,Math.max(0,Math.floor((height-y-40)/15)));
  rows.forEach((row,i)=>{
    const ry=y+15+i*15;
    if(i%2===0) detail+=box(margin-4,ry-10,536,15,"0.96 0.97 0.99");
    [row.name,fmt.format(row.visits),fmt.format(row.students),row.size?fmt.format(row.size):"—",row.size?pct(row.students,row.size):"—",one(row.visits/row.students)]
      .forEach((text,c)=>{detail+=label(margin+cols[c][1],ry,String(text).slice(0,22),{size:9,bold:c===0});});
  });
  if(data.classes.length>rows.length) detail+=label(margin,y+15+rows.length*15,`… ${data.classes.length-rows.length} autre(s) classe(s) dans l’export CSV`,{size:8,color:muted});
  const blockX=margin+560, blockW=width-blockX-margin;
  let by=108;
  const sources={individuel:"Individuelle (borne)",classe:"Avec la classe",groupe:"Avec un groupe"};
  for(const [title,list] of [["Durée de présence",data.durations.map(r=>[r.label,r.count])],["Assiduité (élèves)",data.frequency.map(r=>[r.label,r.count])],
    ["Type de venue",data.sources.map(r=>[sources[r.source]??r.source,r.visits])]]) {
    detail+=label(blockX,by,title,{size:12,bold:true});
    const top=Math.max(1,...list.map(([,v])=>v));
    list.forEach(([name,v],i)=>{
      const ry=by+14+i*19;
      detail+=label(blockX,ry+10,name,{size:8.5})+box(blockX+95,ry+1,blockW-135,11,"0.93 0.94 0.98")+box(blockX+95,ry+1,(blockW-135)*v/top,11,"0.32 0.33 0.76")
        +label(width-margin-32,ry+10,fmt.format(v),{size:9,bold:true});
    });
    by+=26+list.length*19;
  }
  pages.push(detail+stamp);
  return makePdf(pages);
}
