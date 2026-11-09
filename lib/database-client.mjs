export function databaseClient(fetcher=fetch) {
  async function request(path='',body) {
    const response=await fetcher('/api/database'+path,{
      cache:'no-store',credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw new Error(data?.error||'The database is unavailable. Try again.');
    return data;
  }
  return {
    references:()=>request('?view=references'),
    read:()=>request(),
    save:(kind,id,draft,revision)=>request('',{action:'save',kind,id,draft,revision}),
    async capture(trips) {
      const rows=trips.filter(trip=>trip.membership).map(({userId,person,membership})=>({userId,person,membership}));
      for(let offset=0;offset<rows.length;offset+=50)await request('',{action:'capture',records:rows.slice(offset,offset+50)});
    },
  };
}
