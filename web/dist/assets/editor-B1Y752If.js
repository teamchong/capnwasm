import"./main-Cu9W4HMG.js";import{l as h}from"./browser--mmGreQ4.js";import{o as m,b as f}from"./users.capnp.gen-B_PYXIF4.js";import{H as c,t as v}from"./github-dark-CaJORwwl.js";import{j as B}from"./json-BxAIPiWs.js";function U(e){const t=["package","import","option","optional","required","repeated","group","oneof"],a=["double","float","int32","int64","uint32","uint64","sint32","sint64","fixed32","fixed64","sfixed32","sfixed64","bool","string","bytes"],s={match:[/(message|enum|service)\s+/,e.IDENT_RE],scope:{1:"keyword",2:"title.class"}};return{name:"Protocol Buffers",aliases:["proto"],keywords:{keyword:t,type:a,literal:["true","false"]},contains:[e.QUOTE_STRING_MODE,e.NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,s,{className:"function",beginKeywords:"rpc",end:/[{;]/,excludeEnd:!0,keywords:"rpc returns"},{begin:/^\s*[A-Z_]+(?=\s*=[^\n]+;$)/}]}}c.registerLanguage("typescript",v);c.registerLanguage("capnp",U);c.registerLanguage("json",B);const w=document.getElementById("source"),p=document.getElementById("output"),r=document.getElementById("status"),d=Array.from(document.querySelectorAll(".tabs button")),g=`struct User {
  id         @0 :UInt64;
  name       @1 :Text;
  email      @2 :Text;
  joinedAtMs @3 :UInt64;
  active     @4 :Bool;
  avatar     @5 :Data;
}`,y={id:42n,name:"Ada Browser",email:"ada@example.com",joinedAtMs:1700000000000n,active:!0,avatar:new Uint8Array([1,1,2,3,5,8,13,21])},A={draft:`// Batched sparse read. Good for render paths.
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
}));`,schema:g};let n="draft",O=null;const b=localStorage.getItem("capnwasm-editor-tab")||n;async function I(){return O??=h(new URL("/capnp.slim.wasm",location.origin))}function N(e){return JSON.stringify(e,(t,a)=>typeof a=="bigint"?`${a}n`:a instanceof Uint8Array?`Uint8Array(${a.length}) [${Array.from(a).join(", ")}]`:a,2)}async function x(e){return f(e).fromObject(y).toBytes()}function u(e,t,a){e.removeAttribute("data-highlighted"),e.textContent=t,e.className=`language-${a}`,c.highlightElement(e)}async function E(e){if(u(w,A[e],e==="schema"?"capnp":"typescript"),e==="schema"){u(p,g,"capnp"),r.className="status",r.textContent="Generated reader/builder target schema.";return}try{const t=await I(),a=await x(t),s=m(t,a);let o;if(e==="draft")o=s.draft(i=>({id:i.id,title:i.name,enabled:i.active}));else if(e==="getters")o={label:`${s.id} · ${s.name}`,avatarBytes:s.avatar.length};else if(e==="object")o=s.toObject();else{const i=f(t).fromObject({...y,name:"Edited Ada",active:!1}).toBytes();o=m(t,i).draft(l=>({name:l.name,active:l.active}))}u(p,N(o),"json"),r.className="status",r.textContent=`Ran ${e} example against ${a.length} Cap'n Proto bytes.`}catch(t){r.className="status error",r.textContent=t instanceof Error?t.message:String(t)}}for(const e of d)e.addEventListener("click",()=>{n=e.dataset.tab||"draft",d.forEach(t=>t.classList.toggle("active",t===e)),localStorage.setItem("capnwasm-editor-tab",n),E(n)}),e.dataset.tab===b&&d.forEach(t=>t.classList.toggle("active",t===e));n=b;E(n);
