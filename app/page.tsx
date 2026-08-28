"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import { createOcrWorker, emptyOcrFields, extractOcrFields, extractReceiptOcrFields, ocrLanguages, type OcrFields } from "./ocr";
import { daysUntilDate, formatDateLabel, homeScheduleDate, localTodayDateOnly, tripDateRange, tripDayCount, weekdayDateLabel } from "./date-utils";
import { findPlaceCoordinates, placesErrorMessage, searchHotels, searchNearbyPlaces, type HotelPlaceResult, type NearbyPlaceResult } from "./google-places";
import { loadDailyWeather, weatherDescription, type DailyWeather } from "./weather";

type IconName = "home"|"check"|"calendar"|"wallet"|"user"|"plane"|"receipt"|"pin"|"arrow"|"bell"|"users"|"sparkle"|"upload"|"close"|"camera"|"hotel"|"map"|"route"|"cloud"|"download"|"shield"|"plus"|"edit"|"archive"|"trash"|"restore"|"search"|"copy"|"share"|"eye";
type ModalType = "ticket"|"hotel"|"receipt"|"expense"|"expenseView"|"trip"|"itinerary"|"ocr"|"recommend"|"companion"|null;
type TripState = "active"|"archived"|"deleted";
type Screen = "首頁"|"旅程"|"準備"|"行程"|"記帳"|"設定";
type CloudState = "local"|"connecting"|"synced"|"error";
type WeatherState = "loading"|"ready"|"error";

type ItineraryItem = {id:string;date:string;time:string;title:string;note:string;type:string;color:"blue"|"coral"|"gold";plan?:"main"|"backup";location?:string};
type Requirement = {id:string;title:string;note:string;done:boolean;urgent:boolean};
type TripDocument = {id:string;kind:"ticket"|"hotel";name:string;path:string;size:number;createdAt:string;ocr?:OcrFields;recognizedAt?:string};
type HotelDetails = {name:string;address:string;postalCode:string;phone:string;checkInDate?:string;checkInTime?:string;checkOutDate?:string;checkOutTime?:string};
type Expense = {id:string;date:string;merchant:string;category:string;amount:number;currency:string;exchangeRate?:number;hkdAmount?:number;paidBy:string;splitMode:"none"|"equal";splitWith:string[];note:string;createdAt:string;receiptPath?:string;receiptName?:string;receiptOcrText?:string};
type ExpenseDraft = Omit<Expense,"id"|"createdAt"|"exchangeRate"|"hkdAmount">&{exchangeRate:number|string;hkdAmount:number|string};
type ConversionMode = "rate"|"hkd";
type TripAccess = "owner"|"editor";
type Trip = {id:string;name:string;destination:string;startDate:string;endDate:string;origin:string;destinationAirport:string;companions:number;budget:number;state:TripState;createdAt:string;deletedAt?:string;itinerary?:ItineraryItem[];requirements?:Requirement[];expenses?:Expense[];documents?:TripDocument[];hotelDetails?:HotelDetails;accessRole?:TripAccess};
type TripRow = {id:string;name:string;destination_city:string|null;start_date:string|null;end_date:string|null;status:string;notes:string|null;created_at:string;deleted_at:string|null;access_role?:TripAccess};
type Collaborator = {email:string;status:"active"|"pending";joined_at:string};
type InviteShare = {email:string;url:string};
type MapChoice = {mode:"place";item:ItineraryItem}|{mode:"directions";from:ItineraryItem;to:ItineraryItem};

const TRIPS_KEY="triplog.trips.v1";
const ACTIVE_TRIP_KEY="triplog.activeTrip.v1";
const GOOGLE_MAPS_KEY=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY??"";
const defaultTrip:Trip={id:"tokyo-2026",name:"2026 東京之旅",destination:"東京",startDate:"2026-10-12",endDate:"2026-10-18",origin:"HKG",destinationAirport:"HND",companions:3,budget:20000,state:"active",createdAt:"2026-08-24T00:00:00.000Z",itinerary:[],requirements:[]};
function isDefaultExampleTrip(trip:Trip){return trip.name===defaultTrip.name&&trip.destination===defaultTrip.destination&&trip.startDate===defaultTrip.startDate&&trip.endDate===defaultTrip.endDate&&trip.origin===defaultTrip.origin&&trip.destinationAirport===defaultTrip.destinationAirport&&trip.budget===defaultTrip.budget&&!(trip.itinerary?.length)&&!(trip.documents?.length)}

function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
function sharedLedgerPayload(trip:Trip){return {items:trip.requirements??[],expenses:trip.expenses??[]}}
function tripMetadata(trip:Trip){return JSON.stringify({triplog:{origin:trip.origin,destinationAirport:trip.destinationAirport,companions:trip.companions,budget:trip.budget,itinerary:trip.itinerary??[],requirements:sharedLedgerPayload(trip),documents:trip.documents??[],hotelDetails:trip.hotelDetails}})}
function tripFromRow(row:TripRow):Trip{
  let meta:{triplog?:{origin?:string;destinationAirport?:string;companions?:number;budget?:number;itinerary?:ItineraryItem[];requirements?:Requirement[]|{items?:Requirement[];expenses?:Expense[]};expenses?:Expense[];documents?:TripDocument[];hotelDetails?:HotelDetails}}={};
  try{meta=row.notes?JSON.parse(row.notes):{}}catch{/* 舊文字備註不影響旅程載入 */}
  const stored=meta.triplog??{};
  const requirementEnvelope=!Array.isArray(stored.requirements)&&stored.requirements&&typeof stored.requirements==="object"?stored.requirements:undefined;
  return {id:row.id,name:row.name,destination:row.destination_city??"未設定",startDate:row.start_date??localTodayDateOnly(),endDate:row.end_date??row.start_date??localTodayDateOnly(),origin:stored.origin??"HKG",destinationAirport:stored.destinationAirport??"---",companions:Number(stored.companions??1),budget:Number(stored.budget??0),state:row.deleted_at?"deleted":row.status==="archived"?"archived":"active",createdAt:row.created_at,deletedAt:row.deleted_at??undefined,itinerary:Array.isArray(stored.itinerary)?stored.itinerary:[],requirements:Array.isArray(stored.requirements)?stored.requirements:Array.isArray(requirementEnvelope?.items)?requirementEnvelope.items:undefined,expenses:Array.isArray(stored.expenses)?stored.expenses:Array.isArray(requirementEnvelope?.expenses)?requirementEnvelope.expenses:[],documents:Array.isArray(stored.documents)?stored.documents:[],hotelDetails:stored.hotelDetails,accessRole:row.access_role??"owner"};
}
function tripToRow(trip:Trip,ownerId:string){return {id:trip.id,owner_id:ownerId,name:trip.name,destination_city:trip.destination,start_date:trip.startDate,end_date:trip.endDate,status:trip.state==="archived"?"archived":"planning",source:"manual",notes:tripMetadata(trip),deleted_at:trip.state==="deleted"?(trip.deletedAt??new Date().toISOString()):null}}

function Icon({name,size=22}:{name:IconName;size?:number}){
  const p:Record<IconName,React.ReactNode>={
    home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,check:<path d="M5 12.5 9.2 17 19 7"/>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></>,wallet:<><path d="M4 6.5h14a2 2 0 0 1 2 2V19H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h12"/><path d="M15 12h7v4h-7a2 2 0 0 1 0-4Z"/></>,user:<><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,plane:<><path d="m3 11 18-7-7 18-3-7-8-4Z"/><path d="m11 15 4-4"/></>,receipt:<><path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2-3-2Z"/><path d="M9 9h6M9 13h5"/></>,pin:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="M5 12h14M14 7l5 5-5 5"/></>,bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></>,users:<><circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 5"/></>,sparkle:<><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3ZM5 14l.7 2.3L8 17.5l-2.3 1.2L5 21l-.7-2.3L2 17.5l2.3-1.2L5 14Z"/></>,upload:<><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v5h16v-5"/></>,close:<><path d="m6 6 12 12M18 6 6 18"/></>,camera:<><path d="M4 7h3l2-3h6l2 3h3v13H4V7Z"/><circle cx="12" cy="13" r="4"/></>,hotel:<><path d="M4 21V5h10v16M14 10h6v11M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1M2 21h20"/></>,map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,route:<><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 0-6h2a3 3 0 0 0 3-3V8"/></>,cloud:<><path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.3-2A5 5 0 0 0 7 18Z"/></>,download:<><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></>,shield:<><path d="M12 3 20 6v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,plus:<><path d="M12 5v14M5 12h14"/></>,edit:<><path d="m4 20 4-.8L19 8.3 15.7 5 4.8 15.9 4 20ZM14.5 6.2l3.3 3.3"/></>,archive:<><path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/></>,trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,restore:<><path d="M4 9V4h5"/><path d="M5.5 5.5A8 8 0 1 1 4 14"/></>,search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,copy:<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,share:<><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></>,eye:<><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></>};
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>;
}

function Brand(){return <div className="brand-lockup"><div className="app-mark" aria-label="旅記 TripLog 圖示"><span className="case-handle"/><span className="case-body"><span className="case-tag"/></span><span className="mark-pin"><span/></span></div><div><p className="eyebrow">旅記</p><h1>TripLog</h1></div></div>}
const EXPENSE_CATEGORY_COLORS:Record<string,string>={"餐飲":"#ff756c","交通":"#24a8ea","住宿":"#7e72d8","購物":"#efb94d","景點":"#35a88c","其他":"#91a3ae"};
function expenseHkdAmount(item:Pick<Expense,"amount"|"currency"|"exchangeRate"|"hkdAmount">){
  const saved=Number(item.hkdAmount);
  if(Number.isFinite(saved)&&saved>0)return saved;
  const amount=Number(item.amount||0);
  if(item.currency==="HKD")return amount;
  const rate=Number(item.exchangeRate||0);
  return Number.isFinite(rate)&&rate>0?amount*rate:0;
}
function ExpensePieChart({items}:{items:Expense[]}){
  const categories=Object.entries(items.reduce<Record<string,number>>((totals,item)=>{const amount=expenseHkdAmount(item);totals[item.category]=(totals[item.category]??0)+amount;return totals},{})).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]);
  const total=categories.reduce((sum,[,amount])=>sum+amount,0);
  return <section className="expense-chart-card" aria-label="全部開支分類圓形圖（港幣）"><div className="pie-wrap"><svg className="pie-chart" viewBox="0 0 100 100" role="img" aria-label="全部開支分類（港幣）"><circle className="pie-track" cx="50" cy="50" r="38" pathLength="100"/>{categories.map(([category,amount],index)=>{const percent=total?amount/total*100:0;const offset=total?categories.slice(0,index).reduce((sum,[,previousAmount])=>sum+previousAmount,0)/total*100:0;return <circle key={category} className="pie-segment" cx="50" cy="50" r="38" pathLength="100" stroke={EXPENSE_CATEGORY_COLORS[category]??EXPENSE_CATEGORY_COLORS["其他"]} strokeDasharray={`${percent} ${100-percent}`} strokeDashoffset={-offset}/>})}</svg><div className="pie-center"><small>HKD</small><strong>{total.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div></div><div className="pie-legend">{categories.map(([category,amount])=><div key={category}><span style={{background:EXPENSE_CATEGORY_COLORS[category]??EXPENSE_CATEGORY_COLORS["其他"]}}/><strong>{category}</strong><small>HKD {amount.toLocaleString(undefined,{maximumFractionDigits:2})}・{total?Math.round(amount/total*100):0}%</small></div>)}</div></section>
}
function canOpenMap(item:ItineraryItem){return ["景點","餐廳","餐飲","住宿"].includes(item.type)}
function Timeline({items,routeOrigin,onDelete,onEdit,onMap,onDirections}:{items:ItineraryItem[];routeOrigin?:ItineraryItem;onDelete?:(id:string)=>void;onEdit?:(item:ItineraryItem)=>void;onMap?:(item:ItineraryItem)=>void;onDirections?:(from:ItineraryItem,to:ItineraryItem)=>void}){if(!items.length)return <div className="empty-itinerary"><Icon name="calendar"/><strong>尚未加入行程</strong><p>按右上角＋加入第一個安排，亦可由下方備案拖入。</p></div>;return <div className="timeline">{items.map((i,index)=>{const previous=items[index-1]??routeOrigin;const canShowDirections=Boolean(onDirections&&previous&&canOpenMap(previous)&&canOpenMap(i));return <article className="timeline-item" key={i.id}><time className={i.time?"":"time-pending"}>{i.time||"待定"}</time><span className={`timeline-dot ${i.color}`}/><div className="timeline-copy"><span className={`type-tag ${i.color}`}>{i.type}</span><h4>{i.title}</h4>{i.note&&<p>{i.note}</p>}{i.location&&<small className="timeline-location"><Icon name="pin" size={11}/>{i.location}</small>}</div>{(onEdit||onDelete||onMap||canShowDirections)&&<div className="timeline-actions">{canShowDirections&&<button className="timeline-route" aria-label={`由 ${previous.title} 前往 ${i.title}`} onClick={()=>onDirections?.(previous,i)}><Icon name="route" size={15}/></button>}{onMap&&canOpenMap(i)&&<button className="timeline-map" aria-label={`在地圖開啟 ${i.title}`} onClick={()=>onMap(i)}><Icon name="map" size={15}/></button>}{onEdit&&<button className="timeline-edit" aria-label={`編輯 ${i.title}`} onClick={()=>onEdit(i)}><Icon name="edit" size={15}/></button>}{onDelete&&<button className="timeline-delete" aria-label={`刪除 ${i.title}`} onClick={()=>onDelete(i.id)}><Icon name="trash" size={15}/></button>}</div>}</article>})}</div>}
function dateLabel(value:string){return formatDateLabel(value)}
function tripDuration(trip:Trip){return tripDayCount(trip.startDate,trip.endDate)}
function countdown(trip:Trip){return daysUntilDate(trip.startDate)}
function tripDates(trip:Trip){return tripDateRange(trip.startDate,trip.endDate)}
function weekdayLabel(value:string){return weekdayDateLabel(value)}
function flightItineraryItems(documentId:string,fields:OcrFields,origin:string,destinationAirport:string):ItineraryItem[]{
  const route=`${origin||"出發機場"} → ${destinationAirport||"抵達機場"}`;
  const returnRoute=`${destinationAirport||"回程機場"} → ${origin||"抵達機場"}`;
  const items:Array<ItineraryItem|null>=[
    fields.departureDate&&fields.outboundDepartureTime?{id:`${documentId}-flight-out-depart`,date:fields.departureDate,time:fields.outboundDepartureTime,title:`${fields.flightNumber||"去程航班"} 出發`,note:route,type:"交通",color:"gold"}:null,
    fields.outboundArrivalDate&&fields.outboundArrivalTime?{id:`${documentId}-flight-out-arrive`,date:fields.outboundArrivalDate,time:fields.outboundArrivalTime,title:`抵達 ${destinationAirport||"目的地"}`,note:`${fields.flightNumber||"去程航班"}・${route}`,type:"交通",color:"gold"}:null,
    fields.returnDepartureDate&&fields.returnDepartureTime?{id:`${documentId}-flight-return-depart`,date:fields.returnDepartureDate,time:fields.returnDepartureTime,title:`${fields.returnFlightNumber||"回程航班"} 出發`,note:returnRoute,type:"交通",color:"gold"}:null,
    fields.returnArrivalDate&&fields.returnArrivalTime?{id:`${documentId}-flight-return-arrive`,date:fields.returnArrivalDate,time:fields.returnArrivalTime,title:`抵達 ${origin||"出發地"}`,note:`${fields.returnFlightNumber||"回程航班"}・${returnRoute}`,type:"交通",color:"gold"}:null,
  ];
  return items.filter((item):item is ItineraryItem=>item!==null);
}
function hotelItineraryItems(documentId:string,fields:OcrFields):ItineraryItem[]{
  const hotel=fields.hotelName||"酒店";
  const note=[fields.address,fields.phone].filter(Boolean).join("・");
  const items:Array<ItineraryItem|null>=[
    fields.checkInDate&&fields.checkInTime?{id:`${documentId}-hotel-check-in`,date:fields.checkInDate,time:fields.checkInTime,title:`入住 ${hotel}`,note,type:"住宿",color:"blue",location:fields.address||hotel}:null,
    fields.checkOutDate&&fields.checkOutTime?{id:`${documentId}-hotel-check-out`,date:fields.checkOutDate,time:fields.checkOutTime,title:`退房 ${hotel}`,note,type:"住宿",color:"blue",location:fields.address||hotel}:null,
  ];
  return items.filter((item):item is ItineraryItem=>item!==null);
}
function isJapanDestination(destination:string){return /日本|東京|大阪|京都|福岡|札幌|沖繩|名古屋|神戶|奈良|北海道|tokyo|osaka|kyoto|fukuoka|sapporo|okinawa|nagoya|kobe|nara|japan/i.test(destination)}
function requirementTemplates(destination:string):Requirement[]{
  const place=destination.toLowerCase();
  const japan=isJapanDestination(place);
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

function TripManager({trips,activeTripId,cloudState,isSignedIn,onSelect,onAdd,onArchive,onDelete,onRestore,onCompanions}:{trips:Trip[];activeTripId:string;cloudState:CloudState;isSignedIn:boolean;onSelect:(id:string)=>void;onAdd:()=>void;onArchive:(id:string)=>void;onDelete:(id:string)=>void;onRestore:(id:string)=>void;onCompanions:(id:string)=>void}){
  const [tab,setTab]=useState<TripState>("active");
  const [query,setQuery]=useState("");
  const shown=trips.filter(t=>t.state===tab&&`${t.name} ${t.destination} ${t.origin} ${t.destinationAirport}`.toLowerCase().includes(query.toLowerCase()));
  const labels:Record<TripState,string>={active:"進行中",archived:"已封存",deleted:"最近刪除"};
  return <section className="screen-content trip-manager"><div className="page-title"><div><p>所有資料保留在旅程內</p><h2>我的旅程</h2></div><button className="round-add" onClick={onAdd} aria-label="新增旅程"><Icon name="plus"/></button></div>
    <div className={`local-mode ${cloudState==="synced"?"cloud-connected":""}`}><Icon name="cloud" size={17}/><span><strong>{cloudState==="synced"?"已安全同步至雲端":cloudState==="connecting"?"正在同步旅程":cloudState==="error"?"雲端暫時連接失敗":"目前儲存在此裝置"}</strong><small>{isSignedIn?"裝置仍保留離線副本，恢復連線後會同步":"到「設定」登入即可啟用 Supabase 同步"}</small></span></div>
    <label className="trip-search"><Icon name="search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋旅程、城市或機場"/></label>
    <div className="trip-tabs">{(["active","archived","deleted"] as TripState[]).map(s=><button key={s} className={tab===s?"selected":""} onClick={()=>setTab(s)}>{labels[s]} <span>{trips.filter(t=>t.state===s).length}</span></button>)}</div>
    <div className="trip-list">{shown.map(t=><article key={t.id} className={`saved-trip ${t.id===activeTripId?"current":""}`}><div className="saved-trip-main"><span className="saved-trip-pin"><Icon name="pin" size={18}/></span><div><span>{t.destination} · {tripDuration(t)}日{t.accessRole==="editor"?"・同行共享":""}</span><h3>{t.name}</h3><p>{dateLabel(t.startDate)} — {dateLabel(t.endDate)} · {t.origin} → {t.destinationAirport}</p></div></div><div className="saved-trip-actions">{t.state==="active"&&<><button className="select-trip" onClick={()=>onSelect(t.id)}>{t.id===activeTripId?"目前旅程":"設為目前"}</button>{isSignedIn&&<button aria-label="同行旅伴" onClick={()=>{onSelect(t.id);onCompanions(t.id)}}><Icon name="users" size={17}/>{t.accessRole==="editor"?"共享資料":"旅伴"}</button>}{t.accessRole!=="editor"&&<><button aria-label="封存" onClick={()=>onArchive(t.id)}><Icon name="archive" size={17}/>封存</button><button className="danger" aria-label="刪除" onClick={()=>onDelete(t.id)}><Icon name="trash" size={17}/></button></>}</>}{t.state==="archived"&&t.accessRole!=="editor"&&<><button className="select-trip" onClick={()=>onRestore(t.id)}><Icon name="restore" size={17}/>恢復旅程</button><button className="danger" onClick={()=>onDelete(t.id)}><Icon name="trash" size={17}/>刪除</button></>}{t.state==="deleted"&&t.accessRole!=="editor"&&<button className="select-trip" onClick={()=>onRestore(t.id)}><Icon name="restore" size={17}/>復原</button>}</div></article>)}{shown.length===0&&<div className="empty-trips"><Icon name={tab==="deleted"?"trash":"plane"} size={28}/><strong>{query?"找不到相符旅程":`${labels[tab]}沒有旅程`}</strong><p>{tab==="deleted"?"刪除的旅程可在這裡復原。":"按右上角＋建立新旅程。"}</p></div>}</div>
  </section>
}

export default function Home(){
  const [active,setActive]=useState<Screen>("首頁");
  const [notice,setNotice]=useState("");
  const [modal,setModal]=useState<ModalType>(null);
  const [mapChoice,setMapChoice]=useState<MapChoice|null>(null);
  const [mapChoiceBusy,setMapChoiceBusy]=useState(false);
  const [mapChoiceMessage,setMapChoiceMessage]=useState("");
  const [picked,setPicked]=useState("");
  const [pickedFile,setPickedFile]=useState<File|null>(null);
  const [uploadBusy,setUploadBusy]=useState(false);
  const [selectedDate,setSelectedDate]=useState("");
  const [today,setToday]=useState(()=>localTodayDateOnly());
  const [editingItineraryId,setEditingItineraryId]=useState<string|null>(null);
  const [itineraryPlan,setItineraryPlan]=useState<"main"|"backup">("main");
  const [draggingBackupId,setDraggingBackupId]=useState<string|null>(null);
  const [backupOverMain,setBackupOverMain]=useState(false);
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
  const [ocrDocument,setOcrDocument]=useState<TripDocument|null>(null);
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrProgress,setOcrProgress]=useState(0);
  const [ocrStatus,setOcrStatus]=useState("");
  const [ocrFields,setOcrFields]=useState<OcrFields>(emptyOcrFields);
  const [ocrRawText,setOcrRawText]=useState("");
  const [ocrError,setOcrError]=useState("");
  const [ocrImageUrl,setOcrImageUrl]=useState("");
  const [hotelMatches,setHotelMatches]=useState<HotelPlaceResult[]>([]);
  const [hotelLookupBusy,setHotelLookupBusy]=useState(false);
  const [hotelLookupMessage,setHotelLookupMessage]=useState("");
  const [nearbyPlaces,setNearbyPlaces]=useState<NearbyPlaceResult[]>([]);
  const [nearbyBusy,setNearbyBusy]=useState(false);
  const [nearbyMessage,setNearbyMessage]=useState("");
  const [collaborators,setCollaborators]=useState<Collaborator[]>([]);
  const [collaboratorEmail,setCollaboratorEmail]=useState("");
  const [collaboratorBusy,setCollaboratorBusy]=useState(false);
  const [collaboratorMessage,setCollaboratorMessage]=useState("");
  const [inviteShare,setInviteShare]=useState<InviteShare|null>(null);
  const [editingExpenseId,setEditingExpenseId]=useState<string|null>(null);
  const [viewingExpense,setViewingExpense]=useState<Expense|null>(null);
  const [expenseDraft,setExpenseDraft]=useState<ExpenseDraft>({date:localTodayDateOnly(),merchant:"",category:"餐飲",amount:0,currency:"HKD",exchangeRate:1,hkdAmount:0,paidBy:"",splitMode:"none",splitWith:[],note:""});
  const [conversionMode,setConversionMode]=useState<ConversionMode>("rate");
  const [expenseSaving,setExpenseSaving]=useState(false);
  const [receiptBusy,setReceiptBusy]=useState(false);
  const [receiptProgress,setReceiptProgress]=useState(0);
  const [receiptRawText,setReceiptRawText]=useState("");
  const [receiptPreviewUrl,setReceiptPreviewUrl]=useState("");
  const [savedReceiptUrl,setSavedReceiptUrl]=useState("");
  const [savedReceiptStatus,setSavedReceiptStatus]=useState("");
  const [weatherState,setWeatherState]=useState<WeatherState>("loading");
  const [weatherDays,setWeatherDays]=useState<Record<string,DailyWeather>>({});
  const [weatherLocation,setWeatherLocation]=useState("");
  const hadLocalTrips=useRef(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const receiptCameraRef=useRef<HTMLInputElement>(null);
  const receiptLibraryRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{try{const saved=window.localStorage.getItem(TRIPS_KEY);const selected=window.localStorage.getItem(ACTIVE_TRIP_KEY);hadLocalTrips.current=Boolean(saved);if(saved){const parsed=JSON.parse(saved) as Trip[];if(Array.isArray(parsed)&&parsed.length)setTrips(parsed)}if(selected)setActiveTripId(selected)}catch{/* 保留預設旅程 */}setHydrated(true)},0);
    if("serviceWorker" in navigator){const basePath=process.env.NEXT_PUBLIC_BASE_PATH??"";navigator.serviceWorker.register(`${basePath}/sw.js`).catch(()=>undefined)}
    return()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{const timer=window.setInterval(()=>setToday(localTodayDateOnly()),60_000);return()=>window.clearInterval(timer)},[]);
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
    if(!user||!supabase)return;
    const params=new URLSearchParams(window.location.search);
    const token=params.get("trip_invite");
    if(!token)return;
    void supabase.rpc("triplog_accept_invitation",{p_token:token}).then(({error})=>{
      if(error){setAuthMessage(`未能接受旅伴邀請：${error.message}`);setActive("設定");return}
      params.delete("trip_invite");
      const query=params.toString();
      window.history.replaceState({},"",`${window.location.pathname}${query?`?${query}`:""}`);
      setAuthMessage("旅伴邀請已接受，正在載入共享旅程");
      window.location.reload();
    });
  },[user]);

  useEffect(()=>{
    if(!hydrated||!user||!supabase)return;
    const client=supabase;
    let cancelled=false;
    const loadCloud=async()=>{
      setCloudState("connecting");
      let {data,error}=await client.rpc("triplog_list_accessible_trips");
      if(error){
        const fallback=await client.from("trips").select("id,name,destination_city,start_date,end_date,status,notes,created_at,deleted_at").eq("owner_id",user.id).order("created_at",{ascending:false});
        data=fallback.data?.map(row=>({...row,access_role:"owner"}))??null;
        error=fallback.error;
      }
      if(cancelled)return;
      if(error){setCloudState("error");setAuthMessage(`同步失敗：${error.message}`);return}
      const cloudTrips=((data??[]) as TripRow[]).map(row=>tripFromRow(row)).filter(trip=>!isDefaultExampleTrip(trip));
      const migrationKey=`triplog.cloudMigrated.${user.id}`;
      const shouldMigrate=hadLocalTrips.current&&!window.localStorage.getItem(migrationKey);
      let nextTrips=cloudTrips.length&&!shouldMigrate?cloudTrips:trips;
      if(shouldMigrate||!cloudTrips.length){
        const idMap=new Map<string,string>();
        const normalized=trips.map(trip=>{const id=isUuid(trip.id)?trip.id:crypto.randomUUID();idMap.set(trip.id,id);return {...trip,id}});
        const merged=new Map(normalized.map(trip=>[trip.id,trip]));
        cloudTrips.forEach(trip=>merged.set(trip.id,trip));
        nextTrips=[...merged.values()];
        const ownedTrips=nextTrips.filter(trip=>trip.accessRole!=="editor"&&!isDefaultExampleTrip(trip));
        const {error:uploadError}=ownedTrips.length?await client.from("trips").upsert(ownedTrips.map(trip=>tripToRow(trip,user.id)),{onConflict:"id"}):{error:null};
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
      const ownedTrips=trips.filter(trip=>trip.accessRole!=="editor"&&!isDefaultExampleTrip(trip));
      const sharedTrips=trips.filter(trip=>trip.accessRole==="editor");
      const ownerResult=ownedTrips.length?await client.from("trips").upsert(ownedTrips.map(trip=>tripToRow(trip,user.id)),{onConflict:"id"}):{error:null};
      let sharedError:string|undefined;
      for(const trip of sharedTrips){
        const {error}=await client.rpc("triplog_update_shared_trip",{p_trip_id:trip.id,p_budget:trip.budget,p_itinerary:trip.itinerary??[],p_requirements:sharedLedgerPayload(trip)});
        if(error){sharedError=error.message;break}
      }
      const message=ownerResult.error?.message??sharedError;
      setCloudState(message?"error":"synced");
      if(message)setAuthMessage(`同步失敗：${message}`);
    },500);
    return()=>window.clearTimeout(timer);
  },[trips,hydrated,cloudReady,user]);
  const activeTrip=useMemo(()=>trips.find(t=>t.id===activeTripId&&t.state==="active")??trips.find(t=>t.state==="active")??defaultTrip,[trips,activeTripId]);
  const dates=useMemo(()=>tripDates(activeTrip),[activeTrip]);
  const shownDate=dates.includes(selectedDate)?selectedDate:activeTrip.startDate;
  const weatherQueries=useMemo(()=>[activeTrip.hotelDetails?.address??"",activeTrip.hotelDetails?.name?`${activeTrip.hotelDetails.name} ${activeTrip.destination}`:"",activeTrip.destination],[activeTrip.destination,activeTrip.hotelDetails?.address,activeTrip.hotelDetails?.name]);
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){setWeatherState("loading");setWeatherDays({});setWeatherLocation("")}});
    void loadDailyWeather(weatherQueries,controller.signal).then(({location,days})=>{
      if(controller.signal.aborted)return;
      setWeatherDays(Object.fromEntries(days.map(day=>[day.date,day])));setWeatherLocation(location.label);setWeatherState("ready");
    }).catch(()=>{if(!controller.signal.aborted)setWeatherState("error")});
    return()=>controller.abort();
  },[weatherQueries]);
  const shownWeather=weatherDays[shownDate];
  const shownWeatherText=shownWeather?weatherDescription(shownWeather.code):null;
  const dayItems=useMemo(()=>(activeTrip.itinerary??[]).filter(item=>item.plan!=="backup"&&item.date===shownDate).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")),[activeTrip.itinerary,shownDate]);
  const homeDate=useMemo(()=>homeScheduleDate(activeTrip.startDate,activeTrip.endDate,(activeTrip.itinerary??[]).filter(item=>item.plan!=="backup").map(item=>item.date),today),[activeTrip.endDate,activeTrip.itinerary,activeTrip.startDate,today]);
  const homeDayItems=useMemo(()=>(activeTrip.itinerary??[]).filter(item=>item.plan!=="backup"&&item.date===homeDate).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")),[activeTrip.itinerary,homeDate]);
  const hotelRouteOrigin=useMemo<ItineraryItem|undefined>(()=>{
    const name=activeTrip.hotelDetails?.name?.trim();
    const address=activeTrip.hotelDetails?.address?.trim();
    if(!name&&!address)return undefined;
    return {id:`${activeTrip.id}-hotel-route-origin`,date:"",time:"",title:name||`${activeTrip.destination}酒店`,note:"",type:"住宿",color:"blue",location:address||name};
  },[activeTrip.destination,activeTrip.hotelDetails?.address,activeTrip.hotelDetails?.name,activeTrip.id]);
  const backupItems=useMemo(()=>(activeTrip.itinerary??[]).filter(item=>item.plan==="backup").sort((a,b)=>a.type.localeCompare(b.type)||a.title.localeCompare(b.title)),[activeTrip.itinerary]);
  const editingItinerary=useMemo(()=>(activeTrip.itinerary??[]).find(item=>item.id===editingItineraryId)??null,[activeTrip.itinerary,editingItineraryId]);
  const requirements=useMemo(()=>activeTrip.requirements??requirementTemplates(activeTrip.destination),[activeTrip]);
  const completedRequirements=requirements.filter(item=>item.done).length;
  const prepPercent=requirements.length?Math.round(completedRequirements/requirements.length*100):0;
  const firstIncompleteRequirement=requirements.find(item=>!item.done);
  const isSharedEditor=activeTrip.accessRole==="editor";
  const expenses=useMemo(()=>(activeTrip.expenses??[]).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)),[activeTrip.expenses]);
  const hkdSpent=useMemo(()=>expenses.reduce((total,item)=>total+expenseHkdAmount(item),0),[expenses]);
  const missingExchangeRateCount=useMemo(()=>expenses.filter(item=>item.currency!=="HKD"&&expenseHkdAmount(item)<=0).length,[expenses]);
  const expenseParticipants=useMemo(()=>{
    const me=user?.email?.toLowerCase()??"我";
    const labels=[me,...collaborators.filter(person=>person.status==="active").map(person=>person.email.toLowerCase())];
    if(isSharedEditor)labels.push("旅程擁有人");
    return [...new Set(labels)];
  },[collaborators,isSharedEditor,user?.email]);
  const selectedDayNumber=Math.max(1,dates.indexOf(shownDate)+1);
  const homeDayNumber=Math.max(1,dates.indexOf(homeDate)+1);
  const ticketDocuments=(activeTrip.documents??[]).filter(document=>document.kind==="ticket");
  const hotelDocuments=(activeTrip.documents??[]).filter(document=>document.kind==="hotel");
  const toast=(m:string)=>{setNotice(m);window.setTimeout(()=>setNotice(""),2400)};
  const chooseReceiptFile=(file:File|null)=>{setPickedFile(file);setPicked(file?.name??"");if(receiptPreviewUrl)URL.revokeObjectURL(receiptPreviewUrl);setReceiptPreviewUrl(file?URL.createObjectURL(file):"")};
  const copyText=async(label:string,value?:string)=>{if(!value){toast(`${label}尚未有資料`);return}try{await navigator.clipboard.writeText(value);toast(`${label}已複製`)}catch{toast("未能自動複製，請長按文字複製")}};
  const pick=(type:ModalType)=>{
    if(isSharedEditor&&(type==="ticket"||type==="hotel")){toast("私人文件只限旅程擁有人查看");return}
    setPicked("");setPickedFile(null);
    if(receiptPreviewUrl){URL.revokeObjectURL(receiptPreviewUrl);setReceiptPreviewUrl("")}
    if(type==="receipt"){
      const payer=user?.email?.toLowerCase()??"我";
      setEditingExpenseId(null);setConversionMode("rate");setExpenseDraft({date:dates.includes(today)?today:activeTrip.startDate,merchant:"",category:"餐飲",amount:0,currency:"HKD",exchangeRate:"1",hkdAmount:"",paidBy:payer,splitMode:"none",splitWith:[],note:""});setReceiptRawText("");setReceiptProgress(0);setModal("expense");
      if(supabase&&user&&!isSharedEditor)void supabase.rpc("triplog_list_collaborators",{p_trip_id:activeTrip.id}).then(({data})=>setCollaborators((data??[]) as Collaborator[]));
      return;
    }
    setModal(type)
  };
  const updateTripState=(id:string,state:TripState)=>{if(state!=="active"&&trips.filter(t=>t.state==="active").length===1&&trips.some(t=>t.id===id&&t.state==="active")){toast("請先建立另一個旅程，再處理目前旅程");return}setTrips(current=>current.map(t=>t.id===id?{...t,state,deletedAt:state==="deleted"?new Date().toISOString():undefined}:t));if(id===activeTripId&&state!=="active"){const next=trips.find(t=>t.id!==id&&t.state==="active");if(next)setActiveTripId(next.id)}toast(state==="archived"?"旅程已封存，可隨時恢復":state==="deleted"?"已移到最近刪除":"旅程已恢復")};
  const selectTrip=(id:string)=>{setActiveTripId(id);setActive("首頁");toast("已切換目前旅程")};
  const createTrip=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const destination=String(data.get("destination")||"").trim();const name=String(data.get("name")||"").trim()||`${destination}之旅`;const startDate=String(data.get("startDate"));const endDate=String(data.get("endDate"));if(!destination||!startDate||!endDate){toast("請填寫目的地及日期");return}if(endDate<startDate){toast("回程日期不能早過出發日期");return}const trip:Trip={id:crypto.randomUUID(),name,destination,startDate,endDate,origin:String(data.get("origin")||"HKG").toUpperCase(),destinationAirport:String(data.get("destinationAirport")||"---").toUpperCase(),companions:Math.max(1,Number(data.get("companions")||1)),budget:0,state:"active",createdAt:new Date().toISOString(),itinerary:[],requirements:requirementTemplates(destination),documents:[]};setTrips(current=>[trip,...current]);setActiveTripId(trip.id);setSelectedDate(startDate);setModal(null);setActive("首頁");toast(user?"新旅程已建立並準備同步":"新旅程已建立，舊旅程仍然保留")};
  const openNewItinerary=()=>{setEditingItineraryId(null);setItineraryPlan("main");setModal("itinerary")};
  const openEditItinerary=(item:ItineraryItem)=>{setEditingItineraryId(item.id);setItineraryPlan(item.plan==="backup"?"backup":"main");setModal("itinerary")};
  const saveItineraryItem=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const plan=itineraryPlan;const date=plan==="main"?String(data.get("date")||shownDate):"";const time=plan==="main"?String(data.get("time")||""):"";const title=String(data.get("title")||"").trim();const type=String(data.get("type")||"行程");const note=String(data.get("note")||"").trim();const location=String(data.get("location")||"").trim();if(!title){toast("請填寫行程名稱");return}if(plan==="main"&&(!date||!time)){toast("主線行程需要日期及時間");return}const color:ItineraryItem["color"]=["餐廳","餐飲"].includes(type)?"coral":type==="交通"?"gold":"blue";const item:ItineraryItem={id:editingItineraryId??crypto.randomUUID(),date,time,title,note,type,color,location,plan};setTrips(current=>current.map(trip=>{if(trip.id!==activeTrip.id)return trip;const itinerary=trip.itinerary??[];return {...trip,itinerary:editingItineraryId?itinerary.map(existing=>existing.id===editingItineraryId?item:existing):[...itinerary,item]}}));if(plan==="main")setSelectedDate(date);setEditingItineraryId(null);setModal(null);setActive("行程");toast(editingItineraryId?"行程內容已更新並準備同步":plan==="backup"?"已加入備案；每一日都會顯示":"行程已加入並準備同步")};
  const deleteItineraryItem=(id:string)=>{const item=(activeTrip.itinerary??[]).find(existing=>existing.id===id);if(!item)return;if(!window.confirm(`確定刪除「${item.title}」？\n刪除後將無法復原。`))return;setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,itinerary:(trip.itinerary??[]).filter(existing=>existing.id!==id)}:trip));toast(item.plan==="backup"?"備案行程已刪除":"行程項目已刪除")};
  const moveBackupToMain=(id:string,date=shownDate)=>{setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,itinerary:(trip.itinerary??[]).map(item=>item.id===id?{...item,plan:"main",date,time:""}:item)}:trip));setDraggingBackupId(null);setBackupOverMain(false);toast(`已加入第${Math.max(1,dates.indexOf(date)+1)}日；時間待定，可按編輯補上`)};
  const openMap=(item:ItineraryItem)=>{setMapChoiceMessage("");setMapChoice({mode:"place",item})};
  const openDirections=(from:ItineraryItem,to:ItineraryItem)=>{setMapChoiceMessage("");setMapChoice({mode:"directions",from,to})};
  const launchMap=async(provider:"google"|"naver")=>{
    if(!mapChoice||mapChoiceBusy)return;
    const queryFor=(item:ItineraryItem)=>(item.location||`${item.title} ${activeTrip.destination}`).trim();
    if(provider==="google"){
      const url=mapChoice.mode==="place"
        ?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryFor(mapChoice.item))}`
        :`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(queryFor(mapChoice.from))}&destination=${encodeURIComponent(queryFor(mapChoice.to))}`;
      window.open(url,"_blank","noopener,noreferrer");
      setMapChoice(null);
      return;
    }
    if(mapChoice.mode==="place"){
      window.open(`https://map.naver.com/p/search/${encodeURIComponent(queryFor(mapChoice.item))}`,"_blank","noopener,noreferrer");
      setMapChoice(null);
      return;
    }
    const popup=window.open("about:blank","_blank");
    setMapChoiceBusy(true);
    setMapChoiceMessage("正在定位上一站及目前行程…");
    try{
      const originName=queryFor(mapChoice.from);
      const destinationName=queryFor(mapChoice.to);
      const [origin,destination]=await Promise.all([
        findPlaceCoordinates(originName,GOOGLE_MAPS_KEY),
        findPlaceCoordinates(destinationName,GOOGLE_MAPS_KEY),
      ]);
      if(!origin||!destination)throw new Error("未能準確定位其中一個地點");
      const url=`https://map.naver.com/p/directions/${origin.lng},${origin.lat},${encodeURIComponent(originName)}/${destination.lng},${destination.lat},${encodeURIComponent(destinationName)}/-/transit`;
      if(popup)popup.location.href=url;else window.open(url,"_blank","noopener,noreferrer");
      setMapChoice(null);
    }catch(error){
      if(popup)popup.close();
      setMapChoiceMessage(`${error instanceof Error?error.message:"Naver Map 路線暫時未能開啟"}；可改用 Google Maps，或補齊兩個行程地址。`);
    }finally{setMapChoiceBusy(false)}
  };
  const openNearbyRecommendations=async()=>{
    const base=(activeTrip.hotelDetails?.address||activeTrip.hotelDetails?.name||activeTrip.destination).trim();
    setModal("recommend");setNearbyPlaces([]);setNearbyMessage("");
    if(!GOOGLE_MAPS_KEY){setNearbyMessage("Google Places 尚未完成設定，暫時未能搜尋附近地點。");return}
    setNearbyBusy(true);
    try{const places=await searchNearbyPlaces(base,GOOGLE_MAPS_KEY);setNearbyPlaces(places);if(!places.length)setNearbyMessage("附近暫時找不到合適推介，請稍後再試。")}catch(error){setNearbyMessage(placesErrorMessage(error))}
    finally{setNearbyBusy(false)}
  };
  const addNearbyToBackup=(place:NearbyPlaceResult)=>{
    const id=`google-place-${place.id}`;
    if((activeTrip.itinerary??[]).some(item=>item.id===id)){toast("這個地點已在行程或備案內");return}
    const note=place.rating?`Google 評分 ${place.rating.toFixed(1)}${place.userRatingCount?`・${place.userRatingCount.toLocaleString()} 則評論`:""}`:"Google Maps 附近推介";
    const item:ItineraryItem={id,date:"",time:"",title:place.name,note,type:place.category,color:place.category==="餐廳"?"coral":"blue",location:place.address,plan:"backup"};
    setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,itinerary:[...(trip.itinerary??[]),item]}:trip));
    toast("已加入備案；每一日都會顯示");
  };
  const toggleRequirement=(id:string)=>{setTrips(current=>current.map(trip=>{if(trip.id!==activeTrip.id)return trip;const list=trip.requirements??requirementTemplates(trip.destination);return {...trip,requirements:list.map(item=>item.id===id?{...item,done:!item.done}:item)}}));toast("準備清單已更新")};
  const loadSavedReceipt=async(expense:Expense)=>{
    setSavedReceiptUrl("");
    if(!expense.receiptPath){setSavedReceiptStatus("");return}
    if(!supabase||!user){setSavedReceiptStatus("請先登入才可查看私人收據原圖");return}
    setSavedReceiptStatus("正在開啟私人原圖…");
    const {data,error}=await supabase.storage.from("trip-documents").createSignedUrl(expense.receiptPath,300);
    if(error||!data?.signedUrl){setSavedReceiptStatus("未能開啟原圖；私人收據只限上傳者查看");return}
    setSavedReceiptUrl(data.signedUrl);setSavedReceiptStatus("");
  };
  const openViewExpense=(expense:Expense)=>{setViewingExpense(expense);setModal("expenseView");void loadSavedReceipt(expense)};
  const openEditExpense=(expense:Expense)=>{setEditingExpenseId(expense.id);setConversionMode(expense.currency!=="HKD"&&Number(expense.hkdAmount)>0?"hkd":"rate");setExpenseDraft({...expense,exchangeRate:String(expense.currency==="HKD"?1:Number(expense.exchangeRate||0)),hkdAmount:String(expenseHkdAmount(expense))});setPicked("");setPickedFile(null);setReceiptRawText(expense.receiptOcrText??"");setReceiptProgress(0);if(receiptPreviewUrl){URL.revokeObjectURL(receiptPreviewUrl);setReceiptPreviewUrl("")}setModal("expense");void loadSavedReceipt(expense)};
  const setExpenseField=<K extends keyof ExpenseDraft>(name:K,value:ExpenseDraft[K])=>setExpenseDraft(current=>({...current,[name]:value}));
  const toggleSplitPerson=(person:string)=>setExpenseDraft(current=>({...current,splitWith:current.splitWith.includes(person)?current.splitWith.filter(item=>item!==person):[...current.splitWith,person]}));
  const recognizeReceipt=async()=>{
    if(!pickedFile)return;
    setReceiptBusy(true);setReceiptProgress(0);setReceiptRawText("");
    let worker:Awaited<ReturnType<typeof createOcrWorker>>|null=null;
    try{
      worker=await createOcrWorker(ocrLanguages(activeTrip.destination),message=>setReceiptProgress(Math.round((message.progress??0)*100)));
      const result=await worker.recognize(pickedFile);
      const fields=extractReceiptOcrFields(result.data.text);
      setReceiptRawText(fields.rawText);
      setExpenseDraft(current=>{const currency=fields.currency||current.currency;return {...current,merchant:fields.merchant||current.merchant,date:fields.date||current.date,amount:Number(fields.amount)||current.amount,currency,exchangeRate:currency==="HKD"?"1":currency===current.currency?current.exchangeRate:"",hkdAmount:""}});
      toast(fields.amount?"已辨認收據，請核對金額再入帳":"辨認完成，但未能可靠找到總額，請手動填寫");
    }catch(error){toast(error instanceof Error?error.message:"收據辨認失敗，請手動入帳")}
    finally{if(worker)await worker.terminate().catch(()=>undefined);setReceiptBusy(false)}
  };
  const saveExpense=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const amount=Number(expenseDraft.amount);
    const directHkdAmount=Number(expenseDraft.hkdAmount);
    const exchangeRate=expenseDraft.currency==="HKD"?1:conversionMode==="hkd"?directHkdAmount/amount:Number(expenseDraft.exchangeRate);
    const hkdAmount=expenseDraft.currency==="HKD"?amount:conversionMode==="hkd"?directHkdAmount:amount*exchangeRate;
    if(!expenseDraft.merchant.trim()){toast("請填寫商戶或項目名稱");return}
    if(!Number.isFinite(amount)||amount<=0){toast("請填寫正確金額");return}
    if(expenseDraft.currency!=="HKD"&&conversionMode==="hkd"&&(!Number.isFinite(directHkdAmount)||directHkdAmount<=0)){toast("請填寫大約港幣金額");return}
    if(expenseDraft.currency!=="HKD"&&conversionMode==="rate"&&(!Number.isFinite(exchangeRate)||exchangeRate<=0)){toast(`請填寫當時匯率：1 ${expenseDraft.currency} 等於幾多港幣`);return}
    if(expenseDraft.splitMode==="equal"&&expenseDraft.splitWith.length<2){toast("平均分帳最少要選擇兩位旅客");return}
    const existing=editingExpenseId?expenses.find(item=>item.id===editingExpenseId):undefined;
    let receiptPath=existing?.receiptPath;
    let receiptName=existing?.receiptName;
    if(pickedFile){
      if(!user||!supabase){toast("請先登入 Supabase，才可安全保存收據原圖");return}
      if(pickedFile.size>10*1024*1024){toast("收據相片不可超過 10MB");return}
      if(!pickedFile.type.startsWith("image/")){toast("收據原圖只支援相片格式");return}
      const extension=pickedFile.name.split(".").pop()?.toLowerCase()||"jpg";
      const safeName=pickedFile.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+/,"")||`receipt.${extension}`;
      const fileId=crypto.randomUUID();
      receiptPath=`${user.id}/${activeTrip.id}/receipts/${fileId}-${safeName}`;
      setExpenseSaving(true);
      const {error}=await supabase.storage.from("trip-documents").upload(receiptPath,pickedFile,{contentType:pickedFile.type||"image/jpeg",upsert:false});
      setExpenseSaving(false);
      if(error){toast(`收據原圖保存失敗：${error.message}`);return}
      receiptName=pickedFile.name;
    }
    const expense:Expense={...expenseDraft,merchant:expenseDraft.merchant.trim(),amount,exchangeRate,hkdAmount,receiptPath,receiptName,receiptOcrText:receiptRawText||existing?.receiptOcrText,id:editingExpenseId??crypto.randomUUID(),createdAt:existing?.createdAt??new Date().toISOString()};
    setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,expenses:editingExpenseId?(trip.expenses??[]).map(item=>item.id===editingExpenseId?expense:item):[...(trip.expenses??[]),expense]}:trip));
    setModal(null);setEditingExpenseId(null);setPickedFile(null);setPicked("");setReceiptRawText("");setSavedReceiptUrl("");setSavedReceiptStatus("");if(receiptPreviewUrl){URL.revokeObjectURL(receiptPreviewUrl);setReceiptPreviewUrl("")}toast(editingExpenseId?"帳目已更新並準備同步":receiptPath?"帳目及收據原圖已安全保存":"帳目已加入並準備同步");
  };
  const deleteExpense=async(expense:Expense)=>{if(!window.confirm(`確定刪除「${expense.merchant}」${expense.currency} ${expense.amount.toLocaleString()}？`))return;if(expense.receiptPath&&supabase&&user)await supabase.storage.from("trip-documents").remove([expense.receiptPath]);setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,expenses:(trip.expenses??[]).filter(item=>item.id!==expense.id)}:trip));toast("帳目已刪除")};
  const uploadDocument=async()=>{
    if(!pickedFile||!(modal==="ticket"||modal==="hotel"))return;
    if(isSharedEditor){toast("機票及酒店文件只限旅程擁有人查看");return}
    if(!user||!supabase){toast("請先登入 Supabase 才可上傳私人文件");return}
    if(pickedFile.size>10*1024*1024){toast("檔案不可超過 10MB");return}
    const extension=pickedFile.name.split(".").pop()?.toLowerCase()??"";
    if(!["jpg","jpeg","png","webp","heic","heif","pdf"].includes(extension)){toast("只支援相片或 PDF");return}
    const contentTypes:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif",pdf:"application/pdf"};
    const safeName=pickedFile.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+/,"")||`document.${extension}`;
    const id=crypto.randomUUID();
    const path=`${user.id}/${activeTrip.id}/${id}-${safeName}`;
    setUploadBusy(true);
    const {error}=await supabase.storage.from("trip-documents").upload(path,pickedFile,{contentType:contentTypes[extension],upsert:false});
    setUploadBusy(false);
    if(error){toast(`上傳失敗：${error.message}`);return}
    const document:TripDocument={id,kind:modal,name:pickedFile.name,path,size:pickedFile.size,createdAt:new Date().toISOString()};
    setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,documents:[...(trip.documents??[]),document]}:trip));
    setModal(null);setPicked("");setPickedFile(null);toast("文件已安全上傳並準備同步");
  };
  const openDocument=async(document:TripDocument)=>{if(!supabase||!user){toast("請先登入 Supabase");return}const {data,error}=await supabase.storage.from("trip-documents").createSignedUrl(document.path,60);if(error||!data?.signedUrl){toast("暫時未能開啟文件");return}const link=window.document.createElement("a");link.href=data.signedUrl;link.target="_blank";link.rel="noopener noreferrer";link.click()};
  const deleteDocument=async(document:TripDocument)=>{if(!supabase||!user)return;if(!window.confirm(`確定刪除「${document.name}」？`))return;const {error}=await supabase.storage.from("trip-documents").remove([document.path]);if(error){toast(`刪除失敗：${error.message}`);return}setTrips(current=>current.map(trip=>trip.id===activeTrip.id?{...trip,documents:(trip.documents??[]).filter(item=>item.id!==document.id)}:trip));toast("文件已刪除")};
  const applyHotelMatch=(match:HotelPlaceResult)=>{setOcrFields(current=>({...current,hotelName:match.name||current.hotelName,address:match.address||current.address,postalCode:match.postalCode||current.postalCode,phone:match.phone||current.phone}));setHotelLookupMessage("已套用網上酒店資料，請對照原圖核實")};
  const lookupHotel=async(name:string)=>{
    const query=name.trim();if(!query){setHotelLookupMessage("請先輸入酒店名稱");return}
    if(!GOOGLE_MAPS_KEY){setHotelLookupMessage("網上酒店搜尋尚未完成 API 設定；目前可查看原圖並手動填寫");return}
    setHotelLookupBusy(true);setHotelLookupMessage("正在網上核對酒店資料…");setHotelMatches([]);
    try{const matches=await searchHotels(`${query} ${activeTrip.destination}`,GOOGLE_MAPS_KEY);setHotelMatches(matches);if(matches[0])applyHotelMatch(matches[0]);else setHotelLookupMessage("找不到相符酒店，請修改酒店名稱再搜尋")}
    catch(error){setHotelLookupMessage(placesErrorMessage(error))}
    finally{setHotelLookupBusy(false)}
  };
  const recognizeDocument=async(document:TripDocument)=>{
    if(/\.pdf$/i.test(document.name)){toast("免費辨認首版只支援相片；PDF 請先截圖再上傳");return}
    if(!supabase||!user){toast("請先登入 Supabase");return}
    setOcrDocument(document);setOcrBusy(true);setOcrProgress(0);setOcrStatus("準備下載私人相片…");setOcrFields({...emptyOcrFields,...document.ocr});setOcrRawText("");setOcrError("");setHotelMatches([]);setHotelLookupMessage("");setModal("ocr");
    let worker:Awaited<ReturnType<typeof createOcrWorker>>|null=null;
    try{
      const {data,error}=await supabase.storage.from("trip-documents").download(document.path);
      if(error||!data)throw new Error(error?.message??"未能下載相片");
      setOcrImageUrl(current=>{if(current)URL.revokeObjectURL(current);return URL.createObjectURL(data)});
      const labels:Record<string,string>={"loading tesseract core":"載入辨認核心","loading language traineddata":"下載語言資料","initializing api":"初始化辨認器","recognizing text":"正在辨認文字"};
      worker=await createOcrWorker(ocrLanguages(activeTrip.destination),message=>{setOcrProgress(Math.round((message.progress??0)*100));setOcrStatus(labels[message.status]??"正在準備辨認…")});
      const result=await worker.recognize(data);
      const fields=extractOcrFields(result.data.text);
      setOcrRawText(result.data.text);setOcrFields(fields);setOcrProgress(100);setOcrStatus("辨認完成，請核對以下資料");if(document.kind==="hotel"&&fields.hotelName)void lookupHotel(fields.hotelName);
    }catch(error){setOcrError(error instanceof Error?error.message:"辨認失敗，請稍後再試");setOcrStatus("辨認未完成")}finally{if(worker)await worker.terminate().catch(()=>undefined);setOcrBusy(false)}
  };
  const setOcrField=(name:keyof OcrFields,value:string)=>setOcrFields(current=>({...current,[name]:value}));
  const confirmOcr=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!ocrDocument)return;
    const recognizedAt=new Date().toISOString();
    setTrips(current=>current.map(trip=>{if(trip.id!==activeTrip.id)return trip;const documents=(trip.documents??[]).map(document=>document.id===ocrDocument.id?{...document,ocr:ocrFields,recognizedAt}:document);if(ocrDocument.kind==="ticket"){const origin=ocrFields.origin.toUpperCase()||trip.origin;const destinationAirport=ocrFields.destinationAirport.toUpperCase()||trip.destinationAirport;const startDate=ocrFields.departureDate||trip.startDate;const proposedEnd=ocrFields.returnArrivalDate||ocrFields.returnDepartureDate||trip.endDate;const endDate=proposedEnd<startDate?startDate:proposedEnd;const flightIds=`${ocrDocument.id}-flight-`;const itinerary=[...(trip.itinerary??[]).filter(item=>!item.id.startsWith(flightIds)),...flightItineraryItems(ocrDocument.id,ocrFields,origin,destinationAirport)];return {...trip,documents,origin,destinationAirport,startDate,endDate,itinerary}}const hotelIds=`${ocrDocument.id}-hotel-`;const itinerary=[...(trip.itinerary??[]).filter(item=>!item.id.startsWith(hotelIds)),...hotelItineraryItems(ocrDocument.id,ocrFields)];return {...trip,documents,itinerary,hotelDetails:{name:ocrFields.hotelName,address:ocrFields.address,postalCode:ocrFields.postalCode,phone:ocrFields.phone,checkInDate:ocrFields.checkInDate,checkInTime:ocrFields.checkInTime,checkOutDate:ocrFields.checkOutDate,checkOutTime:ocrFields.checkOutTime}}}));
    setSelectedDate(ocrDocument.kind==="ticket"?(ocrFields.departureDate||activeTrip.startDate):(ocrFields.checkInDate||activeTrip.startDate));setModal(null);setOcrDocument(null);if(ocrImageUrl)URL.revokeObjectURL(ocrImageUrl);setOcrImageUrl("");toast(ocrDocument.kind==="ticket"?"去程及回程時間已加入每日行程":"酒店資料及入住／退房時間已加入旅程");
  };
  const exportBackup=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),trips},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`TripLog-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("旅程備份已下載")};
  const loadCollaborators=async(tripId=activeTrip.id)=>{
    const trip=trips.find(item=>item.id===tripId);
    if(!supabase||!user||trip?.accessRole==="editor")return;
    const {data,error}=await supabase.rpc("triplog_list_collaborators",{p_trip_id:tripId});
    if(error){setCollaboratorMessage("同行功能尚待完成資料庫更新");return}
    setCollaborators((data??[]) as Collaborator[]);
  };
  const invitationUrl=(token:unknown)=>{const basePath=process.env.NEXT_PUBLIC_BASE_PATH??"";return `${window.location.origin}${basePath}/?trip_invite=${encodeURIComponent(String(token))}`};
  const openCompanionManager=(tripId=activeTrip.id)=>{setActiveTripId(tripId);setCollaboratorEmail("");setCollaboratorMessage("");setInviteShare(null);setModal("companion");void loadCollaborators(tripId)};
  const inviteCollaborator=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!supabase||!user||activeTrip.accessRole==="editor")return;
    const email=collaboratorEmail.trim().toLowerCase();
    if(email===user.email?.toLowerCase()){setCollaboratorMessage("你已經係旅程擁有人，唔使再邀請自己啦 😄");return}
    setCollaboratorBusy(true);setCollaboratorMessage("");
    const {data:token,error:createError}=await supabase.rpc("triplog_create_invitation",{p_trip_id:activeTrip.id,p_email:email});
    if(createError){setCollaboratorMessage(`未能建立邀請：${createError.message}`);setCollaboratorBusy(false);return}
    const redirectTo=invitationUrl(token);
    setInviteShare({email,url:redirectTo});
    const {error:mailError}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,shouldCreateUser:false}});
    setCollaboratorBusy(false);
    setCollaboratorEmail("");
    setCollaboratorMessage(mailError?"邀請已建立；電郵未能寄出，請用下方連結分享":"邀請已建立；已嘗試寄出電郵，亦可直接分享下方連結");
    await loadCollaborators();
  };
  const renewInvitationLink=async(email:string)=>{
    if(!supabase||!user||activeTrip.accessRole==="editor")return;
    setCollaboratorBusy(true);setCollaboratorMessage("");
    const {data:token,error}=await supabase.rpc("triplog_create_invitation",{p_trip_id:activeTrip.id,p_email:email});
    setCollaboratorBusy(false);
    if(error){setCollaboratorMessage(`未能產生邀請連結：${error.message}`);return}
    setInviteShare({email,url:invitationUrl(token)});
    setCollaboratorMessage("已產生新的邀請連結；舊連結已失效");
    await loadCollaborators();
  };
  const copyInvitationLink=async()=>{
    if(!inviteShare)return;
    try{await navigator.clipboard.writeText(inviteShare.url);setCollaboratorMessage("邀請連結已複製，可以傳給同行者")}
    catch{setCollaboratorMessage("未能自動複製，請長按下方連結手動複製")}
  };
  const shareInvitationOnWhatsApp=()=>{
    if(!inviteShare)return;
    const message=`${activeTrip.name}邀請你加入旅記 TripLog。請先建立或登入 ${inviteShare.email}，再開啟以下連結接受邀請：\n${inviteShare.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");
  };
  const revokeCollaborator=async(email:string)=>{
    if(!supabase||!window.confirm(`停止與 ${email} 共享這個旅程？`))return;
    const {error}=await supabase.rpc("triplog_revoke_collaborator",{p_trip_id:activeTrip.id,p_email:email});
    if(error){setCollaboratorMessage(`未能移除：${error.message}`);return}
    setCollaboratorMessage("同行權限已移除");await loadCollaborators();
  };
  const submitAuth=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!supabase)return;setAuthBusy(true);setAuthMessage("");if(authMode==="signUp"){const {data,error}=await supabase.auth.signUp({email:authEmail,password:authPassword,options:{emailRedirectTo:"https://marcoaispace-sudo.github.io/triplog/"}});setAuthMessage(error?error.message:data.session?"帳戶已建立，正在同步":"確認電郵已寄出，請按郵件內連結完成註冊")}else{const {error}=await supabase.auth.signInWithPassword({email:authEmail,password:authPassword});setAuthMessage(error?error.message:"登入成功，正在同步本機旅程")};setAuthBusy(false)};
  const signOut=async()=>{if(!supabase)return;await supabase.auth.signOut();setCloudReady(false);setCloudState("local");setAuthMessage("已登出；本機離線副本仍然保留");toast("已登出 Supabase")};

  return <main className="app-shell"><div className="phone-app">
    <header className="topbar"><button className="brand-button" onClick={()=>setActive("首頁")} aria-label="返回首頁"><Brand/></button><button className="icon-button" aria-label="通知" onClick={()=>toast("目前沒有新通知")}><Icon name="bell" size={21}/><span className="notification-dot"/></button></header>

    {active==="首頁"&&<>
      <section className="greeting"><div><p>晚上好，Man Tat</p><h2>下一站，{activeTrip.destination}。</h2></div><button className="all-trips-button" onClick={()=>setActive("旅程")}>全部旅程 <span>{trips.filter(t=>t.state==="active").length}</span></button></section>
      <button className="trip-card trip-card-button" onClick={()=>setActive("旅程")}><div className="trip-card-top"><div><span className="trip-status">即將出發</span><h3>{activeTrip.name}</h3><p>{dateLabel(activeTrip.startDate)} — {dateLabel(activeTrip.endDate)} · {tripDuration(activeTrip)}日</p></div><div className="countdown"><strong>{countdown(activeTrip)}</strong><span>日後</span></div></div><div className="route-line"><span className="airport">{activeTrip.origin}</span><span className="flight-line"><Icon name="plane" size={17}/></span><span className="airport">{activeTrip.destinationAirport}</span></div><div className="trip-meta"><span><Icon name="users" size={17}/>{activeTrip.companions} 位旅客</span><span>已記錄 <strong>{expenses.length} 筆開支</strong></span></div></button>
      <section className="quick-grid"><button className="quick-card primary" onClick={()=>pick("ticket")}><span className="quick-icon"><Icon name="plane"/></span><span><strong>上傳機票</strong><small>私人雲端保存</small></span><Icon name="arrow" size={18}/></button><button className="quick-card" onClick={()=>pick("receipt")}><span className="quick-icon receipt"><Icon name="receipt"/></span><span><strong>收據入帳</strong><small>拍照或從相簿選擇</small></span><Icon name="arrow" size={18}/></button></section>
      <section className="prep-card"><div className="section-heading"><div><p>出發前準備</p><h3>已完成 {completedRequirements} / {requirements.length} 項</h3></div><button onClick={()=>setActive("準備")}>查看全部</button></div><div className="progress-track"><span style={{width:`${prepPercent}%`}}/></div><button className={`prep-alert ${firstIncompleteRequirement?"":"complete"}`} onClick={()=>setActive("準備")}><span className="alert-icon"><Icon name={firstIncompleteRequirement?"sparkle":"check"} size={19}/></span><span><strong>{firstIncompleteRequirement?.title??"出發前準備已完成"}</strong><small>{firstIncompleteRequirement?.note??"記得在出發前再核對一次資料。"}</small></span><Icon name="arrow" size={18}/></button></section>
      <section className="day-section"><div className="section-heading day-heading"><div><p>第{homeDayNumber}日安排</p><h3>{activeTrip.destination}行程</h3></div><button className="recommend-button" onClick={()=>void openNearbyRecommendations()}><Icon name="pin" size={16}/>附近推介</button></div><Timeline items={homeDayItems} routeOrigin={hotelRouteOrigin} onMap={openMap} onDirections={openDirections}/></section>
    </>}

    {active==="旅程"&&<TripManager trips={trips} activeTripId={activeTrip.id} cloudState={cloudState} isSignedIn={Boolean(user)} onSelect={selectTrip} onAdd={()=>setModal("trip")} onArchive={id=>updateTripState(id,"archived")} onDelete={id=>updateTripState(id,"deleted")} onRestore={id=>updateTripState(id,"active")} onCompanions={openCompanionManager}/>} 
    {active==="準備"&&<section className="screen-content"><div className="page-title"><div><p>{activeTrip.name}</p><h2>出發前準備</h2></div><span className="completion-ring" style={{"--progress":`${prepPercent}%`} as React.CSSProperties}>{prepPercent}%</span></div><div className="info-banner"><Icon name="shield"/><div><strong>{activeTrip.destination}入境要求尚待即時核實</strong><p>清單會按目的地分類，但正式限制必須在出發前查閱官方最新資料。</p></div></div><h3 className="group-title">必須處理</h3><div className="requirement-list">{requirements.filter(item=>item.urgent).map(item=><article className={`task-card urgent ${item.done?"done":""}`} key={item.id}><div className="task-icon"><Icon name={item.done?"check":"sparkle"}/></div><div><span className={`badge ${item.done?"green":"red"}`}>{item.done?"已完成":"尚未完成"}</span><h3>{item.title}</h3><p>{item.note}</p><button onClick={()=>toggleRequirement(item.id)}>{item.done?"取消完成":"標記完成"}</button></div></article>)}</div><h3 className="group-title">旅程文件</h3><div className="document-grid"><button onClick={()=>pick("ticket")}><Icon name="plane"/><strong>機票</strong><span>{ticketDocuments.length?`${ticketDocuments.length} 個檔案・再上傳`:"按此上傳"}</span></button><button onClick={()=>pick("hotel")}><Icon name="hotel"/><strong>酒店</strong><span>{hotelDocuments.length?`${hotelDocuments.length} 個檔案・再上傳`:"按此上傳"}</span></button><article><Icon name="shield"/><strong>旅遊保險</strong><span>下一階段</span></article><article><Icon name="map"/><strong>離線地圖</strong><span>稍後提供</span></article></div>{(activeTrip.documents??[]).length>0&&<div className="stored-documents">{(activeTrip.documents??[]).map(document=><article key={document.id}><span className="stored-document-icon"><Icon name={document.kind==="ticket"?"plane":"hotel"} size={17}/></span><button className="stored-document-open" onClick={()=>void openDocument(document)}><strong>{document.name}</strong><small>{document.kind==="ticket"?"機票":"酒店"}・{Math.max(1,Math.round(document.size/1024))} KB{document.recognizedAt?"・已辨認":""}</small></button><button className="stored-document-ocr" aria-label={`辨認 ${document.name}`} onClick={()=>void recognizeDocument(document)}><Icon name="sparkle" size={15}/><span>{document.recognizedAt?"重辨":"辨認"}</span></button><button className="stored-document-delete" aria-label={`刪除 ${document.name}`} onClick={()=>void deleteDocument(document)}><Icon name="trash" size={16}/></button></article>)}</div>}{activeTrip.hotelDetails&&Object.values(activeTrip.hotelDetails).some(Boolean)&&<><h3 className="group-title">{isJapanDestination(activeTrip.destination)?"Visit Japan 填表資料":"住宿及入境填表資料"}</h3><article className="hotel-info-card"><header><span><Icon name="hotel" size={19}/></span><div><small>住宿資料</small><strong>{activeTrip.hotelDetails.name||"酒店名稱尚未辨認"}</strong></div></header><div className="hotel-stay-dates"><span><small>入住</small><strong>{activeTrip.hotelDetails.checkInDate?dateLabel(activeTrip.hotelDetails.checkInDate):"待填"} {activeTrip.hotelDetails.checkInTime||""}</strong></span><span><small>退房</small><strong>{activeTrip.hotelDetails.checkOutDate?dateLabel(activeTrip.hotelDetails.checkOutDate):"待填"} {activeTrip.hotelDetails.checkOutTime||""}</strong></span></div>{[["郵遞區號",activeTrip.hotelDetails.postalCode],["酒店地址",activeTrip.hotelDetails.address],["電話號碼",activeTrip.hotelDetails.phone]].map(([label,value])=><div className="hotel-copy-row" key={label}><span><small>{label}</small><strong>{value||"尚未辨認"}</strong></span><button onClick={()=>void copyText(label,value)} disabled={!value}>複製</button></div>)}</article></>}<h3 className="group-title">準備清單</h3><div className="check-list">{requirements.filter(item=>!item.urgent).map(item=><button key={item.id} className={item.done?"done":""} onClick={()=>toggleRequirement(item.id)}><span><Icon name="check" size={15}/></span><span className="check-copy"><strong>{item.title}</strong><small>{item.note}</small></span></button>)}</div></section>}
    {active==="行程"&&<section className="screen-content"><div className="page-title"><div><p>{dateLabel(activeTrip.startDate)} — {dateLabel(activeTrip.endDate)}</p><h2>每日行程</h2></div><button className="round-add" onClick={openNewItinerary} aria-label="新增行程"><Icon name="plus"/></button></div><div className="date-strip">{dates.map((date,index)=><button key={date} className={date===shownDate?"selected":""} onClick={()=>setSelectedDate(date)}><strong>{index+1}</strong><span>{weekdayLabel(date)}</span></button>)}</div><section className={`daily-weather-card ${weatherState}`} aria-live="polite"><span className="weather-glyph" aria-hidden="true">{shownWeatherText?.glyph??"☁"}</span><div><small>{activeTrip.hotelDetails?.name||weatherLocation||activeTrip.destination}・酒店所在地區</small>{weatherState==="loading"?<strong>正在讀取天氣…</strong>:weatherState==="error"?<strong>暫時未能取得天氣資料</strong>:shownWeather&&shownWeatherText?<strong>{shownWeatherText.label}<span>最高 {Math.round(shownWeather.max)}°・最低 {Math.round(shownWeather.min)}°</span></strong>:<strong>未到可靠預報範圍<span>接近出發日期會自動顯示</span></strong>}</div><em>Open-Meteo</em></section><section className={`day-section itinerary-panel main-drop-zone ${backupOverMain?"drag-over":""}`} data-main-dropzone onDragOver={event=>{event.preventDefault();setBackupOverMain(true)}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setBackupOverMain(false)}} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData("text/triplog-itinerary")||draggingBackupId;if(id)moveBackupToMain(id);else setBackupOverMain(false)}}><div className="section-heading day-heading"><div><p>{activeTrip.destination}・{dayItems.length}項安排</p><h3>第{selectedDayNumber}日・{dateLabel(shownDate)}</h3></div><button className="recommend-button" onClick={()=>void openNearbyRecommendations()}><Icon name="pin" size={16}/>附近推介</button></div>{backupOverMain&&<div className="drop-hint"><Icon name="plus" size={16}/>放手加入第{selectedDayNumber}日</div>}<Timeline items={dayItems} routeOrigin={hotelRouteOrigin} onEdit={openEditItinerary} onDelete={deleteItineraryItem} onMap={openMap} onDirections={openDirections}/></section><section className="backup-panel"><div className="backup-heading"><div><p>每一日共用・毋須預先安排日期時間</p><h3>備案行程</h3></div><span>{backupItems.length}</span></div>{backupItems.length===0?<div className="backup-empty"><Icon name="archive" size={22}/><p>新增行程時選擇「備案」，之後可在任何一日拖到上方主線。</p></div>:<div className="backup-list">{backupItems.map(item=><article key={item.id} className={`backup-item ${draggingBackupId===item.id?"dragging":""}`} draggable onDragStart={event=>{event.dataTransfer.setData("text/triplog-itinerary",item.id);event.dataTransfer.effectAllowed="move";setDraggingBackupId(item.id)}} onDragEnd={()=>{setDraggingBackupId(null);setBackupOverMain(false)}}><button type="button" className="backup-drag-handle" aria-label={`拖曳 ${item.title} 到主線行程`} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setDraggingBackupId(item.id)}} onPointerMove={event=>{if(draggingBackupId!==item.id)return;setBackupOverMain(Boolean(document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-main-dropzone]")))}} onPointerUp={event=>{const over=Boolean(document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-main-dropzone]"));event.currentTarget.releasePointerCapture(event.pointerId);if(over)moveBackupToMain(item.id);else{setDraggingBackupId(null);setBackupOverMain(false)}}}><span/><span/><span/></button><div className="backup-copy"><span>{item.type}・未排期</span><strong>{item.title}</strong>{item.location&&<small>{item.location}</small>}</div><div className="backup-actions">{canOpenMap(item)&&<button onClick={()=>openMap(item)} aria-label={`在地圖開啟 ${item.title}`}><Icon name="map" size={15}/></button>}<button onClick={()=>openEditItinerary(item)} aria-label={`編輯 ${item.title}`}><Icon name="edit" size={15}/></button><button className="backup-delete" onClick={()=>deleteItineraryItem(item.id)} aria-label={`刪除 ${item.title}`}><Icon name="trash" size={15}/></button><button className="backup-add" onClick={()=>moveBackupToMain(item.id)} aria-label={`加入第${selectedDayNumber}日`}><Icon name="plus" size={15}/></button></div></article>)}</div>}</section></section>}
    {active==="記帳"&&<section className="screen-content ledger-screen"><div className="page-title"><div><p>{activeTrip.name}</p><h2>旅行記帳</h2></div><div className="ledger-add-actions"><button className="round-add" onClick={()=>pick("receipt")} aria-label="手動新增帳目"><Icon name="plus"/></button><button className="round-add coral" onClick={()=>pick("receipt")} aria-label="拍攝收據入帳"><Icon name="camera"/></button></div></div>{expenses.length===0?<div className="empty-ledger"><Icon name="receipt"/><strong>尚未有帳目</strong><p>可手動新增、即時拍照，或從相簿選擇收據辨認。</p></div>:<><section className="expense-total-panel"><div><p>港幣開支總數</p><h3>HKD {hkdSpent.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</h3><small>{expenses.length} 筆帳目・外幣按入帳時填寫的匯率換算</small></div></section>{missingExchangeRateCount>0&&<button className="fx-warning" onClick={()=>openEditExpense(expenses.find(item=>item.currency!=="HKD"&&expenseHkdAmount(item)<=0)!)}><Icon name="edit" size={15}/><span>有 {missingExchangeRateCount} 筆外幣帳目待補匯率，暫未計入港幣總額及圓形圖。</span></button>}<div className="expense-chart-heading"><div><p>全部開支・統一港幣</p><h3>分類佔比圓形圖</h3></div></div><ExpensePieChart items={expenses}/><div className="ledger-summary"><span>{expenses.length} 筆帳目</span><strong>總數 HKD {hkdSpent.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div><div className="expense-list">{expenses.map(expense=>{const converted=expenseHkdAmount(expense);return <article className="expense-card" key={expense.id}><span className={`expense-category ${expense.category==="餐飲"?"food":""}`}><Icon name={expense.category==="交通"?"plane":expense.category==="住宿"?"hotel":expense.category==="購物"?"wallet":"receipt"} size={17}/></span><div className="expense-copy"><small>{dateLabel(expense.date)}・{expense.category}</small><strong>{expense.merchant}</strong><span>{expense.paidBy} 付款{expense.splitMode==="equal"?`・${expense.splitWith.length} 人平均分帳`:"・不分帳"}</span></div><div className="expense-amount"><strong>{expense.currency} {expense.amount.toLocaleString(undefined,{maximumFractionDigits:2})}</strong>{expense.currency!=="HKD"&&(converted>0?<small>≈ HKD {converted.toLocaleString(undefined,{maximumFractionDigits:2})}</small>:<small className="rate-missing">待補匯率</small>)}{expense.splitMode==="equal"&&expense.splitWith.length>0&&<small>每人 HKD {(converted/expense.splitWith.length).toLocaleString(undefined,{maximumFractionDigits:2})}</small>}</div><div className="expense-actions"><button className="view" onClick={()=>openViewExpense(expense)} aria-label={`檢視 ${expense.merchant}`}><Icon name="eye" size={14}/></button><button onClick={()=>openEditExpense(expense)} aria-label={`編輯 ${expense.merchant}`}><Icon name="edit" size={14}/></button><button className="danger" onClick={()=>void deleteExpense(expense)} aria-label={`刪除 ${expense.merchant}`}><Icon name="trash" size={14}/></button></div></article>})}</div></>}</section>}
    {active==="設定"&&<section className="screen-content"><div className="page-title"><div><p>個人使用</p><h2>設定</h2></div></div><article className="profile-card"><span>{user?(user.email?.slice(0,2).toUpperCase()??"MT"):"MT"}</span><div><strong>{user?.user_metadata?.full_name??(user?"TripLog 使用者":"Man Tat Ho")}</strong><p>{user?.email??"登入後啟用跨裝置同步"}</p></div><Icon name={user?"shield":"user"} size={19}/></article>
      {!user&&<section className="auth-card"><div><p>Supabase 私人帳戶</p><h3>{authMode==="signIn"?"登入並同步旅程":"建立 TripLog 登入帳戶"}</h3><span>呢個登入只供 TripLog App 使用，與 Supabase Dashboard 帳戶分開。</span></div><form className="auth-form" onSubmit={submitAuth}><label><span>電郵</span><input type="email" autoComplete="email" value={authEmail} onChange={event=>setAuthEmail(event.target.value)} required/></label><label><span>密碼</span><input type="password" autoComplete={authMode==="signIn"?"current-password":"new-password"} minLength={6} value={authPassword} onChange={event=>setAuthPassword(event.target.value)} required/></label><button type="submit" disabled={authBusy||!isSupabaseConfigured}>{authBusy?"處理中…":authMode==="signIn"?"登入並開始同步":"建立帳戶"}</button></form>{authMessage&&<p className="auth-message" role="status">{authMessage}</p>}<button className="auth-switch" onClick={()=>{setAuthMode(authMode==="signIn"?"signUp":"signIn");setAuthMessage("")}}>{authMode==="signIn"?"首次使用？建立帳戶":"已有帳戶？返回登入"}</button></section>}
      {user&&<section className="auth-card signed-in"><div><p>Supabase 私人帳戶</p><h3>{cloudState==="synced"?"雲端同步正常":cloudState==="connecting"?"正在同步資料":"雲端暫時未能同步"}</h3><span>本機旅程會保留作離線副本；重新連線後自動同步。</span></div>{authMessage&&<p className="auth-message" role="status">{authMessage}</p>}<button className="sign-out-button" onClick={signOut}>登出 Supabase</button></section>}
      <h3 className="group-title">資料與同步</h3><div className="settings-list"><button onClick={()=>toast(user?cloudState==="synced"?"所有旅程已安全同步":"正在重新同步":"請先在上方登入 Supabase")}><span className="setting-icon blue"><Icon name="cloud"/></span><div><strong>雲端同步</strong><small>{user?cloudState==="synced"?"旅程、行程、準備及共享資料已同步":"連接中，仍保留本機資料":"未登入・目前只儲存在此裝置"}</small></div><span className={cloudState==="synced"?"status-ok":"status-pending"}>{cloudState==="synced"?"正常":cloudState==="connecting"?"同步中":"待登入"}</span></button><button onClick={()=>toast(user?"相片會在裝置上免費辨認，確認後航班時間會加入每日行程":"登入後才可上傳私人文件")}><span className="setting-icon coral"><Icon name="upload"/></span><div><strong>文件儲存與辨認</strong><small>{user?"私人 Storage・航班時間自動加入行程":"登入後啟用私人 Storage"}</small></div><Icon name="arrow" size={18}/></button><button onClick={exportBackup}><span className="setting-icon gold"><Icon name="download"/></span><div><strong>匯出備份</strong><small>下載全部旅程 JSON 備份</small></div><Icon name="arrow" size={18}/></button><button onClick={()=>toast("只有獲邀同行者可編輯行程、準備及記帳；私人文件不會共享")}><span className="setting-icon green"><Icon name="shield"/></span><div><strong>私隱與權限</strong><small>私人文件＋同行者分級權限</small></div><Icon name="arrow" size={18}/></button></div><p className="version-note">旅記 TripLog・港幣統一記帳 v0.22</p></section>}

    <nav className="bottom-nav" aria-label="主要導覽">{[{label:"首頁",icon:"home"},{label:"準備",icon:"check"},{label:"行程",icon:"calendar"},{label:"記帳",icon:"wallet"},{label:"設定",icon:"user"}].map(i=><button key={i.label} className={active===i.label?"active":""} onClick={()=>setActive(i.label as Screen)}><Icon name={i.icon as IconName} size={21}/><span>{i.label}</span></button>)}</nav>
    {notice&&<div className="toast" role="status">{notice}</div>}

    {mapChoice&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{if(!mapChoiceBusy)setMapChoice(null)}}><section className="upload-modal map-provider-modal" role="dialog" aria-modal="true" aria-label="選擇地圖" onMouseDown={event=>event.stopPropagation()}><div className="modal-handle"/><button className="modal-close" disabled={mapChoiceBusy} onClick={()=>setMapChoice(null)}><Icon name="close"/></button><span className="modal-icon map-provider"><Icon name={mapChoice.mode==="place"?"map":"route"} size={29}/></span><h2>選擇地圖</h2><p>{mapChoice.mode==="place"?"開啟行程位置":"顯示上一個行程前往目前行程的路線"}</p><div className="map-provider-actions"><button disabled={mapChoiceBusy} onClick={()=>void launchMap("google")}><strong>Google Maps</strong><small>全球地圖及交通路線</small></button><button disabled={mapChoiceBusy} onClick={()=>void launchMap("naver")}><strong>Naver Map</strong><small>{mapChoice.mode==="directions"?"較適合韓國；會先定位兩個地點":"較適合韓國地址及地點"}</small></button></div>{mapChoiceMessage&&<p className="map-provider-message" role="status">{mapChoiceMessage}</p>}</section></div>}

    {modal==="trip"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><form className="upload-modal trip-form" onSubmit={createTrip} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className="modal-icon ticket"><Icon name="plane" size={30}/></span><h2>新增旅程</h2><p>新旅程會獨立保存，不會覆蓋原有旅程。</p><div className="form-grid"><label><span>目的地 *</span><input name="destination" placeholder="例如：大阪" required/></label><label><span>旅程名稱</span><input name="name" placeholder="預設為「大阪之旅」"/></label><label><span>出發日期 *</span><input name="startDate" type="date" required/></label><label><span>回程日期 *</span><input name="endDate" type="date" required/></label><label><span>出發機場</span><input name="origin" defaultValue="HKG" maxLength={3}/></label><label><span>抵達機場</span><input name="destinationAirport" placeholder="KIX" maxLength={3}/></label><label><span>旅客人數</span><input name="companions" type="number" min="1" defaultValue="1"/></label></div><button className="confirm-button" type="submit">建立旅程</button></form></div>}
    {modal==="companion"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><section className="upload-modal companion-modal" role="dialog" aria-modal="true" aria-label="同行旅伴" onMouseDown={event=>event.stopPropagation()}><div className="modal-handle"/><button className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className="modal-icon companion"><Icon name="users" size={29}/></span><h2>同行旅伴</h2><p>{activeTrip.name}・共同編輯每日行程、備案、出發前準備及記帳；私人文件與個人設定不會共享。</p>{isSharedEditor?<div className="shared-access-card"><Icon name="shield" size={21}/><div><strong>你是同行編輯者</strong><span>你的修改會同步給旅程擁有人。想查看對方最新修改，可重新整理共享旅程。</span></div><button onClick={()=>window.location.reload()}>重新整理</button></div>:<><form className="companion-form" onSubmit={inviteCollaborator}><label><span>同行者電郵</span><input type="email" value={collaboratorEmail} onChange={event=>setCollaboratorEmail(event.target.value)} placeholder="name@example.com" required/></label><button type="submit" disabled={collaboratorBusy}>{collaboratorBusy?"建立中…":"發送邀請"}</button></form>{collaboratorMessage&&<p className="companion-message" role="status">{collaboratorMessage}</p>}{inviteShare&&<section className="invite-share-card" aria-label="分享同行邀請"><div><strong>邀請 {inviteShare.email}</strong><small>連結 7 日內有效；對方必須用這個電郵登入。</small></div><input value={inviteShare.url} readOnly aria-label="同行邀請連結" onFocus={event=>event.currentTarget.select()}/><div className="invite-share-actions"><button type="button" onClick={()=>void copyInvitationLink()}><Icon name="copy" size={16}/>複製連結</button><button type="button" className="whatsapp-share" onClick={shareInvitationOnWhatsApp}><Icon name="share" size={16}/>WhatsApp</button></div></section>}<div className="collaborator-list">{collaborators.map(person=><article key={`${person.status}-${person.email}`}><span className={person.status}><Icon name={person.status==="active"?"check":"bell"} size={15}/></span><div><strong>{person.email}</strong><small>{person.status==="active"?"已加入・可共同編輯":"等待接受邀請"}</small></div><div className="collaborator-actions">{person.status==="pending"&&<button className="share-pending" disabled={collaboratorBusy} onClick={()=>void renewInvitationLink(person.email)}><Icon name="share" size={13}/>分享</button>}<button onClick={()=>void revokeCollaborator(person.email)}>{person.status==="active"?"移除":"取消"}</button></div></article>)}{!collaborators.length&&<div className="companion-empty"><Icon name="users" size={21}/><span>尚未加入同行旅伴</span></div>}</div><small className="invite-note">同行者開啟連結並以受邀電郵登入後，旅程才會正式同步。產生新連結會令舊連結失效。</small></>}</section></div>}
    {modal==="itinerary"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{setModal(null);setEditingItineraryId(null)}}><form key={editingItinerary?.id??"new-itinerary"} className="upload-modal trip-form itinerary-form" onSubmit={saveItineraryItem} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>{setModal(null);setEditingItineraryId(null)}}><Icon name="close"/></button><span className="modal-icon ticket"><Icon name={editingItinerary?"edit":"calendar"} size={29}/></span><h2>{editingItinerary?"編輯行程":"新增行程"}</h2><p>{activeTrip.name}・備案行程會在每一日共用，毋須日期時間。</p><div className="form-grid"><label><span>放置位置</span><select name="plan" value={itineraryPlan} onChange={event=>setItineraryPlan(event.target.value as "main"|"backup")}><option value="main">主線行程</option><option value="backup">備案行程（未排期）</option></select></label>{itineraryPlan==="main"&&<><label><span>日期 *</span><input name="date" type="date" min={activeTrip.startDate} max={activeTrip.endDate} defaultValue={editingItinerary?.date||shownDate} required/></label><label><span>時間 *</span><input name="time" type="time" defaultValue={editingItinerary?.time??""} required/></label></>}<label><span>名稱 *</span><input name="title" defaultValue={editingItinerary?.title??""} placeholder="例如：景福宮" required/></label><label><span>類別</span><select name="type" defaultValue={editingItinerary?.type??"景點"}><option>景點</option><option>餐廳</option><option>住宿</option><option>交通</option><option>購物</option><option>其他</option></select></label><label><span>地址／地圖搜尋名稱</span><input name="location" defaultValue={editingItinerary?.location??""} placeholder="例如：景福宮正門或完整地址"/></label><label><span>備註</span><textarea name="note" rows={3} defaultValue={editingItinerary?.note??""} placeholder="預約編號、集合資料或其他備註"/></label></div><button className="confirm-button" type="submit">{editingItinerary?"儲存更改":"加入行程"}</button></form></div>}
    {modal==="recommend"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><section className="upload-modal recommend-modal" role="dialog" aria-modal="true" aria-label="酒店附近推介" onMouseDown={event=>event.stopPropagation()}><div className="modal-handle"/><button className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className="modal-icon hotel"><Icon name="pin" size={29}/></span><h2>酒店附近推介</h2><p>以「{activeTrip.hotelDetails?.name||activeTrip.destination}」為中心搜尋；加入後會放入每一日共用的備案。</p>{nearbyBusy&&<div className="nearby-loading" role="status"><span/><strong>正在搜尋附近景點及餐廳…</strong></div>}{nearbyMessage&&<div className="nearby-message"><span>{nearbyMessage}</span><button onClick={()=>void openNearbyRecommendations()}>重新搜尋</button></div>}{nearbyPlaces.length>0&&<div className="nearby-list">{nearbyPlaces.map(place=>{const added=(activeTrip.itinerary??[]).some(item=>item.id===`google-place-${place.id}`);return <article key={place.id} className="nearby-card"><span className={`nearby-kind ${place.category==="餐廳"?"food":""}`}>{place.category}</span><div><strong>{place.name}</strong><small>{place.address}</small>{place.rating>0&&<em>★ {place.rating.toFixed(1)}{place.userRatingCount?`（${place.userRatingCount.toLocaleString()}）`:""}</em>}</div><div className="nearby-actions"><button aria-label={`在地圖開啟 ${place.name}`} onClick={()=>openMap({id:place.id,date:"",time:"",title:place.name,note:"",type:place.category,color:"blue",location:place.address})}><Icon name="map" size={15}/></button><button className="nearby-add" disabled={added} onClick={()=>addNearbyToBackup(place)}>{added?<Icon name="check" size={15}/>:<Icon name="plus" size={15}/>}</button></div></article>})}</div>}<small className="google-attribution">資料來源：Google Maps・請自行核對營業時間及預約安排</small></section></div>}
    {modal==="ocr"&&ocrDocument&&<div className="modal-backdrop" role="presentation"><form className="upload-modal trip-form ocr-modal" onSubmit={confirmOcr} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button type="button" className="modal-close" disabled={ocrBusy} onClick={()=>{setModal(null);if(ocrImageUrl)URL.revokeObjectURL(ocrImageUrl);setOcrImageUrl("")}}><Icon name="close"/></button><span className={`modal-icon ${ocrDocument.kind}`}><Icon name="sparkle" size={29}/></span><h2>{ocrDocument.kind==="ticket"?"辨認機票資料":"辨認酒店資料"}</h2><p>{ocrDocument.name}・相片文字會在你目前裝置上辨認。</p>{ocrBusy&&<div className="ocr-working" role="status"><div className="ocr-progress"><span style={{width:`${ocrProgress}%`}}/></div><strong>{ocrStatus}</strong><small>{ocrProgress}%・首次使用需要下載語言資料，請勿關閉。</small></div>}{ocrError&&<div className="ocr-error" role="alert"><strong>未能完成辨認</strong><span>{ocrError}</span><button type="button" onClick={()=>void recognizeDocument(ocrDocument)}>再試一次</button></div>}{!ocrBusy&&<><div className="ocr-warning"><Icon name="shield" size={17}/><span>{ocrDocument.kind==="ticket"?"免費 OCR 可能認錯；以下來回日期及時間會加入每日行程，請逐項核對。":"免費 OCR 可能認錯；請核對酒店、入住及退房資料，確認後會加入每日行程。"}</span></div><div className="form-grid ocr-form">{ocrDocument.kind==="ticket"?<><h3 className="ocr-section-title">去程</h3><label><span>去程航班編號</span><input value={ocrFields.flightNumber} onChange={e=>setOcrField("flightNumber",e.target.value.toUpperCase())} placeholder="例如 CX500"/></label><label><span>出發機場</span><input maxLength={3} value={ocrFields.origin} onChange={e=>setOcrField("origin",e.target.value.toUpperCase())} placeholder="HKG"/></label><label><span>抵達機場</span><input maxLength={3} value={ocrFields.destinationAirport} onChange={e=>setOcrField("destinationAirport",e.target.value.toUpperCase())} placeholder="NRT"/></label><label><span>去程出發日期</span><input type="date" value={ocrFields.departureDate} onChange={e=>setOcrField("departureDate",e.target.value)}/></label><label><span>去程出發時間</span><input type="time" value={ocrFields.outboundDepartureTime} onChange={e=>setOcrField("outboundDepartureTime",e.target.value)}/></label><label><span>去程到達日期</span><input type="date" value={ocrFields.outboundArrivalDate} onChange={e=>setOcrField("outboundArrivalDate",e.target.value)}/></label><label><span>去程到達時間</span><input type="time" value={ocrFields.outboundArrivalTime} onChange={e=>setOcrField("outboundArrivalTime",e.target.value)}/></label><h3 className="ocr-section-title">回程</h3><label><span>回程航班編號</span><input value={ocrFields.returnFlightNumber} onChange={e=>setOcrField("returnFlightNumber",e.target.value.toUpperCase())} placeholder="例如 CX501"/></label><label><span>回程出發日期</span><input type="date" value={ocrFields.returnDepartureDate} onChange={e=>setOcrField("returnDepartureDate",e.target.value)}/></label><label><span>回程出發時間</span><input type="time" value={ocrFields.returnDepartureTime} onChange={e=>setOcrField("returnDepartureTime",e.target.value)}/></label><label><span>回程到達日期</span><input type="date" value={ocrFields.returnArrivalDate} onChange={e=>setOcrField("returnArrivalDate",e.target.value)}/></label><label><span>回程到達時間</span><input type="time" value={ocrFields.returnArrivalTime} onChange={e=>setOcrField("returnArrivalTime",e.target.value)}/></label></>:<><label><span>酒店名稱</span><input value={ocrFields.hotelName} onChange={e=>setOcrField("hotelName",e.target.value)} placeholder="酒店名稱"/></label><label><span>郵遞區號</span><input value={ocrFields.postalCode} onChange={e=>setOcrField("postalCode",e.target.value)} placeholder="例如 160-0023"/></label><label><span>酒店地址</span><textarea rows={3} value={ocrFields.address} onChange={e=>setOcrField("address",e.target.value)} placeholder="酒店完整地址"/></label><label><span>電話號碼</span><input value={ocrFields.phone} onChange={e=>setOcrField("phone",e.target.value)} placeholder="酒店電話"/></label><div className="hotel-lookup"><button type="button" disabled={hotelLookupBusy} onClick={()=>void lookupHotel(ocrFields.hotelName)}><Icon name="search" size={16}/>{hotelLookupBusy?"正在搜尋…":"重新搜尋網上酒店資料"}</button>{hotelLookupMessage&&<p>{hotelLookupMessage}</p>}{hotelMatches.length>1&&<div className="hotel-match-list">{hotelMatches.map(match=><button type="button" key={match.id} onClick={()=>applyHotelMatch(match)}><strong>{match.name}</strong><small>{match.address}</small></button>)}</div>}{GOOGLE_MAPS_KEY&&<small className="google-attribution">資料來源：Google Maps</small>}</div><h3 className="ocr-section-title">住宿時間</h3><label><span>入住日期</span><input type="date" value={ocrFields.checkInDate} onChange={e=>setOcrField("checkInDate",e.target.value)}/></label><label><span>入住時間</span><input type="time" value={ocrFields.checkInTime} onChange={e=>setOcrField("checkInTime",e.target.value)}/></label><label><span>退房日期</span><input type="date" value={ocrFields.checkOutDate} onChange={e=>setOcrField("checkOutDate",e.target.value)}/></label><label><span>退房時間</span><input type="time" value={ocrFields.checkOutTime} onChange={e=>setOcrField("checkOutTime",e.target.value)}/></label></>}</div>{ocrImageUrl&&<details className="ocr-original"><summary>查看原圖並對照資料</summary><img src={ocrImageUrl} alt="酒店確認文件原圖"/></details>}{ocrRawText&&<details className="ocr-raw"><summary>查看原始辨認文字</summary><pre>{ocrRawText}</pre></details>}<button className="confirm-button" type="submit">確認並加入每日行程</button></>}</form></div>}
    {modal==="expenseView"&&viewingExpense&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{setModal(null);setViewingExpense(null);setSavedReceiptUrl("");setSavedReceiptStatus("")}}>
      <section className="upload-modal expense-detail-modal" role="dialog" aria-modal="true" aria-label="帳目詳情" onMouseDown={event=>event.stopPropagation()}>
        <div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>{setModal(null);setViewingExpense(null);setSavedReceiptUrl("");setSavedReceiptStatus("")}}><Icon name="close"/></button>
        <span className="modal-icon receipt"><Icon name="eye" size={29}/></span><h2>帳目詳情</h2><p>{dateLabel(viewingExpense.date)}・{viewingExpense.category}</p>
        <div className="expense-detail-hero"><span>{viewingExpense.merchant}</span><strong>{viewingExpense.currency} {viewingExpense.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><small>折合 HKD {expenseHkdAmount(viewingExpense).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</small></div>
        <dl className="expense-detail-grid">
          <div><dt>付款人</dt><dd>{viewingExpense.paidBy||"未填"}</dd></div>
          <div><dt>分帳方式</dt><dd>{viewingExpense.splitMode==="equal"?`${viewingExpense.splitWith.length} 人平均分帳`:"不分帳"}</dd></div>
          {viewingExpense.currency!=="HKD"&&<div><dt>入帳匯率</dt><dd>1 {viewingExpense.currency} = {Number(viewingExpense.exchangeRate||0).toLocaleString(undefined,{maximumFractionDigits:6})} HKD</dd></div>}
          {viewingExpense.splitMode==="equal"&&<div className="wide"><dt>參與分帳</dt><dd>{viewingExpense.splitWith.join("、")||"未選擇"}</dd></div>}
          <div className="wide"><dt>備註</dt><dd>{viewingExpense.note||"沒有備註"}</dd></div>
        </dl>
        {viewingExpense.receiptPath&&<section className="saved-receipt-card"><div><Icon name="receipt" size={18}/><span><strong>收據原圖</strong><small>{viewingExpense.receiptName||"私人收據相片"}</small></span></div>{savedReceiptStatus&&<p>{savedReceiptStatus}</p>}{savedReceiptUrl&&<a href={savedReceiptUrl} target="_blank" rel="noopener noreferrer"><img src={savedReceiptUrl} alt={`${viewingExpense.merchant} 收據原圖`}/><span>按圖放大查看</span></a>}</section>}
        {!viewingExpense.receiptPath&&<div className="no-receipt-note"><Icon name="receipt" size={18}/><span>這筆帳目沒有上傳收據原圖</span></div>}
        <button type="button" className="confirm-button" onClick={()=>openEditExpense(viewingExpense)}><Icon name="edit" size={16}/>編輯帳目</button>
      </section>
    </div>}
    {modal==="expense"&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}>
      <form className="upload-modal trip-form expense-form" onSubmit={saveExpense} onMouseDown={event=>event.stopPropagation()}>
        <div className="modal-handle"/><button type="button" className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button>
        <span className="modal-icon receipt"><Icon name={editingExpenseId?"edit":"receipt"} size={29}/></span><h2>{editingExpenseId?"編輯帳目":"新增帳目"}</h2>
        <p>{editingExpenseId?"可按原圖核對資料；辨認唔到的商戶、金額及備註都可以手動補填。":"可以手動填寫，亦可即時拍照或從相簿選擇收據；外幣可輸入匯率，亦可直接填大約港幣金額。"}</p>
        {!editingExpenseId&&<><input ref={receiptCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event=>chooseReceiptFile(event.target.files?.[0]??null)}/><input ref={receiptLibraryRef} type="file" accept="image/*" hidden onChange={event=>chooseReceiptFile(event.target.files?.[0]??null)}/>{receiptPreviewUrl?<button type="button" className="receipt-picker selected" onClick={()=>receiptLibraryRef.current?.click()}><img src={receiptPreviewUrl} alt="待辨認收據"/><span className="replace-receipt">更換相片</span></button>:<div className="receipt-source-actions"><button type="button" onClick={()=>receiptCameraRef.current?.click()}><Icon name="camera"/><strong>即時拍照</strong><small>開啟相機拍攝收據</small></button><button type="button" onClick={()=>receiptLibraryRef.current?.click()}><Icon name="upload"/><strong>從相簿選擇</strong><small>揀選已有收據相片</small></button></div>}{pickedFile&&<button type="button" className="receipt-recognize" disabled={receiptBusy} onClick={()=>void recognizeReceipt()}><Icon name="sparkle" size={16}/>{receiptBusy?`正在辨認 ${receiptProgress}%`:"辨認商戶、日期及總額"}</button>}</>}
        {editingExpenseId&&(savedReceiptUrl||savedReceiptStatus)&&<section className="saved-receipt-card edit-receipt"><div><Icon name="receipt" size={18}/><span><strong>已保存收據原圖</strong><small>{expenses.find(item=>item.id===editingExpenseId)?.receiptName||"私人收據相片"}</small></span></div>{savedReceiptStatus&&<p>{savedReceiptStatus}</p>}{savedReceiptUrl&&<a href={savedReceiptUrl} target="_blank" rel="noopener noreferrer"><img src={savedReceiptUrl} alt="已保存收據原圖"/><span>按圖放大對照</span></a>}</section>}
        <div className="form-grid expense-fields">
          <label><span>商戶／項目 *</span><input value={expenseDraft.merchant} onChange={event=>setExpenseField("merchant",event.target.value)} placeholder="例如：韓國烤肉晚餐" required/></label>
          <label><span>日期 *</span><input type="date" min={activeTrip.startDate} max={activeTrip.endDate} value={expenseDraft.date} onChange={event=>setExpenseField("date",event.target.value)} required/></label>
          <label><span>類別</span><select value={expenseDraft.category} onChange={event=>setExpenseField("category",event.target.value)}><option>餐飲</option><option>交通</option><option>住宿</option><option>購物</option><option>景點</option><option>其他</option></select></label>
          <label><span>貨幣</span><select value={expenseDraft.currency} onChange={event=>{const currency=event.target.value;setConversionMode("rate");setExpenseDraft(current=>({...current,currency,exchangeRate:currency==="HKD"?"1":currency===current.currency?current.exchangeRate:"",hkdAmount:""}))}}><option>HKD</option><option>JPY</option><option>KRW</option><option>TWD</option><option>USD</option><option>EUR</option><option>CNY</option></select></label>
          <label><span>原幣金額 *</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={expenseDraft.amount||""} onChange={event=>setExpenseField("amount",Number(event.target.value))} required/></label>
          {expenseDraft.currency!=="HKD"&&<>
            <div className="conversion-mode-switch" role="group" aria-label="外幣換算方式"><button type="button" className={conversionMode==="rate"?"selected":""} onClick={()=>setConversionMode("rate")}>輸入匯率</button><button type="button" className={conversionMode==="hkd"?"selected":""} onClick={()=>setConversionMode("hkd")}>直接輸入港幣</button></div>
            {conversionMode==="rate"?<label className="exchange-rate-field"><span>當時匯率（1 {expenseDraft.currency} = 幾多 HKD）*</span><input type="number" min="0.000001" step="any" inputMode="decimal" value={expenseDraft.exchangeRate} onChange={event=>setExpenseField("exchangeRate",event.target.value)} placeholder="例如：0.0053" required/><small>可以輸入 0.00 開頭的小數；完成後才會計算。</small></label>:<label className="direct-hkd-field"><span>大約港幣金額 *</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={expenseDraft.hkdAmount} onChange={event=>setExpenseField("hkdAmount",event.target.value)} placeholder="例如：128.50" required/><small>可按信用卡通知或付款紀錄，直接填大約扣帳港幣。</small></label>}
          </>}
          <div className="exchange-preview"><span>換算後港幣</span><strong>HKD {(expenseDraft.currency!=="HKD"&&conversionMode==="hkd"?Number(expenseDraft.hkdAmount||0):Number(expenseDraft.amount||0)*(expenseDraft.currency==="HKD"?1:Number(expenseDraft.exchangeRate||0))).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
          <label><span>付款人</span><select value={expenseDraft.paidBy} onChange={event=>setExpenseField("paidBy",event.target.value)}>{expenseParticipants.map(person=><option key={person} value={person}>{person===user?.email?.toLowerCase()?"我":person}</option>)}</select></label>
          <label><span>分帳方式</span><select value={expenseDraft.splitMode} onChange={event=>{const mode=event.target.value as Expense["splitMode"];setExpenseDraft(current=>({...current,splitMode:mode,splitWith:mode==="equal"?(current.splitWith.length?current.splitWith:expenseParticipants):[]}))}}><option value="none">不分帳</option><option value="equal">同行者平均分帳</option></select></label>
          {expenseDraft.splitMode==="equal"&&<fieldset className="split-people"><legend>參與分帳的人</legend>{expenseParticipants.map(person=><label key={person}><input type="checkbox" checked={expenseDraft.splitWith.includes(person)} onChange={()=>toggleSplitPerson(person)}/><span>{person===user?.email?.toLowerCase()?"我":person}</span></label>)}</fieldset>}
          <label><span>備註（可手動補填）</span><textarea rows={3} value={expenseDraft.note} onChange={event=>setExpenseField("note",event.target.value)} placeholder="例如：OCR 未辨認內容、晚餐、訂座或退款資料"/></label>
        </div>
        {receiptRawText&&<details className="ocr-raw"><summary>查看收據原始辨認文字</summary><pre>{receiptRawText}</pre></details>}<button className="confirm-button" type="submit" disabled={expenseSaving}>{expenseSaving?"正在保存收據原圖…":editingExpenseId?"儲存更改":"確認入帳"}</button>
      </form>
    </div>}
    {(modal==="ticket"||modal==="hotel")&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setModal(null)}><section className="upload-modal" role="dialog" aria-modal="true" aria-label={modal==="ticket"?"上傳機票":"上傳酒店資料"} onMouseDown={e=>e.stopPropagation()}><div className="modal-handle"/><button className="modal-close" onClick={()=>setModal(null)}><Icon name="close"/></button><span className={`modal-icon ${modal}`}><Icon name={modal==="ticket"?"plane":"hotel"} size={30}/></span><h2>{modal==="ticket"?"上傳機票":"上傳酒店確認資料"}</h2><p>檔案會儲存在你嘅私人 Supabase 空間；上傳後可免費辨認相片文字。</p><input ref={fileRef} type="file" accept="image/*,.pdf" hidden onChange={e=>{const file=e.target.files?.[0]??null;setPickedFile(file);setPicked(file?.name??"")}}/><button className="upload-zone" onClick={()=>fileRef.current?.click()}><Icon name="upload"/><strong>{picked||(modal==="hotel"?"選擇酒店確認檔案":"選擇機票檔案")}</strong><span>{picked?"準備上傳到私人空間":"相片可辨認；PDF 可保存但暫不可辨認・上限 10MB"}</span></button>{picked&&<button className="confirm-button" disabled={uploadBusy} onClick={()=>void uploadDocument()}>{uploadBusy?"正在安全上傳…":"確認上傳"}</button>}</section></div>}
  </div></main>
}
