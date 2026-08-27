export type OcrFields = {
  flightNumber: string;
  departureDate: string;
  outboundDepartureTime: string;
  outboundArrivalDate: string;
  outboundArrivalTime: string;
  returnFlightNumber: string;
  returnDepartureDate: string;
  returnDepartureTime: string;
  returnArrivalDate: string;
  returnArrivalTime: string;
  origin: string;
  destinationAirport: string;
  hotelName: string;
  address: string;
  postalCode: string;
  phone: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
};

export const emptyOcrFields: OcrFields = {
  flightNumber: "",
  departureDate: "",
  outboundDepartureTime: "",
  outboundArrivalDate: "",
  outboundArrivalTime: "",
  returnFlightNumber: "",
  returnDepartureDate: "",
  returnDepartureTime: "",
  returnArrivalDate: "",
  returnArrivalTime: "",
  origin: "",
  destinationAirport: "",
  hotelName: "",
  address: "",
  postalCode: "",
  phone: "",
  checkInDate: "",
  checkInTime: "",
  checkOutDate: "",
  checkOutTime: "",
};

type OcrLoggerMessage = {progress?:number;status:string};
type OcrWorker = {
  recognize:(image:Blob)=>Promise<{data:{text:string}}>;
  terminate:()=>Promise<unknown>;
};

declare global {
  interface Window {
    Tesseract?: {
      createWorker:(langs?:string|string[],oem?:number,options?:{logger?:(message:OcrLoggerMessage)=>void})=>Promise<OcrWorker>;
    };
  }
}

let tesseractLoader:Promise<NonNullable<Window["Tesseract"]>>|null=null;

export function loadOcrEngine(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  if(tesseractLoader)return tesseractLoader;
  tesseractLoader=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
    script.async=true;
    script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error("OCR 引擎載入失敗"));
    script.onerror=()=>reject(new Error("未能下載 OCR 引擎，請檢查網絡後再試"));
    document.head.appendChild(script);
  });
  return tesseractLoader;
}

export async function createOcrWorker(langs:string[],logger:(message:OcrLoggerMessage)=>void){
  const engine=await loadOcrEngine();
  return engine.createWorker(langs,1,{logger});
}

const AIRPORT_CODES = new Set([
  "HKG", "ICN", "GMP", "PUS", "CJU", "NRT", "HND", "KIX", "ITM",
  "FUK", "CTS", "OKA", "NGO", "TPE", "TSA", "SIN", "BKK", "DMK",
  "KUL", "MNL", "CEB", "SGN", "HAN", "DAD", "PEK", "PKX", "PVG",
  "SHA", "CAN", "SZX", "MFM", "LHR", "LGW", "CDG", "AMS", "FRA",
  "JFK", "EWR", "LAX", "SFO", "SEA", "YVR", "SYD", "MEL",
]);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDates(text: string) {
  const found:{index:number;value:string}[]=[];
  const add=(match:RegExpExecArray,value:string)=>{if(value)found.push({index:match.index,value})};
  let match:RegExpExecArray|null;
  const iso=/(20\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})(?:日)?/g;
  while((match=iso.exec(text)))add(match,isoDate(Number(match[1]),Number(match[2]),Number(match[3])));
  const dayFirst=/(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(20\d{2})/gi;
  while((match=dayFirst.exec(text)))add(match,isoDate(Number(match[3]),MONTHS[match[2].toLowerCase()],Number(match[1])));
  const monthFirst=/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*,?\s*(20\d{2})/gi;
  while((match=monthFirst.exec(text)))add(match,isoDate(Number(match[3]),MONTHS[match[1].toLowerCase()],Number(match[2])));
  const numeric=/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/g;
  while((match=numeric.exec(text)))add(match,isoDate(Number(match[3]),Number(match[2]),Number(match[1])));
  return found.sort((a,b)=>a.index-b.index).map(item=>item.value).filter((value,index,list)=>list.indexOf(value)===index).slice(0,4);
}

function extractTimes(text:string){
  const withoutNumericDates=text
    .replace(/20\d{2}[年./-]\s*\d{1,2}[月./-]\s*\d{1,2}(?:日)?/g," ")
    .replace(/\d{1,2}[./-]\d{1,2}[./-]20\d{2}/g," ");
  return [...withoutNumericDates.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g)]
    .map(match=>`${String(Number(match[1])).padStart(2,"0")}:${match[2]}`)
    .filter((value,index,list)=>list.indexOf(value)===index)
    .slice(0,4);
}

function cleanValue(value = "") {
  return value.replace(/\s+/g, " ").replace(/^[\s:：-]+|[\s|]+$/g, "").trim();
}

function extractLabeledDateTime(text:string,label:RegExp){
  const lines=text.split("\n");
  const lineIndex=lines.findIndex(line=>label.test(line));
  if(lineIndex<0)return {date:"",time:""};
  const nearby=lines.slice(lineIndex,Math.min(lines.length,lineIndex+3)).join(" ");
  return {date:extractDates(nearby)[0]??"",time:extractTimes(nearby)[0]??""};
}

export function extractOcrFields(text: string): OcrFields {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n").map(cleanValue).filter(Boolean);
  const flightLabel = normalized.match(/(?:flight|flight no|航班|便名|항공편)[^A-Z0-9]{0,12}([A-Z0-9]{2,3})\s*[- ]?\s*(\d{2,4})/i);
  const genericFlights = [...normalized.toUpperCase().matchAll(/\b([A-Z0-9]{2})\s*[- ]?\s*(\d{2,4})\b/g)]
    .map(match => `${match[1]}${match[2]}`)
    .filter(value => /[A-Z]/.test(value) && !/^20\d{2}$/.test(value));
  const airportCodes = [...new Set((normalized.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []).filter(code => AIRPORT_CODES.has(code)))];
  const labeledHotel=normalized.match(/(?:hotel name|property|accommodation|酒店名稱|飯店名稱|施設名|ホテル名|숙소 이름|호텔명)\s*[:：-]?\s*([^\n]{2,100})/i);
  const hotelLine = cleanValue(labeledHotel?.[1])||(lines.find(line => /hotel|resort|inn|hostel|酒店|飯店|旅館|ホテル|リゾート|리조트|호텔/i.test(line)&&!/address|地址|住所|주소|booking|confirmation/i.test(line)&&line.length<=100)??"");
  const addressLabel = normalized.match(/(?:address|地址|住所|주소)\s*[:：-]?\s*([^\n]{5,140})/i);
  const postal = normalized.match(/(?:postal(?: code)?|zip(?: code)?|postcode|郵遞區號|郵便番号|우편번호)\D{0,8}(\d{3}-\d{4}|\d{5,7})/i) ?? normalized.match(/〒\s*(\d{3}-\d{4})\b/);
  const phone = normalized.match(/(?:tel(?:ephone)?|phone|電話|전화|연락처)\s*[:：-]?\s*(\+?[\d][\d\s().-]{7,24})/i);
  const dates=extractDates(normalized);
  const times=extractTimes(normalized);
  const checkIn=extractLabeledDateTime(normalized,/(?:check[ -]?in|入住|チェックイン|체크인)/i);
  const checkOut=extractLabeledDateTime(normalized,/(?:check[ -]?out|退房|チェックアウト|체크아웃)/i);
  const outboundDate=dates[0]??"";
  const outboundArrivalDate=dates.length>=4?(dates[1]??outboundDate):outboundDate;
  const returnDepartureDate=dates.length>=4?(dates[2]??""):(dates[1]??"");
  const returnArrivalDate=dates.length>=4?(dates[3]??returnDepartureDate):returnDepartureDate;
  return {
    ...emptyOcrFields,
    flightNumber: flightLabel ? `${flightLabel[1]}${flightLabel[2]}`.toUpperCase() : (genericFlights[0] ?? ""),
    departureDate: outboundDate,
    outboundDepartureTime: times[0]??"",
    outboundArrivalDate,
    outboundArrivalTime: times[1]??"",
    returnFlightNumber: genericFlights.find(value=>value!==(flightLabel?`${flightLabel[1]}${flightLabel[2]}`.toUpperCase():genericFlights[0]))??"",
    returnDepartureDate,
    returnDepartureTime: times[2]??"",
    returnArrivalDate,
    returnArrivalTime: times[3]??"",
    origin: airportCodes[0] ?? "",
    destinationAirport: airportCodes[1] ?? "",
    hotelName: cleanValue(hotelLine),
    address: cleanValue(addressLabel?.[1]),
    postalCode: cleanValue(postal?.[1]),
    phone: cleanValue(phone?.[1]),
    checkInDate: checkIn.date,
    checkInTime: checkIn.time,
    checkOutDate: checkOut.date,
    checkOutTime: checkOut.time,
  };
}

export type ReceiptOcrFields = {merchant:string;date:string;amount:string;currency:string;rawText:string};

export function extractReceiptOcrFields(text:string):ReceiptOcrFields{
  const normalized=text.replace(/\r/g,"");
  const lines=normalized.split("\n").map(cleanValue).filter(Boolean);
  const ignored=/^(receipt|invoice|tax invoice|收據|發票|영수증|領収書|tel|電話|address|地址)\b/i;
  const merchant=lines.find(line=>line.length>=2&&line.length<=70&&!ignored.test(line)&&!/^\d[\d\s./:-]+$/.test(line))??"";
  const labeled=[...normalized.matchAll(/(?:grand\s*total|amount\s*due|total|合計|總計|總額|應付|합계|총액|お会計|合計金額)\s*[:：]?\s*(?:HKD|HK\$|USD|US\$|JPY|¥|KRW|₩|TWD|NT\$|\$)?\s*([\d,.]+)/gi)];
  const fallback=[...normalized.matchAll(/(?:HKD|HK\$|USD|US\$|JPY|¥|KRW|₩|TWD|NT\$|\$)\s*([\d,.]+)/gi)];
  const values=(labeled.length?labeled:fallback).map(match=>Number(match[1].replace(/,/g,""))).filter(value=>Number.isFinite(value)&&value>0);
  const amount=values.length?String(values.at(-1)):"";
  const currency=/HKD|HK\$/i.test(normalized)?"HKD":/USD|US\$/i.test(normalized)?"USD":/JPY|¥|円/.test(normalized)?"JPY":/KRW|₩|원/.test(normalized)?"KRW":/TWD|NT\$/i.test(normalized)?"TWD":"HKD";
  return {merchant,date:extractDates(normalized)[0]??"",amount,currency,rawText:normalized};
}

export function ocrLanguages(destination: string) {
  const place = destination.toLowerCase();
  if (/日本|東京|大阪|京都|福岡|札幌|沖繩|名古屋|神戶|奈良|北海道|tokyo|osaka|kyoto|japan/.test(place)) return ["eng", "jpn"];
  if (/韓國|南韓|首爾|釜山|濟州|seoul|busan|jeju|korea/.test(place)) return ["eng", "kor"];
  return ["eng", "chi_tra"];
}
