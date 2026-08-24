"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";

type IconName = "home"|"check"|"calendar"|"wallet"|"user"|"plane"|"receipt"|"pin"|"arrow"|"bell"|"users"|"sparkle"|"upload"|"close"|"camera"|"hotel"|"map"|"cloud"|"download"|"shield"|"plus"|"edit"|"archive"|"trash"|"restore"|"search";
type ModalType = "ticket"|"receipt"|"trip"|"itinerary"|null;
type TripState = "active"|"archived"|"deleted";
type Screen = "首頁"|"旅程"|"準備"|"行程"|"記帳"|"設定";
type CloudState = "local"|"connecting"|"synced"|"error";

type ItineraryItem = {id:string;date:string;time:string;title:string;note:string;type:string;color:"blue"|"coral"|"gold"};
type Requirement = {id:string;title:string;note:string;done:boolean;urgent:boolean};
type Trip = {id:string;name:string;destination:string;startDate:string;endDate:string;origin:string;destinationAirport:string;companions:number;budget:number;state:TripState;createdAt:string;deletedAt?:string;itinerary?:ItineraryItem[];requirements?:Requirement[]};
type TripRow = {id:string;name:string;destination_city:string|null;start_date:string|null;end_date:string|null;status:string;notes:string|null;created_at:string;deleted_at:string|null};

const TRIPS_KEY="triplog.trips.v1";
const ACTIVE_TRIP_KEY="triplog.activeTrip.v1";
const defaultTrip:Trip={id:"tokyo-2026",name:"2026 東京之旅",destination:"東京",startDate:"2026-10-12",endDate:"2026-10-18",origin:"HKG",destinationAirport:"HND",companions:3,budget:20000,state:"active",createdAt:"2026-08-24T00:00:00.000Z",itinerary:[],requirements:[]};

function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
function tripMetadata(trip:Trip){return JSON.stringify({triplog:{origin:trip.origin,destinationAirport:trip.destinationAirport,companions:trip.companions,budget:trip.budget,itinerary:trip.itinerary??[],requirements:trip.requirements}})}
function tripFromRow(row:TripRow):Trip{
  let meta:{triplog?:Partial<Pick<Trip,"origin"|"destinationAirport"|"companions"|"budget"|"itinerary"|"requirements">>}={};
  try{meta=row.notes?JSON.parse(row.notes):{}}catch{/* 舊文字備註不影響旅程載入 */}
  const stored=meta.triplog??{};
  return {id:row.id,name:row.name,destination:row.destination_city??"未設定",startDate:row.start_date??new Date().toISOString().slice(0,10),endDate:row.end_date??row.start_date??new Date().toISOString().slice(0,10),origin:stored.origin??"HKG",destinationAirport:stored.destinationAirport??"---",companions:Number(stored.companions??1),budget:Number(stored.budget??0),state:row.deleted_at?"deleted":row.status==="archived"?"archived":"active",createdAt:row.created_at,deletedAt:row.deleted_at??undefined,itinerary:Array.isArray(stored.itinerary)?stored.itinerary:[],requirements:Array.isArray(stored.requirements)?stored.requirements:undefined};
}
function tripToRow(trip:Trip,ownerId:string){return {id:trip.id,owner_id:ownerId,name:trip.name,destination_city:trip.destination,start_date:trip.startDate,end_date:trip.endDate,status:trip.state==="archived"?"archived":"planning",source:"manual",notes:tripMetadata(trip),deleted_at:trip.state==="deleted"?(trip.deletedAt??new Date().toISOString()):null}}

function Icon({name,size=22}:{name:IconName;size?:number}){
  const p:Record<IconName,React.ReactNode>={
    home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,check:<path d="M5 12.5 9.2 17 19 7"/>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></>,wallet:<><path d="M4 6.5h14a2 2 0 0 1 2 2V19H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h12"/><path d="M15 12h7v4h-7a2 2 0 0 1 0-4Z"/></>,user:<><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,plane:<><path d="m3 11 18-7-7 18-3-7-8-4Z"/><path d="m11 15 4-4"/></>,receipt:<><path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2-3-2Z"/><path d="M9 9h6M9 13h5"/></>,pin:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="M5 12h14M14 7l5 5-5 5"/></>,bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></>,users:<><circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 5"/></>,sparkle:<><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3ZM5 14l.7 2.3L8 17.5l-2.3 1.2L5 21l-.7-2.3L2 17.5l2.3-1.2L5 14Z"/></>,upload:<><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v5h16v-5"/></>,close:<><path d="m6 6 12 12M18 6 6 18"/></>,camera:<><path d="M4 7h3l2-3h6l2 3h3v13H4V7Z"/><circle cx="12" cy="13" r="4"/></>,hotel:<><path d="M4 21V5h10v16M14 10h6v11M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1M2 21h20"/></>,map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,cloud:<><path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.3-2A5 5 0 0 0 7 18Z"/></>,download:<><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></>,shield:<><path d="M12 3 20 6v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,plus:<><path d="M12 5v14M5 12h14"/></>,edit:<><path d="m4 20 4-.8L19 8.3 15.7 5 4.8 15.9 4 20ZM14.5 6.2l3.3 3.3"/></>,archive:<><path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/></>,trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,restore:<><path d="M4 9V4h5"/><path d="M5.5 5.5A8 8 0 1 1 4 14"/></>,search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>};
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>;
}

function Brand(){return <div className="brand-lockup"><div className="app-mark" aria-label="旅記 TripLog 圖示"><span className="case-handle"/><span className="case-body"><span className="case-tag"/></span><span className="mark-pin"><span/></span></div><div><p className="eyebrow">旅記</p><h1>TripLog</h1></div></div>}
function Timeline({items,onDelete}:{items:ItineraryItem[];onDelete?:(id:string)=>void}){if(!items.length)return <div className="empty-itinerary"><Icon name="calendar"/><strong>尚未加入行程</strong><p>按右上角＋加入第一個安排。</p></div>;return <div className="timeline">{items.map(i=><article className="timeline-item" key={i.id}><time>{i.time}</time><span className={`timeline-dot ${i.color}`}/><div><span className={`type-tag ${i.color}`}>{i.type}</span><h4>{i.title}</h4>{i.note&&<p>{i.note}</p>}</div>{onDelete&&<button className="timeline-delete" aria-label={`刪除 ${i.title}`} onClick={()=>onDelete(i.id)}><Icon name="trash" size={15}/></button>}</article>)}</div>}
function dateLabel(value:string){const d=new Date(`${value}T00:00:00`);return `${d.getMonth()+1}月${d.getDate()}日`}
function tripDuration(trip:Trip){return Math.max(1,Math.round((new Date(trip.endDate).getTime()-new Date(trip.startDate).getTime())/86400000)+1)}
function countdown(trip:Trip){return Math.max(0,Math.ceil((new Date(`${trip.startDate}T00:00:00`).getTime()-Date.now())/86400000))}
function tripDates(trip:Trip){const dates:string[]=[];const cursor=new Date(`${trip.startDate}T00:00:00`);const end=new Date(`${trip.endDate}T00:00:00`);while(cursor<=end&&dates.length<62){dates.push(cursor.toISOString().slice(0,10));cursor.setDate(cursor.getDate()+1)}return dates}
function weekdayLabel(value:string){return new Intl.DateTimeFormat("zh-HK",{weekday:"short"}).format(new Date(`${value}T00:00:00`)).replace("星期","")}
function requirementTemplates(destination:string):Requirement[]{
  const place=destination.toLowerCase();
  const japan=/日本|東京|大阪|京都|福岡|札幌|沖繩|名古屋|神戶|奈良|北海道|tokyo|osaka|kyoto|fukuoka|sapporo|okinawa|nagoya|kobe|nara/.test(place);
  const korea=/韓國|南韓|首爾|釜山|濟州|seoul|busan|jeju|korea/.test(place);
  const entry:Requirement[]=japan?[
    {id:"jp-entry",title:"核實日本最新入境要求",note:"目前未連接即時官方資料；出發前必須再次核實入境限制。",done:false,urgent:true},
    {id:"visit-japan",title:"填寫 Visit Japan Web",note:"準備航班、第一晚酒店地址、郵遞區號及電話。",done:false,urgent:true},
  ]:korea?[
    {id:"kr-entry",title:"核實韓國最新入境要求",note:"目前未連接即時官方資料；請於出發前再次核實入境及申報安排。",done:false,urgent:true},
  ]:[
    {id:"entry",title:`核實${destination}最新入境要求`,note:"目前未連接即時官方資料；請於出發前再次核實。",done:false,urgent:true},
  ];
  return [...entry,
    {id:"passport",title:"檢查護照有效期",note:"確認護照有效期及空白頁符合目的地要求。",done:false,urgent:false},
    {id:"flight-hotel",title:"確認機票及酒店資料",note:"核對姓名、日期、航班及住宿地址。",done:false,urgent:false},
    {id:"insurance",title:"購買旅遊保險",note:"按行程活動及同行人士需要選擇保障。",done:false,urgent:false},
  ];
}

function TripManager({trips,activeTripId,cloudState,isSignedIn,onSelect,onAdd,onArchive,onDelete,onRestore}:{trips:Trip[];activeTripId:string;cloudState:CloudState;isSignedIn:boolean;onSelect:(id:string)=>void;onAdd:()=>void;onArchive:(id:string)=>void;onDelete:(id:string)=>void;onRestore:(id:string)=>void}){
  const [tab,setTab]=useState<TripState>("active");
  const [query,setQuery]=useState("");
  const shown=trips.filter(t=>t.state===tab&&`${t.name} ${t.destination} ${t.origin} ${t.destinationAirport}`.toLowerCase().includes(query.toLowerCase()));
  const labels:Record<TripState,string>={active:"進行中",archived:"已封存",deleted:"最近刪除"};
  return <section className="screen-content trip-manager"><div className="page-title"><div><p>所有資料保留在旅程內</p><h2>我的旅程</h2></div><button className="round-add" onClick={onAdd} aria-label="新增旅程"><Icon name="plus"/></button></div>
    <div className={`local-mode ${cloudState==="synced"?"cloud-connected":""}`}><Icon name="cloud" size={17}/><span><strong>{cloudState==="synced"?"已安全同步至雲端":cloudState==="connecting"?"正在同步旅程":cloudState==="error"?"雲端暫時連接失敗":"目前儲存在此裝置"}</strong><small>{isSignedIn?"裝置仍保留離線副本，恢復連線後會同步":"到「設定」登入即可啟用 Supabase 同步"}</small></span></div>
    <label className="trip-search"><Icon name="search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋旅程、城市或機場"/></label>
    <div className="trip-tabs">{(["active","archived","deleted"] as TripState[]).map(s=><button key={s} className={tab===s?"selected":""} onClick={()=>setTab(s)}>{labels[s]} <span>{trips.filter(t=>t.state===s).length}</span></button>)}</div>
    <div className="trip-list">{shown.map(t=><article key={t.id} className={`saved-trip ${t.id===activeTripId?"current":""}`}><div className="saved-trip-main"><span className="saved-trip-pin"><Icon name="pin" size={18}/></span><div><span>{t.destination} · {tripDuration(t)}日</span><h3>{t.name}</h3><p>{dateLabel(t.startDate)} — {dateLabel(t.endDate)} · {t.origin} → {t.destinationAirport}</p></div></div><div className="saved-trip-actions">{t.state==="active"&&<><button className="select-trip" onClick={()=>onSelect(t.id)}>{t.id===activeTripId?"目前旅程":"設為目前"}</button><button aria-label="封存" onClick={()=>onArchive(t.id)}><Icon name="archive" size={17}/>封存</button><button className="danger" aria-label="刪除" onClick={()=>onDelete(t.id)}><Icon name="trash" size={17}/></button></>}{t.state==="archived"&&<><button className="select-trip" onClick={()=>onRestore(t.id)}><Icon name="restore" size={17}/>恢復旅程</button><button className="danger" onClick={()=>onDelete(t.id)}><Icon name="trash" size={17}/>刪除</button></>}{t.state==="deleted"&&<button className="select-trip" onClick={()=>onRestore(t.id)}><Icon name="restore" size={17}/>復原</button>}</div></article>)}{shown.length===0&&<div className="empty-trips"><Icon name={tab==="deleted"?"trash":"plane"} size={28}/><strong>{query?"找不到相符旅程":`${labels[tab]}沒有旅程`}</strong><p>{tab==="deleted"?"刪除的旅程可在這裡復原。":"按右上角＋建立新旅程。"}</p></div>}</div>
  </section>
}

export default function Home(){
  const [active,setActive]=useState<Screen>("首頁");
  const [notice,setNotice]=useState("");
  const [modal,setModal]=useState<ModalType>(null);
  const [picked,setPicked]=useState("");
  const [selectedDate,setSelectedDate]=useState("");
  const [trips,setTrips]=useState<Trip[]>([defaultTrip]);
  const [activeTripId,setActiveTripId]=useState(defaultTrip.id);
  const [hydrated,setHydrated]=useState(false);
  const [user,setUser]=useState<User|null>(null);
  const [cloudState,setCloudState]=useState<CloudState>("local");
  const [cloudReady,setCloudReady]=useState(false);
  const [authMode,setAuthMode]=useState<"signIn"|"signUp">("signIn");
  const [authEmail,setAuthEmail]=useState("");
  const [authPassword,setAuthPassword]=useState("");
  const [authBusy,setAuthBusy]=useState(false);
  const [authMessage,setAuthMessage]=useState("");
  const hadLocalTrips=useRef(false);
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{try{const saved=window.localStorage.getItem(TRIPS_KEY);const selected=window.localStorage.getItem(ACTIVE_TRIP_KEY);hadLocalTrips.current=Boolean(saved);if(saved){const parsed=JSON.parse(saved) as Trip[];if(Array.isArray(parsed)&&parsed.length)setTrips(parsed)}if(selected)setActiveTripId(selected)}catch{/* 保留預設旅程 */}setHydrated(true)},0);
    if("serviceWorker" in navigator){const basePath=process.env.NEXT_PUBLIC_BASE_PATH??"";navigator.serviceWorker.register(`${basePath}/sw.js`).catch(()=>undefined)}
    return()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{if(!hydrated)return;window.localStorage.setItem(TRIPS_KEY,JSON.stringify(trips));window.localStorage.setItem(ACTIVE_TRIP_KEY,activeTripId)},[trips,activeTripId,hydrated]);

  useEffect(()=>{
    if(!supabase)return;
    const client=supabase;
    let alive=true;
    client.auth.getSession().then(({data})=>{if(alive)setUser(data.session?.user??null)});
    const {data:listener}=client.auth.onAuthStateChange((_event,session)=>{setUser(session?.user??null);if(!session){setCloudReady(false);setCloudState("local")}});
    return()=>{alive=false;listener.subscription.unsubscribe()};
  },[]);

  useEffect(()=>{
    if(!hydrated||!user||!supabase)return;
    const client=supabase;
    let cancelled=false;
    const loadCloud=async()=>{
      setCloudState("connecting");
      const {data,error}=await client.from("trips").select("id,name,destination_city,start_date,end_date,status,notes,created_at,deleted_at").eq("owner_id",user.id).order("created_at",{ascending:false});
      if(cancelled)return;
      if(error){setCloudState("error");setAuthMessage(`同步失敗：${error.message}`);return}
      const cloudTrips=(data??[]).map(row=>tripFromRow(row as TripRow));
      const migrationKey=`triplog.cloudMigrated.${user.id}`;
      const shouldMigrate=hadLocalTrips.current&&!window.localStorage.getItem(migrationKey);
      let nextTrips=cloudTrips.length&&!shouldMigrate?cloudTrips:trips;
      if(shouldMigrate||!cloudTrips.length){
        const idMap=new Map<string,string>();
        const normalized=trips.map(trip=>{const id=isUuid(trip.id)?trip.id:crypto.randomUUID();idMap.set(trip.id,id);return {...trip,id}});
        const merged=new Map(normalized.map(trip=>[trip.id,trip]));
        cloudTrips.forEach(trip=>merged.set(trip.id,trip));
        nextTrips=[...merged.values()];
        const {error:uploadError}=await client.from("trips").upsert(nextTrips.map(trip=>tripToRow(trip,user.id)),{onConflict:"id"});
        if(uploadError){setCloudState("error");setAuthMessage(`上傳本機旅程失敗：${uploadError.message}`);return}
        window.localStorage.setItem(migrationKey,"1");
        const mappedActive=idMap.get(activeTripId);
        if(mappedActive)setActiveTripId(mappedActive);
      }
      setTrips(nextTrips);
      await client.from("profiles").upsert({id:user.id,display_name:user.user_metadata?.full_name??user.email?.split("@")[0]??"TripLog 使用者",locale:"zh-HK",home_currency:"HKD"},{onConflict:"id"});
      setCloudReady(true);
      setCloudState("synced");
      setAuthMessage("");
    };
    void loadCloud();
    return()=>{cancelled=true};
  // 只在登入身份改變時載入，避免同步後重複合併
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hydrated,user?.id]);

  useEffect(()=>{
    if(!hydrated||!cloudReady||!user||!supabase)return;
    const client=supabase;
    const timer=window.setTimeout(async()=>{
      setCloudState("connecting");
      const {error}=await client.from("trips").upsert(trips.map(trip=>tripToRow(trip,user.id)),{onConflict:"id"});
      setCloudState(error?"error":"synced");
      if(error)setAuthMessage(`同步失敗：${error.message}`);
    },500);
    return()=>window.clearTimeout(timer);
  },[trips,hydrated,cloudReady,user]);
  const activeTrip=useMemo(()=>trips.find(t=>t.id===activeTripId&&t.state==="active")??trips.find(t=>t.state==="active")??defaultTrip,[trips,activeTripId]);
  const dates=useMemo(()=>tripDates(activeTrip),[activeTrip]);
  const shownDate=dates.includes(selectedDate)?selectedDate:activeTrip.startDate;
  const dayItems=useMemo(()=>(activeTrip.itinerary??[]).filter(item=>item.date===shownDate).sort((a,b)=>a.time.localeCompare(b.time)),[activeTrip.itinerary,shownDate]);
  const requirements=useMemo(()=>activeTrip.requirements??requirementTemplates(activeTrip.destination),[activeTrip]);
  const completedRequirements=requirements.filter(item=>item.done).length;
  const prepPercent=requirements.length?Math.round(completedRequirements/requirements.length*100):0;
  const firstIncompleteRequirement=requirements.find(item=>!item.done);
  const selectedDayNumber=Math.max(1,dates.indexOf(shownDate)+1);
  const toast=(m:string)=>{setNotice(m);window.setTimeout(()=>setNotice(""),2400)};
  const pick=(type:ModalType)=>{setPicked("");setModal(type)};
  const updateTripState=(id:string,state:TripState)=>{if(state!=="active"&&trips.filter(t=>t.state==="active").length===1&&trips.some(t=>t.id===id&&t.state==="active")){toast("請先建立另一個旅程，再處理目前旅程");return}setTrips(current=>current.map(t=>t.id===id?{...t,state,deletedAt:state==="deleted"?new Date().toISOString():undefined}:t));if(id===activeTripId&&state!=="active"){const next=trips.find(t=>t.id!==id&&t.state==="active");if(next)setActiveTripId(next.id)}toast(state==="archived"?"旅程已封存，可隨時恢復":state==="deleted"?"已移到最近刪除":"旅程已恢復")};
  const selectTrip=(id:string)=>{setActiveTripId(id);setActive("首頁");toast("已切換目前旅程")};
  const createTrip=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const destination=String(data.get("destination")||"").trim();const name=String(data.get("name")||"").trim()||`${destination}之旅`;const startDate=String(data.get("startDate"));const endDate=String(data.get("endDate"));if(!destination||!startDate||!endDate){toast("請填寫目的地及日期");return}if(endDate<startDate){toast("回程日期不能早過出發日期");return}const trip:Trip={id:crypto.randomUUID(),name,destination,startDate,endDate,origin:String(data.get("origin")||"HKG").toUpperCase(),destinationAirport:String(data.get("destinationAirport")||"---").toUpperCase(),companions:Math.max(1,Number(data.get("companions")||1)),budget:Math.max(0,Number(data.get("budget")||0)),state:"active",createdAt:new Date().toISOString(),itinerary:[],requirements:requirementTemplates(destination)};setTrips(current=>[trip,...current]);setActiveTripId(trip.id);setSelectedDate(startDate);setModal(null);setActive("首頁");toast(user?"新旅程已建立並準備同步":"新旅程已建立，舊旅程仍然保留")};
  const createItineraryItem=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const date=String(data.get("date")||shownDate);const time=String(data.get("time")||"");const title=String(data.get("title")||"").trim();const type=String(data.get("type")||"行程");const note=String(data.get("note")||"").trim();if(!date||!time||!title){toast("請填寫日期、時間及名稱");return}const color:ItineraryItem["color"]=type==="餐飲"?"coral":type==="交通"?"gold":"blue";const item:ItineraryItem={id:crypto.randomUUID(),date,time,title,note,type,color};setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,itinerary:[...(trip.itinerary??[]),item]}:trip));setSelectedDate(date);setModal(null);setActive("行程");toast("行程已加入並準備同步")};
  const deleteItineraryItem=(id:string)=>{setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,itinerary:(trip.itinerary??[]).filter(item=>item.id!==id)}:trip));toast("行程項目已刪除")};
  const toggleRequirement=(id:string)=>{setTrips(current=>current.map(trip=>{if(trip.id!==activeTrip.id)return trip;const list=trip.requirements??requirementTemplates(trip.destination);return {...trip,requirements:list.map(item=>item.id===id?{...item,done:!item.done}:item)}}));toast("準備清單已更新")};
  const exportBackup=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),trips},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`TripLog-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("旅程備份已下載")};
  const submitAuth=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!supabase)return;setAuthBusy(true);setAuthMessage("");if(authMode==="signUp"){const {data,error}=await supabase.auth.signUp({email:authEmail,password:authPassword,options:{emailRedirectTo:"https://marcoaispace-sudo.github.io/triplog/"}});setAuthMessage(error?error.message:data.session?"帳戶已建立，正在同步":"確認電郵已寄出，請按郵件內連結完成註冊")}else{const {error}=await supabase.auth.signInWithPassword({email:authEmail,password:authPassword});setAuthMessage(error?error.message:"登入成功，正在同步本機旅程")};setAuthBusy(false)};
  const signOut=async()=>{if(!supabase)return;await supabase.auth.signOut();setCloudReady(false);setCloudState("local");setAuthMessage("已登出；本機離線副本仍然保留");toast("已登出 Supabase")};

  return <main className="app-shell"><div className="phone-app">
    <header className="topbar"><button className="brand-button" onClick={()=>setActive("首頁")} aria-label="返回首頁"><Brand/></button><button className="icon-button" aria-label="通知" onClick={()=>toast("目前沒有新通知")}><Icon name="bell" size={21}/><span className="notification-dot"/></button></header>

    {active==="首頁"&&<>
      <section className="greeting"><div><p>晚上好，Man Tat</p><h2>下一站，{activeTrip.destination}。</h2></div><button className="all-trips-button" onClick={()=>setActive("旅程")}>全部旅程 <span>{trips.filter(t=>t.state==="active").length}</span></button></section>
      <button className="trip-card trip-card-button" onClick={()=>setActive("旅程")}><div className="trip-card-top"><div><span className="trip-status">即將出發</span><h3>{activeTrip.name}</h3><p>{dateLabel(activeTrip.startDate)} — {dateLabel(activeTrip.endDate)} · {tripDuration(activeTrip)}日</p></div><div className="countdown"><strong>{countdown(activeTrip)}</strong><span>日後</span></div></div><div className="route-line"><span className="airport">{activeTrip.origin}</span><span className="flight-line"><Icon name="plane" size={17}/></span><span className="airport">{activeTrip.destinationAirport}</span></div><div className="trip-meta"><span><Icon name="users" size={17}/>{activeTrip.companions} 位旅客</span><span>旅程預算 <strong>HK${activeTrip.budget.toLocaleString()}</strong></span></div></button>
      <section className="quick-grid"><button className="quick-card primary" onClick={()=>pick("ticket")}><span className="quick-icon"><Icon name="plane"/></span><span><strong>上傳機票</strong><small>自動建立旅程</small></span><Icon name="arrow" size={18}/></button><button className="quick-card" onClick={()=>pick("receipt")}><span className="quick-icon receipt"><Icon name="receipt"/></span><span><strong>拍攝收據</strong><small>自動入帳分帳</small></span><Icon name="arrow" size={18}/></button></section>
      <section className="prep-card"><div className="section-heading"><div><p>出發前準備</p><h3>已完成 {completedRequirements} / {requirements.length} 項</h3></div><button onClick={()=>setActive("準備")}>查看全部</button></div><div className="progress-track"><span style={{width:`${prepPercent}%`}}/></div><button className={`prep-alert ${firstIncompleteRequirement?"":"complete"}`} onClick={()=>setActive("準備")}><span className="alert-icon"><Icon name={firstIncompleteRequirement?"sparkle":"check"} size={19}/></span><span><strong>{firstIncompleteRequirement?.title??"出發前準備已完成"}</strong><small>{firstIncompleteRequirement?.note??"記得在出發前再核對一次資料。"}</small></span><Icon name="arrow" size={18}/></button></section>
      <section className="day-section"><div className="section-heading day-heading"><div><p>第{selectedDayNumber}日安排</p><h3>{activeTrip.destination}行程</h3></div><button className="recommend-button" onClick={()=>toast("附近推介要待酒店及地圖搜尋功能接入")}><Icon name="pin" size={16}/>附近推介</button></div><Timeline items={dayItems}/></section>
    </>}

    {active==="旅程"&&<TripManager trips={trips} activeTripId={activeTrip.id} cloudState={cloudState} isSignedIn={Boolean(user)} onSelect={selectTrip} onAdd={()=>setModal("trip")} onArchive={id=>updateTripState(id,"archived")} onDelete={id=>updateTripState(id,"deleted")} onRestore={id=>updateTripState(id,"active")}/>}
    {active==="準備"&&<section className="screen-content"><div className="page-title"><div><p>{activeTrip.name}</p><h2>出發前準備</h2></div><span className="completion-ring" style={{"--progress":`${prepPercent}%`} as React.CSSProperties}>{prepPercent}%</span></div><div className="info-banner"><Icon name="shield"/><div><strong>{activeTrip.destination}入境要求尚待即時核實</strong><p>清單會按目的地分類，但正式限制必須在出發前查閱官方最新資料。</p></div></div><h3 className="group-title">必須處理</h3><div className="requirement-list">{requirements.filter(item=>item.urgent).map(item=><article className={`task-card urgent ${item.done?"done":""}`} key={item.id}><div className="task-icon"><Icon name={item.done?"check":"sparkle"}/></div><div><span className={`badge ${item.done?"green":"red"}`}>{item.done?"已完成":"尚未完成"}</span><h3>{item.title}</h3><p>{item.note}</p><button onClick={()=>toggleRequirement(item.id)}>{item.done?"取消完成":"標記完成"}</button></div></article>)}</div><h3 className="group-title">旅程文件</h3><div className="document-grid"><article><Icon name="plane"/><strong>機票</strong><span>等待上傳</span></article><article><Icon name="hotel"/><strong>酒店</strong><span>等待上傳</span></article><article><Icon name="shield"/><strong>旅遊保險</strong><span>尚未上傳</span></article><article><Icon name="map"/><strong>離線地圖</strong><span>稍後提供</span></article></div><h3 className="group-title">準備清單</h3><div className="check-list">{requirements.filter(item=>!item.urgent).map(item=><button key={item.id} className={item.done?"done":""} onClick={()=>toggleRequirement(item.id)}><span><Icon name="check" size={15}/></span><span className="check-copy"><strong>{item.title}</strong><small>{item.note}</small></span></button>)}</div></section>}
    {active==="行程"&&<section className="screen-content"><div className="page-title"><div><p>{dateLabel(activeTrip.startDate)} — {dateLabel(activeTrip.endDate)}</p><h2>每日行程</h2></div><button className="round-add" onClick={()=>setModal("itinerary")}><Icon name="plus"/></button></div><div className="date-strip">{dates.map((date,index)=><button key={date} className={date===shownDate?"selected":""} onClick={()=>setSelectedDate(date)}><strong>{index+1}</strong><span>{weekdayLabel(date)}</span></button>)}</div><section className="day-section itinerary-panel"><div className="section-heading day-heading"><div><p>{activeTrip.destination}・{dayItems.length}項安排</p><h3>第{selectedDayNumber}日・{dateLabel(shownDate)}</h3></div><button className="recommend-button" onClick={()=>toast("附近推介要待酒店及地圖搜尋功能接入")}><Icon name="pin" size={16}/>附近推介</button></div><Timeline items={dayItems} onDelete={deleteItineraryItem}/></section></section>}
    {active==="記帳"&&<section className="screen-content"><div className="page-title"><div><p>{activeTrip.name}</p><h2>旅行記帳</h2></div><button className="round-add coral" onClick={()=>pick("receipt")}><Icon name="camera"/></button></div><section className="budget-panel"><p>旅程預算</p><h3>HK${activeTrip.budget.toLocaleString()}</h3><div><span>已用 HK$0</span><span>餘額 HK${activeTrip.budget.toLocaleString()}</span></div><div className="budget-track"><span style={{width:"0%"}}/></div></section><div className="empty-ledger"><Icon name="receipt"/><strong>尚未有帳目</strong><p>拍攝收據後，系統會先讓你確認再入帳。</p></div></section>}
    {active==="設定"&&<section className="screen-content"><div className="page-title"><div><p>個人使用</p><h2>設定</h2></div></div><article className="profile-card"><span>{user?(user.email?.slice(0,2).toUpperCase()??"MT"):"MT"}</span><div><strong>{user?.user_metadata?.full_name??(user?"TripLog 使用者":"Man Tat Ho")}</strong><p>{user?.email??"登入後啟用跨裝置同步"}</p></div><Icon name={user?"shield":"user"} size={19}/></article>
      {!user&&<section className="auth-card"><div><p>Supabase 私人帳戶</p><h3>{authMode==="signIn"?"登入並同步旅程":"建立 TripLog 登入帳戶"}</h3><span>呢個登入只供 TripLog App 使用，與 Supabase Dashboard 帳戶分開。</span></div><form className="auth-form" onSubmit={submitAuth}><label><span>電郵</span><input type="email" autoComplete="email" value={authEmail} onChange={event=>setAuthEmail(event.target.value)} required/></label><label><span>密碼</span><input type="password" autoComplete={authMode==="signIn"?"current-password":"new-password"} minLength={6} value={authPassword} onChange={event=>setAuthPassword(event.target.value)} required/></label><button type="submit" disabled={authBusy||!isSupabaseConfigured}>{authBusy?"處理中…":authMode==="signIn"?"登入並開始同步":"建立帳戶"}</button></form>{authMessage&&<p className="auth-message" role="status">{authMessage}</p>}<button className="auth-switch" onClick={()=>{setAuthMode(authMode==="signIn"?"signUp":"signIn");setAuthMessage("")}}>{authMode==="signIn"?"首次使用？建立帳戶":"已有帳戶？返回登入"}</button></section>}
      {user&&<section className="auth-card signed-in"><div><p>Supabase 私人帳戶</p><h3>{cloudState==="synced"?"雲端同步正常":cloudState==="connecting"?"正在同步資料":"雲端暫時未能同步"}</h3><span>本機旅程會保留作離線副本；重新連線後自動同步。</span></div>{authMessage&&<p className="auth-message" role="status">{authMessage}</p>}<button className="sign-out-button" onClick={signOut}>登出 Supabase</button></section>}
      <h3 className="group-title">資料與同步</h3><div className="settings-list"><button onClick={()=>toast(user?cloudState==="synced"?"所有旅程已安全同步":"正在重新同步":"請先在上方登入 Supabase")}><span className="setting-icon blue"><Icon name="cloud"/></span><div><strong>雲端同步</strong><small>{user?cloudState==="synced"?"旅程、行程及準備清單已自動同步":"連接中，仍保留本機資料":"未登入・目前只儲存在此裝置"}</small></div><span className={cloudState==="synced"?"status-ok":"status-pending"}>{cloudState==="synced"?"正常":cloudState==="connecting"?"同步中":"待登入"}</span></button><button onClick={()=>toast(user?"私人文件空間已準備好；上傳功能下一步接入":"登入後才可上傳私人文件")}><span className="setting-icon coral"><Icon name="upload"/></span><div><strong>文件儲存</strong><small>{user?"私人 Storage 已連接":"登入後啟用私人 Storage"}</small></div><Icon name="arrow" size={18}/></button><button onClick={exportBackup}><span className="setting-icon gold"><Icon name="download"/></span><div><strong>匯出備份</strong><small>下載全部旅程 JSON 備份</small></div><Icon name="arrow" size={18}/></button><button onClick={()=>toast("雲端資料由 RLS 限制，只可由你的登入帳戶存取")}><span className="setting-icon green"><Icon name="shield"/></span><div><strong>私隱與權限</strong><small>私人 Bucket・嚴格 RLS 已啟用</small></div><Icon name="arrow" size={18}/></button></div><p className="version-note">旅記 TripLog・獨立行程與準備清單 v0.4</p></section>}

    <nav className="bottom-nav" aria-label="主要導覽">{[{label:"首頁",icon:"home"},{label:"準備",icon:"check"},{label:"行程",icon:"calendar"},{label:"記帳",icon:"wallet"},{label:"設定",icon:"user"}].map(i=><button key={i.label} className={active===i.label?"active":""} onClick={()=>setActive(i.label as Screen)}><Icon name={i.icon as IconName} size={21}/><span>{i.label}</span></button>)}</nav>
    {notice&&<div className="toast" role="status">{notice}</div>}

    {modal==="trip"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><form className="upload-modal trip-form" onSubmit={createTrip} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className="modal-icon ticket"><Icon name="plane" size={30}/></span><h2>新增旅程</h2><p>新旅程會獨立保存，不會覆蓋原有旅程。</p><div className="form-grid"><label><span>目的地 *</span><input name="destination" placeholder="例如：大阪" required/></label><label><span>旅程名稱</span><input name="name" placeholder="預設為「大阪之旅」"/></label><label><span>出發日期 *</span><input name="startDate" type="date" required/></label><label><span>回程日期 *</span><input name="endDate" type="date" required/></label><label><span>出發機場</span><input name="origin" defaultValue="HKG" maxLength={3}/></label><label><span>抵達機場</span><input name="destinationAirport" placeholder="KIX" maxLength={3}/></label><label><span>旅客人數</span><input name="companions" type="number" min="1" defaultValue="1"/></label><label><span>預算（HK$）</span><input name="budget" type="number" min="0" defaultValue="0"/></label></div><button className="confirm-button" type="submit">建立旅程</button></form></div>}
    {modal==="itinerary"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><form className="upload-modal trip-form itinerary-form" onSubmit={createItineraryItem} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className="modal-icon ticket"><Icon name="calendar" size={29}/></span><h2>新增行程</h2><p>{activeTrip.name}・每項安排只會儲存在目前旅程。</p><div className="form-grid"><label><span>日期 *</span><input name="date" type="date" min={activeTrip.startDate} max={activeTrip.endDate} defaultValue={shownDate} required/></label><label><span>時間 *</span><input name="time" type="time" required/></label><label><span>名稱 *</span><input name="title" placeholder="例如：景福宮" required/></label><label><span>類別</span><select name="type" defaultValue="景點"><option>景點</option><option>餐飲</option><option>交通</option><option>購物</option><option>其他</option></select></label><label><span>備註</span><textarea name="note" rows={3} placeholder="地址、預約編號或集合資料"/></label></div><button className="confirm-button" type="submit">加入行程</button></form></div>}
    {(modal==="ticket"||modal==="receipt")&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><section className="upload-modal" role="dialog" aria-modal="true" aria-label={modal==="ticket"?"上傳機票":"拍攝收據"} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className={`modal-icon ${modal}`}><Icon name={modal==="ticket"?"plane":"receipt"} size={30}/></span><h2>{modal==="ticket"?"上傳機票建立旅程":"拍攝收據自動入帳"}</h2><p>{modal==="ticket"?"目前先支援手動建立旅程；AI 機票辨認將於後續接入。":"收據 AI 辨認尚未連接，現階段不會把相片上傳雲端。"}</p><input ref={fileRef} type="file" accept={modal==="ticket"?"image/*,.pdf":"image/*"} capture={modal==="receipt"?"environment":undefined} hidden onChange={e=>setPicked(e.target.files?.[0]?.name||"")}/><button className="upload-zone" onClick={()=>fileRef.current?.click()}><Icon name={modal==="receipt"?"camera":"upload"}/><strong>{picked||(modal==="receipt"?"開啟相機／選擇相片":"選擇機票檔案")}</strong><span>{picked?"檔案只在此裝置預覽":"尚未連接 AI，不會自動上傳"}</span></button>{picked&&<button className="confirm-button" onClick={()=>{setModal(null);toast("檔案已選擇；AI 辨認尚未連接")}}>完成</button>}</section></div>}
  </div></main>
}
