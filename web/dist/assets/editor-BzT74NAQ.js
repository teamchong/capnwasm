import"./main-Cu9W4HMG.js";import{l as O}from"./browser-B0Lmp7jr.js";import{o as m,c as f}from"./users.capnp.gen-DJq9F43Q.js";import{H as c,t as N}from"./github-dark-CaJORwwl.js";function _(e){const t=["package","import","option","optional","required","repeated","group","oneof"],a=["double","float","int32","int64","uint32","uint64","sint32","sint64","fixed32","fixed64","sfixed32","sfixed64","bool","string","bytes"],n={match:[/(message|enum|service)\s+/,e.IDENT_RE],scope:{1:"keyword",2:"title.class"}};return{name:"Protocol Buffers",aliases:["proto"],keywords:{keyword:t,type:a,literal:["true","false"]},contains:[e.QUOTE_STRING_MODE,e.NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,n,{className:"function",beginKeywords:"rpc",end:/[{;]/,excludeEnd:!0,keywords:"rpc returns"},{begin:/^\s*[A-Z_]+(?=\s*=[^\n]+;$)/}]}}function h(e){const t={className:"attr",begin:/"(\\.|[^\\"\r\n])*"(?=\s*:)/,relevance:1.01},a={match:/[{}[\],:]/,className:"punctuation",relevance:0},n=["true","false","null"],s={scope:"literal",beginKeywords:n.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:n},contains:[t,a,e.QUOTE_STRING_MODE,s,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\S"}}c.registerLanguage("typescript",N);c.registerLanguage("capnp",_);c.registerLanguage("json",h);const M=document.getElementById("source"),p=document.getElementById("output"),r=document.getElementById("status"),d=Array.from(document.querySelectorAll(".tabs button")),g=`struct User {
  id         @0 :UInt64;
  name       @1 :Text;
  email      @2 :Text;
  joinedAtMs @3 :UInt64;
  active     @4 :Bool;
  avatar     @5 :Data;
}`,E={id:42n,name:"Ada Browser",email:"ada@example.com",joinedAtMs:1700000000000n,active:!0,avatar:new Uint8Array([1,1,2,3,5,8,13,21])},v={draft:`// Batched sparse read. Good for render paths.
const user = openUser(cpp, bytes);

const card = user.draft(u => ({
  id: u.id,
  title: u.name,
  enabled: u.active,
}));`,getters:"// Direct getters. Best for one-off access.\nconst user = openUser(cpp, bytes);\n\nconst label = `${user.id} · ${user.name}`;\nconst avatarBytes = user.avatar.length;",object:`// Materialize the whole struct.
const user = openUser(cpp, bytes);

const obj = user.toObject();`,builder:`// Edit/build by writing through a generated Builder.
const edited = UserBuilder.from(cpp, {
  ...seed,
  name: "Edited Ada",
  active: false,
}).toBytes();

const reread = openUser(cpp, edited).draft(u => ({
  name: u.name,
  active: u.active,
}));`,schema:g};let o="draft",B=null;const y=localStorage.getItem("capnwasm-editor-tab")||o;async function T(){return B??=O(new URL("/capnp.slim.wasm",location.origin))}function U(e){return JSON.stringify(e,(t,a)=>typeof a=="bigint"?`${a}n`:a instanceof Uint8Array?`Uint8Array(${a.length}) [${Array.from(a).join(", ")}]`:a,2)}async function I(e){return f(e).fromObject(E).toBytes()}function l(e,t,a){e.removeAttribute("data-highlighted"),e.textContent=t,e.className=`language-${a}`,c.highlightElement(e)}async function b(e){if(l(M,v[e],e==="schema"?"capnp":"typescript"),e==="schema"){l(p,g,"capnp"),r.className="status",r.textContent="Generated reader/builder target schema.";return}try{const t=await T(),a=await I(t),n=m(t,a);let s;if(e==="draft")s=n.draft(i=>({id:i.id,title:i.name,enabled:i.active}));else if(e==="getters")s={label:`${n.id} · ${n.name}`,avatarBytes:n.avatar.length};else if(e==="object")s=n.toObject();else{const i=f(t).fromObject({...E,name:"Edited Ada",active:!1}).toBytes();s=m(t,i).draft(u=>({name:u.name,active:u.active}))}l(p,U(s),"json"),r.className="status",r.textContent=`Ran ${e} example against ${a.length} Cap'n Proto bytes.`}catch(t){r.className="status error",r.textContent=t instanceof Error?t.message:String(t)}}for(const e of d)e.addEventListener("click",()=>{o=e.dataset.tab||"draft",d.forEach(t=>t.classList.toggle("active",t===e)),localStorage.setItem("capnwasm-editor-tab",o),b(o)}),e.dataset.tab===y&&d.forEach(t=>t.classList.toggle("active",t===e));o=y;b(o);
