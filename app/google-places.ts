export type HotelPlaceResult={
  id:string;
  name:string;
  address:string;
  postalCode:string;
  phone:string;
};

export type NearbyPlaceResult={
  id:string;
  name:string;
  address:string;
  rating:number;
  userRatingCount:number;
  category:"景點"|"餐廳";
};

type AddressComponent={longText?:string;types?:string[]};
type GooglePlace={id?:string;displayName?:string;formattedAddress?:string;nationalPhoneNumber?:string;addressComponents?:AddressComponent[];rating?:number;userRatingCount?:number};
type GoogleMapsWindow=Window&{
  google?:{maps:{importLibrary?:(name:string)=>Promise<{Place:{searchByText:(request:Record<string,unknown>)=>Promise<{places:GooglePlace[]}>}}>}};
};

let loader:Promise<void>|null=null;

function hasImportLibrary(googleWindow:GoogleMapsWindow){
  return typeof googleWindow.google?.maps?.importLibrary==="function";
}

function waitForImportLibrary(googleWindow:GoogleMapsWindow){
  return new Promise<void>((resolve,reject)=>{
    const started=Date.now();
    const check=()=>{
      if(hasImportLibrary(googleWindow)){resolve();return}
      if(Date.now()-started>8000){reject(new Error("Google 地圖服務載入逾時，請完全關閉 TripLog 後再開啟"));return}
      window.setTimeout(check,100);
    };
    check();
  });
}

function loadGoogleMaps(apiKey:string){
  const googleWindow=window as GoogleMapsWindow;
  if(hasImportLibrary(googleWindow))return Promise.resolve();
  if(loader)return loader;
  loader=new Promise<void>((resolve,reject)=>{
    const script=document.createElement("script");
    script.dataset.triplogGoogleMaps="true";
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&v=weekly`;
    script.async=true;
    script.onload=()=>void waitForImportLibrary(googleWindow).then(resolve,reject);
    script.onerror=()=>reject(new Error("Google 地圖服務未能載入，請檢查網絡後再試"));
    document.head.appendChild(script);
  }).catch(error=>{loader=null;throw error});
  return loader;
}

export function placesErrorMessage(error:unknown){
  const message=error instanceof Error?error.message:String(error??"");
  if(/referer|referrer|blocked|PERMISSION_DENIED/i.test(message))return "Google 金鑰的網站限制未包括 TripLog 主頁；請加入完整首頁網址後再試。";
  if(/importLibrary|載入逾時/i.test(message))return "Google 地圖服務尚未完全載入；請完全關閉 TripLog，再重新開啟後搜尋。";
  if(/REQUEST_DENIED|ApiNotActivated|has not been used|disabled/i.test(message))return "Google Places API (New) 尚未啟用或未加入這個金鑰。";
  return message||"Google 地圖搜尋暫時失敗，請稍後再試。";
}

export async function searchHotels(textQuery:string,apiKey:string):Promise<HotelPlaceResult[]>{
  await loadGoogleMaps(apiKey);
  const googleWindow=window as GoogleMapsWindow;
  const importLibrary=googleWindow.google?.maps?.importLibrary;
  if(!importLibrary)throw new Error("Google 地圖服務尚未完成載入");
  const {Place}=await importLibrary("places");
  const {places}=await Place.searchByText({
    textQuery,
    includedType:"lodging",
    maxResultCount:3,
    language:"zh-TW",
    fields:["id","displayName","formattedAddress","nationalPhoneNumber","addressComponents"],
  });
  return places.map((place,index)=>({
    id:place.id??`${place.displayName??"hotel"}-${index}`,
    name:place.displayName??"",
    address:place.formattedAddress??"",
    postalCode:place.addressComponents?.find(component=>component.types?.includes("postal_code"))?.longText??"",
    phone:place.nationalPhoneNumber??"",
  })).filter(place=>place.name||place.address);
}

export async function searchNearbyPlaces(base:string,apiKey:string):Promise<NearbyPlaceResult[]>{
  await loadGoogleMaps(apiKey);
  const googleWindow=window as GoogleMapsWindow;
  const importLibrary=googleWindow.google?.maps?.importLibrary;
  if(!importLibrary)throw new Error("Google 地圖服務尚未完成載入");
  const {Place}=await importLibrary("places");
  const search=async(category:"景點"|"餐廳",includedType:string)=>{
    const {places}=await Place.searchByText({
      textQuery:`${base} 附近${category}`,
      includedType,
      maxResultCount:4,
      language:"zh-TW",
      fields:["id","displayName","formattedAddress","rating","userRatingCount"],
    });
    return places.map((place,index):NearbyPlaceResult=>({
      id:place.id??`${category}-${place.displayName??index}`,
      name:place.displayName??"未命名地點",
      address:place.formattedAddress??base,
      rating:Number(place.rating??0),
      userRatingCount:Number(place.userRatingCount??0),
      category,
    }));
  };
  const [attractions,restaurants]=await Promise.all([
    search("景點","tourist_attraction"),
    search("餐廳","restaurant"),
  ]);
  return [...attractions,...restaurants]
    .filter((place,index,list)=>list.findIndex(item=>item.id===place.id)===index)
    .sort((a,b)=>b.rating-a.rating||b.userRatingCount-a.userRatingCount);
}
