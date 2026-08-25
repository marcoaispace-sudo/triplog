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
  google?:{maps:{importLibrary:(name:string)=>Promise<{Place:{searchByText:(request:Record<string,unknown>)=>Promise<{places:GooglePlace[]}>}}>}};
};

let loader:Promise<void>|null=null;

function loadGoogleMaps(apiKey:string){
  const googleWindow=window as GoogleMapsWindow;
  if(googleWindow.google?.maps)return Promise.resolve();
  if(loader)return loader;
  loader=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&v=weekly`;
    script.async=true;
    script.onload=()=>googleWindow.google?.maps?resolve():reject(new Error("酒店搜尋服務未能載入"));
    script.onerror=()=>reject(new Error("酒店搜尋服務未能載入"));
    document.head.appendChild(script);
  });
  return loader;
}

export async function searchHotels(textQuery:string,apiKey:string):Promise<HotelPlaceResult[]>{
  await loadGoogleMaps(apiKey);
  const googleWindow=window as GoogleMapsWindow;
  if(!googleWindow.google?.maps)throw new Error("酒店搜尋服務未能載入");
  const {Place}=await googleWindow.google.maps.importLibrary("places");
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
  if(!googleWindow.google?.maps)throw new Error("附近搜尋服務未能載入");
  const {Place}=await googleWindow.google.maps.importLibrary("places");
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
