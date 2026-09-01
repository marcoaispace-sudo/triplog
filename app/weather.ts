export type DailyWeather = {
  date: string;
  code: number;
  max: number;
  min: number;
};

export type WeatherLocation = {
  latitude: number;
  longitude: number;
  label: string;
};

const DESTINATION_ALIASES:Array<[RegExp,string]> = [
  [/首爾|首尔|서울|seoul/i,"Seoul"],
  [/釜山|부산|busan/i,"Busan"],
  [/仁川|인천|incheon/i,"Incheon"],
  [/濟州|济州|제주|jeju/i,"Jeju"],
  [/大邱|대구|daegu/i,"Daegu"],
  [/東京|东京|tokyo/i,"Tokyo"],
  [/大阪|osaka/i,"Osaka"],
  [/京都|kyoto/i,"Kyoto"],
  [/福岡|福冈|fukuoka/i,"Fukuoka"],
  [/札幌|sapporo/i,"Sapporo"],
  [/沖繩|冲绳|okinawa/i,"Naha"],
  [/名古屋|nagoya/i,"Nagoya"],
  [/神戶|神户|kobe/i,"Kobe"],
  [/奈良|nara/i,"Nara"],
  [/香港|hong\s*kong/i,"Hong Kong"],
  [/台北|臺北|taipei/i,"Taipei"],
  [/台中|臺中|taichung/i,"Taichung"],
  [/高雄|kaohsiung/i,"Kaohsiung"],
  [/曼谷|bangkok/i,"Bangkok"],
  [/新加坡|singapore/i,"Singapore"],
];

type GeocodingResult = {
  name?: string;
  admin1?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

export function weatherDescription(code:number){
  if(code===0)return {label:"晴朗",glyph:"☀"};
  if(code===1||code===2)return {label:"大致天晴",glyph:"⛅"};
  if(code===3)return {label:"多雲",glyph:"☁"};
  if(code===45||code===48)return {label:"有霧",glyph:"🌫"};
  if(code>=51&&code<=57)return {label:"毛毛雨",glyph:"🌦"};
  if((code>=61&&code<=67)||(code>=80&&code<=82))return {label:"有雨",glyph:"🌧"};
  if((code>=71&&code<=77)||(code>=85&&code<=86))return {label:"有雪",glyph:"❄"};
  if(code>=95)return {label:"雷暴",glyph:"⛈"};
  return {label:"天氣資料",glyph:"☁"};
}

async function geocode(query:string,signal:AbortSignal):Promise<WeatherLocation|null>{
  const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=zh&format=json`,{signal});
  if(!response.ok)throw new Error("geocoding failed");
  const payload=await response.json() as {results?:GeocodingResult[]};
  const result=payload.results?.[0];
  if(!result||typeof result.latitude!=="number"||typeof result.longitude!=="number")return null;
  return {latitude:result.latitude,longitude:result.longitude,label:[result.name,result.admin1,result.country].filter(Boolean).join("・")};
}

export function weatherQueryCandidates(queries:string[]){
  const source=[...new Set(queries.map(value=>value.trim()).filter(Boolean))];
  const aliases=source.flatMap(query=>DESTINATION_ALIASES.filter(([pattern])=>pattern.test(query)).map(([,alias])=>alias));
  return [...new Set([...source,...aliases])];
}

async function forecast(location:WeatherLocation,signal:AbortSignal){
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",String(location.latitude));
  url.searchParams.set("longitude",String(location.longitude));
  url.searchParams.set("daily","weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone","auto");
  url.searchParams.set("forecast_days","16");
  url.searchParams.set("past_days","7");
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error("forecast failed");
  const payload=await response.json() as {daily?:{time?:string[];weather_code?:number[];weathercode?:number[];temperature_2m_max?:number[];temperature_2m_min?:number[]}};
  const daily=payload.daily;
  const codes=daily?.weather_code??daily?.weathercode??[];
  const days=(daily?.time??[]).map((date,index)=>({date,code:Number(codes[index]),max:Number(daily?.temperature_2m_max?.[index]),min:Number(daily?.temperature_2m_min?.[index])})).filter(day=>Number.isFinite(day.code)&&Number.isFinite(day.max)&&Number.isFinite(day.min));
  return {location,days};
}

export async function loadDailyWeatherAtCoordinates(latitude:number,longitude:number,label:string,signal:AbortSignal){
  return forecast({latitude,longitude,label},signal);
}

export async function loadDailyWeather(queries:string[],signal:AbortSignal){
  let location:WeatherLocation|null=null;
  for(const query of weatherQueryCandidates(queries)){
    location=await geocode(query,signal);
    if(location)break;
  }
  if(!location)throw new Error("location not found");
  return forecast(location,signal);
}
