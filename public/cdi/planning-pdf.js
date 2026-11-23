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

// Rapport de fréquentation (A4 paysage) : synthèse, moments d’affluence, publics et modalités, détail de toutes les classes.
// `views` vient de statsViews() (attendance.js) : moyennes par jour, heures, grille, niveaux, élèves touchés.
export function statsPdf(data, views) {
  const {weekdays,grid,bars,hours,levels,reach,busiestDay,busiestHour}=views;
  const fmt=new Intl.NumberFormat("fr-FR");
  const pct=(part,total)=>total?(Math.round(part/total*1000)/10).toLocaleString("fr-FR")+" %":"—";
  const one=value=>(Math.round(value*10)/10).toLocaleString("fr-FR");
  const fill="0.32 0.33 0.76", track="0.93 0.94 0.98", strong=blue;
  const series=["0.165 0.471 0.839","0.922 0.408 0.204","0.106 0.686 0.478","0.929 0.631 0","0.91 0.482 0.643","0 0.514 0","0.384 0.314 0.839","0.89 0.286 0.282"];
  const period=`Du ${date(data.from)} au ${date(data.to)}`;
  let pageNumber=0;
  const stamp=()=>label(margin,height-16,"TiceCDI · rapport généré le "+new Date().toLocaleDateString("fr-FR"),{size:8,color:muted})
    +label(width-margin-40,height-16,"Page "+(++pageNumber),{size:8,color:muted});
  const title=(x,y,text,sub)=>label(x,y,text,{size:12,bold:true})+(sub?label(x,y+13,sub,{size:8,color:muted}):"");
  // Histogramme vertical avec graduations.
  const columns=(x,y,w,h,rows,{every=0,highlight=true}={})=>{
    if(!rows.length) return label(x,y+20,"Aucune donnée",{size:9,color:muted});
    const max=Math.max(1,...rows.map(row=>row[1])), step=w/rows.length, bar=Math.max(1.2,Math.min(26,step*.68));
    const skip=every||Math.max(1,Math.ceil(rows.length/14));
    let out="";
    [0,.5,1].forEach(f=>{const gy=y+h-h*f;out+=box(x,gy,w,.4,"0.88 0.89 0.94")+label(x-22,gy+3,one(max*f),{size:6.5,color:muted});});
    rows.forEach(([name,value],i)=>{
      const bh=value/max*(h-4), bx=x+i*step+(step-bar)/2;
      if(bh>0) out+=box(bx,y+h-bh,bar,bh,highlight&&value===max?strong:fill);
      if(rows.length<=24&&value) { const t=one(value); out+=label(x+i*step+step/2-t.length*2.1,y+h-bh-3,t,{size:6.5,color:muted}); }
      if(i%skip===0) { const t=String(name); out+=label(x+i*step+step/2-Math.min(t.length,9)*2.1,y+h+11,t.slice(0,9),{size:7,color:muted}); }
    });
    return out;
  };
  // Barres horizontales avec libellé et valeur.
  const ranks=(x,y,w,rows,{gap=17,labelW=96,format=v=>fmt.format(v),max}={})=>{
    const top=max??Math.max(1,...rows.map(row=>row[1]));
    return rows.map(([name,value],i)=>{
      const ry=y+i*gap, bw=w-labelW-50;
      return label(x,ry+9,String(name).slice(0,20),{size:8.5})+box(x+labelW,ry+1,bw,10,track)+box(x+labelW,ry+1,bw*Math.min(1,value/top),10,fill)
        +label(x+labelW+bw+6,ry+9,format(value),{size:8.5,bold:true});
    }).join("");
  };
  // Répartition en barre empilée + légende (équivalent imprimé de l’anneau).
  const shares=(x,y,w,rows)=>{
    const total=rows.reduce((t,row)=>t+row[1],0)||1;
    let out="", at=x;
    rows.forEach(([,value],i)=>{const bw=w*value/total;if(bw>0)out+=box(at,y,Math.max(0,bw-1),14,series[i%series.length]);at+=bw;});
    rows.forEach(([name,value],i)=>{
      const ly=y+30+i*15;
      out+=box(x,ly-7,8,8,series[i%series.length])+label(x+13,ly,String(name).slice(0,28),{size:8.5})
        +label(x+w-78,ly,fmt.format(value),{size:8.5,bold:true})+label(x+w-36,ly,pct(value,total),{size:8.5,color:muted});
    });
    return out;
  };

  // Page 1 : synthèse.
  let page=header("Rapport de fréquentation du CDI",period+" · totaux de l’établissement");
  const cardW=(width-2*margin-36)/4, floor=reach.partial?"*":"";
  const cards=[["Passages",fmt.format(data.visits)],["Élèves différents",fmt.format(reach.students)+floor],
    ["Taux de fréquentation",data.population?pct(reach.students,data.population)+floor:"—"],["Classes venues",fmt.format(data.classes.length)],
    ["Moyenne par jour d’ouverture",one(data.per_day)],["Durée moyenne de présence",Math.round(data.average)+" min"],
    ["Heures cumulées au CDI",fmt.format(Math.round(data.observed_hours))],["Pic de présence simultanée",fmt.format(data.peak)],
    ["Jour le plus fréquenté",busiestDay?.name??"—"],["Heure de pointe",busiestHour?.[2]??"—"],
    ["Venues avec classe ou groupe",pct(data.group_visits,data.visits)],["Sorties avant l’échéance",pct(data.early_exits,data.visits)]];
  cards.forEach(([name,value],i)=>{
    const x=margin+(i%4)*(cardW+12), y=94+Math.floor(i/4)*46;
    page+=box(x,y,cardW,40,"0.94 0.95 0.99")+label(x+10,y+18,value,{size:14,bold:true,color:blue})+label(x+10,y+32,name,{size:8,color:muted});
  });
  const trend=data.previous?.visits?`Période précédente : ${fmt.format(data.previous.visits)} passages (${data.visits>=data.previous.visits?"+":""}${Math.round((data.visits-data.previous.visits)/data.previous.visits*100)} %)`:"Pas de passage sur la période précédente";
  page+=label(margin,248,trend+(data.busiest?` · Journée la plus chargée : ${date(data.busiest.day)} (${fmt.format(data.busiest.visits)})`:"")
    +(data.population?` · ${fmt.format(data.population)} élèves inscrits`:""),{size:9,color:muted});
  const half=width/2-margin-14;
  page+=title(margin,276,bars.title,"Passages archivés compris")+columns(margin+22,300,half-22,220,bars.rows);
  page+=title(width/2+14,276,"Moyenne par jour de la semaine","Passages moyens par jour d’ouverture")
    +columns(width/2+36,300,half-22,220,weekdays.map(row=>[row.name.slice(0,3)+".",Math.round(row.average*10)/10]),{every:1});
  if(reach.partial) page+=label(margin,height-30,"* Minimum : les jours archivés ne conservent que le nombre d’élèves par jour, sans identité.",{size:7.5,color:muted});
  const pages=[page+stamp()];

  // Page 2 : moments de fréquentation.
  if(grid) {
    let heat=header("Moments de fréquentation",period+" · arrivées selon le jour et l’heure");
    const extra=grid.hasUnknown?70:0;
    const left=margin+80, cellW=Math.min(46,(width-left-margin-60-extra)/Math.max(1,grid.slots.length)), cellH=grid.days.length>5?26:30, top=108;
    const tail=left+grid.slots.length*cellW+12;
    const names=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
    grid.slots.forEach((hour,i)=>{heat+=label(left+i*cellW+cellW/2-8,top,hour+"h",{size:8.5,bold:true,color:muted});});
    if(grid.hasUnknown) heat+=label(tail,top,"Sans heure",{size:8.5,bold:true,color:muted});
    heat+=label(tail+extra,top,"Total",{size:8.5,bold:true,color:muted});
    grid.days.forEach((weekday,row)=>{
      const y=top+8+row*cellH;
      heat+=label(margin,y+cellH/2+4,names[weekday-1],{size:10,bold:true});
      grid.slots.forEach((hour,i)=>{
        const value=grid.value(weekday,hour), ratio=value/grid.max;
        const mix=[[.94,.29],[.95,.32],[1,.81]].map(([a,b])=>(a+(b-a)*ratio).toFixed(3)).join(" ");
        heat+=box(left+i*cellW+1,y+1,cellW-2,cellH-2,value?mix:"0.97 0.97 0.99");
        const text=value?String(value):"";
        if(text) heat+=label(left+i*cellW+cellW/2-text.length*2.6,y+cellH/2+4,text,{size:9,bold:ratio>.5,color:ratio>.55?"1 1 1":ink});
      });
      if(grid.hasUnknown && grid.unknown(weekday)) heat+=label(tail+14,y+cellH/2+4,String(grid.unknown(weekday)),{size:9.5,color:muted});
      heat+=label(tail+extra,y+cellH/2+4,String(grid.total(weekday)),{size:9.5,bold:true});
    });
    if(grid.hasUnknown) heat+=label(margin,top+20+grid.days.length*cellH,"« Sans heure » : jours purgés avant la mise à jour v1.12, dont seul le total a été gardé.",{size:7.5,color:muted});
    const below=top+16+grid.days.length*cellH+(grid.hasUnknown?40:24);
    heat+=title(margin,below,"Arrivées par heure","Tous jours confondus")+columns(margin+22,below+22,width-2*margin-22,height-below-80,hours,{every:1});
    pages.push(heat+stamp());
  }

  // Page 3 : publics et modalités de venue.
  let who=header("Publics et modalités de venue",period);
  const colW=(width-2*margin-40)/3;
  who+=title(margin,108,"Passages par niveau")+shares(margin,124,colW,levels.map(row=>[row.name,row.visits]));
  who+=title(margin+colW+20,108,"Taux de venue par niveau","Élèves venus / inscrits")
    +ranks(margin+colW+20,132,colW,levels.filter(row=>row.size).slice(0,12).map(row=>[row.name,Math.round(row.students/row.size*1000)/10]),{labelW:70,format:v=>v.toLocaleString("fr-FR")+" %",max:100});
  who+=title(margin+2*(colW+20),108,"Classes les plus présentes","Passages")
    +ranks(margin+2*(colW+20),132,colW,data.classes.slice(0,12).map(row=>[row.name,row.visits]),{labelW:80});
  const sources={individuel:"Individuelle (borne)",classe:"Avec la classe",groupe:"Avec un groupe"};
  const lowY=356;
  who+=title(margin,lowY,"Type de venue")+shares(margin,lowY+16,colW,data.sources.map(row=>[sources[row.source]??row.source,row.visits]));
  who+=title(margin+colW+20,lowY,"Durée de présence","Passages")+ranks(margin+colW+20,lowY+24,colW,data.durations.map(row=>[row.label,row.count]),{labelW:80});
  who+=title(margin+2*(colW+20),lowY,"Assiduité des élèves","Élèves (passages conservés)")+ranks(margin+2*(colW+20),lowY+24,colW,data.frequency.map(row=>[row.label,row.count]),{labelW:96});
  pages.push(who+stamp());

  // Pages suivantes : toutes les classes, sans troncature.
  const cols=[["Classe",0],["Niveau",150],["Passages",235],["Part",305],["Élèves venus",365],["Effectif",450],["Taux de venue",515],["Passages / élève",600],["Avec classe ou groupe",690]];
  const perPage=Math.floor((height-150)/15);
  for(let start=0;start<Math.max(1,data.classes.length);start+=perPage) {
    let detail=header("Détail par classe",`${period} · ${fmt.format(data.classes.length)} classe(s)`+(start?` · suite`:""));
    let y=112;
    cols.forEach(([name,x])=>{detail+=label(margin+x,y,name,{size:8.5,bold:true,color:muted});});
    data.classes.slice(start,start+perPage).forEach((row,i)=>{
      const ry=y+16+i*15, f=row.partial?"*":"";
      if(i%2===0) detail+=box(margin-4,ry-10,width-2*margin+8,15,"0.96 0.97 0.99");
      [row.name,views.levelOf(row.name),fmt.format(row.visits),pct(row.visits,data.visits),fmt.format(row.students)+f,row.size?fmt.format(row.size):"—",
        row.size?pct(row.students,row.size)+f:"—",row.students?one(row.visits/row.students):"—",fmt.format(row.group_visits)]
        .forEach((text,c)=>{detail+=label(margin+cols[c][1],ry,String(text).slice(0,24),{size:9,bold:c===0});});
    });
    if(!data.classes.length) detail+=label(margin,140,"Aucune classe sur la période.",{size:10,color:muted});
    if(views.unattributed) detail+=label(margin,height-42,`${fmt.format(views.unattributed)} passage(s) de jours purgés avant la v1.12 ne sont comptés que dans les totaux (classe non conservée).`,{size:7.5,color:muted});
    if(data.classes.some(row=>row.partial)) detail+=label(margin,height-32,"* Minimum : les jours archivés ne conservent que le nombre d’élèves par jour ; le total réel peut être supérieur.",{size:7.5,color:muted});
    pages.push(detail+stamp());
  }
  return makePdf(pages);
}
