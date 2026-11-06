"use strict";
// Source-level finite ledger transfer model; real storage isolation still unverified.
const init={a:2,b:0,c:1,committed:[false,false],receipt:[false,false],duplicateDenied:false,tenantDenied:false,insufficientDenied:false,lostResponse:false,cancelled:false};
function must(v,m){if(!v)throw Error("ledger model: "+m);}
function valid(s){
 must(s.a>=0&&s.b>=0&&s.c>=0,"negative available balance");
 must(s.a+s.b===2,"tenant-one debit/credit unbalanced");
 must(s.c===1,"tenant-two funds leaked into tenant one");
 must(s.committed.every(x=>typeof x==="boolean"),"ledger identity invalid");
 for(let i=0;i<2;i++)must(!s.receipt[i]||s.committed[i],"ack without committed transfer");
}
function transfer(s,id,amount){
 if(s.committed[id])return {ok:false,kind:"duplicate",state:s};
 if(s.a<amount)return {ok:false,kind:"insufficient",state:s};
 const next={...s,a:s.a-amount,b:s.b+amount,committed:s.committed.map((v,i)=>i===id?true:v)};
 return {ok:true,kind:"committed",state:next};
}
function next(s){
 const out=[];
 for(let id=0;id<2;id++){
  const amount=id===0?1:2;
  const result=transfer(s,id,amount);
  if(result.ok)out.push(["atomic-transfer-"+id,result.state]);
  else if(result.kind==="duplicate")out.push(["idempotency-reject-"+id,{...s,duplicateDenied:true}]);
  else out.push(["insufficient-funds-"+id,{...s,insufficientDenied:true}]);
  if(s.committed[id]&&!s.receipt[id])
   out.push(["ack-"+id,{...s,receipt:s.receipt.map((v,i)=>i===id?true:v)}]);
 }
 if(!s.tenantDenied)out.push(["reject-cross-tenant",{...s,tenantDenied:true}]);
 if(s.committed.some(Boolean)){
  if(!s.lostResponse)out.push(["lose-response",{...s,lostResponse:true}]);
  if(!s.cancelled)out.push(["cancel-after-commit",{...s,cancelled:true}]);
 }
 return out;
}
function explore(){
 const LIMIT=10,seen=new Set([JSON.stringify(init)]),queue=[[init,0]];let edges=0;
 for(let h=0;h<queue.length;h++){
  const [s,d]=queue[h];valid(s);if(d===LIMIT)continue;
  for(const [event,t]of next(s)){
   valid(t);edges++;const k=JSON.stringify(t);
   if(!seen.has(k)){seen.add(k);queue.push([t,d+1]);}
  }
 }
 const states=[...seen].map(JSON.parse);
 for(const flag of ["duplicateDenied","tenantDenied","insufficientDenied","lostResponse","cancelled"])
  must(states.some(s=>s[flag]),"missing witness "+flag);
 must(states.some(s=>s.committed[0]),"small transfer never committed");
 must(states.some(s=>s.committed[1]),"large transfer never committed");
 const forged=[{...init,a:1},{...init,c:0},{...init,receipt:[true,false]}];
 for(const s of forged){
  let rejected=false;try{valid(s);}catch{rejected=true;}
  must(rejected,"mutated unbalanced/forged acknowledgement accepted");
 }
 return {states:seen.size,transitions:edges,bound:LIMIT,tenants:2,transferIds:2,claim:"bounded abstract state only"};
}
const result=explore();
if(typeof console!=="undefined")console.log(JSON.stringify(result));
