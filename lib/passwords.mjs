import {pbkdf2Async} from '@noble/hashes/pbkdf2.js';
import {sha256} from '@noble/hashes/sha2.js';
import {PlannerError} from './planner.mjs';
const iterations=600000;
const encode=new TextEncoder();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/.{2}/g)||[],s=>parseInt(s,16));
export function validatePassword(value) {if(typeof value!=='string'||value.length<4||value.length>128)throw new PlannerError('Use a password with 4–128 characters.');return value;}
export async function derivePassword(password,salt,count=iterations,subtle=globalThis.crypto?.subtle) {
  if(subtle) {try {
    const key=await subtle.importKey('raw',encode.encode(password),'PBKDF2',false,['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:count},key,256));
  }catch{ /* Some runtimes cap native PBKDF2; use the same work factor in the library fallback. */} }
  return pbkdf2Async(sha256,encode.encode(password),salt,{c:count,dkLen:32,asyncTick:10});
}
export async function hashPassword(value) {
  const password=validatePassword(value),salt=crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(await derivePassword(password,salt,iterations))}`;
}
export async function verifyPassword(value,encoded) {
  if(typeof value!=='string'||value.length>128||typeof encoded!=='string')return false;
  const [algorithm,count,salt,expected]=encoded.split('$');
  if(algorithm!=='pbkdf2-sha256'||!/^\d+$/.test(count)||+count<600000||+count>1000000||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(expected))return false;
  const actual=await derivePassword(value,unhex(salt),+count),target=unhex(expected);let diff=0;
  for(let i=0;i<actual.length;i++)diff|=actual[i]^target[i];return diff===0;
}
export const newSessionToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const digestToken=token=>hex(sha256(encode.encode(token)));
