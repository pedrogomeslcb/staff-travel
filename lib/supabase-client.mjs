import {createClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL;
const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Publishable keys are designed for public client applications.
// The database's Row Level Security policies remain the access boundary.
// Session-only mode keeps credentials in this tab's sessionStorage. Existing
// persistent sessions remain compatible with the original Supabase storage key.
const authStorage={
  getItem(key){return sessionStorage.getItem('staff-session-only')==='1'?sessionStorage.getItem(key):localStorage.getItem(key);},
  setItem(key,value){
    const temporary=sessionStorage.getItem('staff-session-only')==='1';
    if(temporary)sessionStorage.setItem(key,value);
    else {localStorage.setItem(key,value);sessionStorage.removeItem(key);}
  },
  removeItem(key){
    if(sessionStorage.getItem('staff-session-only')==='1')sessionStorage.removeItem(key);
    else {localStorage.removeItem(key);sessionStorage.removeItem(key);}
  }
};
export const supabase=url&&publishableKey
  ? createClient(url,publishableKey,{auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  : null;
