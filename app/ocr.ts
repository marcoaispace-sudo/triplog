export type OcrFields = {
  flightNumber: string;
  departureDate: string;
  origin: string;
  destinationAirport: string;
  hotelName: string;
  address: string;
  postalCode: string;
  phone: string;
};

export const emptyOcrFields: OcrFields = {
  flightNumber: "",
  departureDate: "",
  origin: "",
  destinationAirport: "",
  hotelName: "",
  address: "",
  postalCode: "",
  phone: "",
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

function extractDate(text: string) {
  let match = text.match(/\b(20\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})(?:日)?\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(20\d{2})\b/i);
  if (match) return isoDate(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  match = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*,?\s*(20\d{2})\b/i);
  if (match) return isoDate(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  match = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return "";
}

function cleanValue(value = "") {
  return value.replace(/\s+/g, " ").replace(/^[\s:：-]+|[\s|]+$/g, "").trim();
}

export function extractOcrFields(text: string): OcrFields {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n").map(cleanValue).filter(Boolean);
  const flightLabel = normalized.match(/(?:flight|flight no|航班|便名|항공편)[^A-Z0-9]{0,12}([A-Z0-9]{2,3})\s*[- ]?\s*(\d{2,4})/i);
  const genericFlights = [...normalized.toUpperCase().matchAll(/\b([A-Z0-9]{2,3})\s*[- ]?\s*(\d{2,4})\b/g)]
    .map(match => `${match[1]}${match[2]}`)
    .filter(value => /[A-Z]/.test(value) && !/^20\d{2}$/.test(value));
  const airportCodes = [...new Set((normalized.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []).filter(code => AIRPORT_CODES.has(code)))];
  const hotelLine = lines.find(line => /hotel|resort|inn|hostel|酒店|飯店|旅館|ホテル|리조트|호텔/i.test(line) && line.length <= 100) ?? "";
  const addressLabel = normalized.match(/(?:address|地址|住所|주소)\s*[:：-]?\s*([^\n]{5,140})/i);
  const postal = normalized.match(/(?:〒\s*)?(\d{3}-\d{4})\b/) ?? normalized.match(/(?:postal|zip|postcode|郵遞區號|우편번호)\D{0,8}(\d{5,7})/i);
  const phone = normalized.match(/(?:tel(?:ephone)?|phone|電話|전화|연락처)\s*[:：-]?\s*(\+?[\d][\d\s().-]{7,24})/i);
  return {
    ...emptyOcrFields,
    flightNumber: flightLabel ? `${flightLabel[1]}${flightLabel[2]}`.toUpperCase() : (genericFlights[0] ?? ""),
    departureDate: extractDate(normalized),
    origin: airportCodes[0] ?? "",
    destinationAirport: airportCodes[1] ?? "",
    hotelName: cleanValue(hotelLine),
    address: cleanValue(addressLabel?.[1]),
    postalCode: cleanValue(postal?.[1]),
    phone: cleanValue(phone?.[1]),
  };
}

export function ocrLanguages(destination: string) {
  const place = destination.toLowerCase();
  if (/日本|東京|大阪|京都|福岡|札幌|沖繩|名古屋|神戶|奈良|北海道|tokyo|osaka|kyoto|japan/.test(place)) return ["eng", "jpn"];
  if (/韓國|南韓|首爾|釜山|濟州|seoul|busan|jeju|korea/.test(place)) return ["eng", "kor"];
  return ["eng", "chi_tra"];
}
