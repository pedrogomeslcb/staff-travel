import {useEffect,useState} from 'react';

export default function AdminNotificationEmail({client}){
  const [email,setEmail]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(true);
  useEffect(()=>{
    let active=true;
    client.rpc('staff_notification_address').then(({data,error})=>{
      if(!active)return;
      setEmail(data||'');
      setStatus(error?'Email setup requires the admin-request-email.sql migration.':'');
      setBusy(!!error);
    });
    return ()=>{active=false;};
  },[client]);
  async function save(event){
    event.preventDefault();
    setBusy(true);
    try{
      const {error}=await client.rpc('staff_set_notification_address',{address:email.trim()});
      setStatus(error?error.message:'Notification address saved.');
    }catch(error){setStatus(error.message);}
    finally{setBusy(false);}
  }
  return <form className="rounded-xl border bg-white p-4 my-4" onSubmit={save}>
    <label className="block text-sm font-semibold" htmlFor="notification-email">My email for hotel and transfer alerts</label>
    <input id="notification-email" className="border rounded p-2 my-2 mr-3" type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/>
    <button className="text-blue-700 text-sm" disabled={busy}>Save email</button>
    {status&&<p className="text-sm" role="status">{status}</p>}
  </form>;
}
