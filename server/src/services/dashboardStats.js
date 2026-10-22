// Convert compact MongoDB per-day/status counts to the same dashboard
// contract without loading all Delivery documents into Node memory.
const submittedStatuses=new Set(['submitted','sent','delivered','read']);
const deliveredStatuses=new Set(['delivered','read']);

export function summarizeDeliveryActivity(groups,now=new Date()){
  const today=new Date(now);
  today.setUTCHours(0,0,0,0);
  const activity=Array.from({length:14},(_,i)=>{
    const day=new Date(today);
    day.setUTCDate(day.getUTCDate()-(13-i));
    return {date:day.toISOString().slice(0,10),submitted:0,delivered:0,failed:0};
  });
  const dates=new Map(activity.map(x=>[x.date,x]));
  let submitted=0,delivered=0,read=0,failed=0;
  for(const row of groups||[]){
    const status=row?._id?.status;
    const count=Math.max(0,Number(row.total)||0);
    const record=dates.get(row?._id?.date);
    if(!record||!count)continue;
    if(submittedStatuses.has(status)){record.submitted+=count;submitted+=count}
    if(deliveredStatuses.has(status)){record.delivered+=count;delivered+=count}
    if(status==='read')read+=count;
    if(status==='failed'){record.failed+=count;failed+=count}
  }
  return {
    submitted,delivered,read,failed,
    deliveryRate:submitted?Math.round(delivered/submitted*1000)/10:0,
    activity
  };
}

export function deliveryAggregationPipeline(workspaceId,since){
  return [
    {$match:{workspaceId,createdAt:{$gte:since}}},
    {$group:{
      _id:{date:{$dateToString:{date:'$createdAt',format:'%Y-%m-%d',timezone:'UTC'}},
        status:'$status'},
      total:{$sum:1}
    }}
  ];
}
