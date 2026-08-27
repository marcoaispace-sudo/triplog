const DAY_MS=86_400_000;

export function parseDateOnly(value:string){
  const [year,month,day]=value.split("-").map(Number);
  return new Date(Date.UTC(year,month-1,day));
}

export function localTodayDateOnly(now=new Date()){
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

export function homeScheduleDate(startDate:string,endDate:string,scheduledDates:string[],today:string){
  if(today<startDate)return startDate;
  if(today>endDate)return endDate;
  const validDates=[...new Set(scheduledDates.filter(date=>date>=startDate&&date<=endDate))].sort();
  if(validDates.includes(today))return today;
  return validDates.find(date=>date>today)??today;
}

export function formatDateLabel(value:string){
  const date=parseDateOnly(value);
  return `${date.getUTCMonth()+1}月${date.getUTCDate()}日`;
}

export function tripDateRange(startDate:string,endDate:string){
  const dates:string[]=[];
  const cursor=parseDateOnly(startDate);
  const end=parseDateOnly(endDate);
  while(cursor<=end&&dates.length<62){
    dates.push(cursor.toISOString().slice(0,10));
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return dates;
}

export function tripDayCount(startDate:string,endDate:string){
  return Math.max(1,Math.round((parseDateOnly(endDate).getTime()-parseDateOnly(startDate).getTime())/DAY_MS)+1);
}

export function daysUntilDate(value:string,now=new Date()){
  const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  return Math.max(0,Math.ceil((parseDateOnly(value).getTime()-today)/DAY_MS));
}

export function weekdayDateLabel(value:string){
  return new Intl.DateTimeFormat("zh-HK",{weekday:"short",timeZone:"UTC"}).format(parseDateOnly(value)).replace("星期","");
}
