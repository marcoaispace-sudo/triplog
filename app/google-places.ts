export type HotelPlaceResult={
  id:string;
  name:string;
  address:string;
  postalCode:string;
  phone:string;
};

type AddressComponent={longText?:string;types?:string[]};
type GooglePlace={id?:string;displayName?:string;formattedAddress?:string;nationalPhoneNumber?:string;addressComponents?:AddressComponent[]};
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
