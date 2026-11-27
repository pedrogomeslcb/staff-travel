import {createClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL;
const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Publishable keys are designed for public client applications.
// The database's Row Level Security policies remain the access boundary.
// Session-only mode keeps credentials in this tab's sessionStorage. Existing
// persistent sessions remain compatible with the original Supabase storage key.
const authStorage={
  getItem(key){return sessionStorage.getItem(key)??localStorage.getItem(key);},
  setItem(key,value){
    const temporary=sessionStorage.getItem('staff-session-only')==='1'||sessionStorage.getItem(key)!==null;
    const target=temporary?sessionStorage:localStorage,other=temporary?localStorage:sessionStorage;
    target.setItem(key,value);other.removeItem(key);
  },
  removeItem(key){sessionStorage.removeItem(key);localStorage.removeItem(key);}
};
export const supabase=url&&publishableKey
  ? createClient(url,publishableKey,{auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  : null;
