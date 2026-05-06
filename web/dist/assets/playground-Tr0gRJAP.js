const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/runtime-capnwasm-CIXiQqni.js","assets/browser--mmGreQ4.js","assets/dynamic-D4jjy1bG.js","assets/runtime-python-BiBWmJqd.js","assets/preload-helper-CLcXU_4U.js","assets/globe-renderer-BWZBCN51.js","assets/_commonjsHelpers-Cpj98o6Y.js"])))=>i.map(i=>d[i]);
import"./main-Cu9W4HMG.js";import{_ as h}from"./preload-helper-CLcXU_4U.js";const i=e=>document.querySelector(e),S=e=>Array.from(document.querySelectorAll(e)),o={list:i("#endpoint-list"),count:i("#endpoint-count"),search:i("#endpoint-search"),detail:i("#endpoint-detail"),detailVerb:i("#detail-verb"),detailPath:i("#detail-path"),detailSum:i("#detail-summary"),detailTags:i("#detail-tags"),editor:i("#editor-mount"),fire:i("#fire-btn"),status:i("#runtime-status"),preview:i("#bubble-preview"),wirePanel:i("#capnwasm-wire"),wireStats:i("#capnwasm-wire-stats"),langTabs:S(".lang-tab"),globeCanvas:i("#globe-canvas"),bubbleLayer:i("#bubble-layer")};let r=[],c=[],p=null,f="js",C=null;const l={js:"",python:"",ruby:"",go:""};async function D(){d("Loading endpoints…");let e;try{e=await fetch("/data/cf-endpoints.json",{cache:"force-cache"})}catch(n){d(`Endpoint index fetch failed: ${n.message}`);return}if(!e.ok){d(`Endpoint index missing (${e.status}). Run \`pnpm prepare:assets\` to generate it.`),N();return}const t=await e.json();r=t.endpoints,c=r,o.count.textContent=`${r.length} endpoints`,d(`Loaded ${r.length} endpoints across ${t.stats.tags} tags.`),$(),m&&m.setEndpoints(M(r)),r.length>0&&_(r[0])}function N(){r=[{id:"demo-list-zones",path:"/zones",method:"GET",tag:"Zones",summary:"List zones",description:null,lat:51.5074,lng:-.1278,pop:"London",params:[{name:"name",in:"query",type:"string",required:!1}],mock:{result:[{id:"0".repeat(32),name:"example.com",status:"active"}],success:!0,errors:[],messages:[]}},{id:"demo-get-account",path:"/accounts/{id}",method:"GET",tag:"Accounts",summary:"Get account details",description:null,lat:38.9072,lng:-77.0369,pop:"Washington DC",params:[{name:"id",in:"path",type:"string",required:!0}],mock:{result:{id:"1".repeat(32),name:"Sample Account"},success:!0,errors:[],messages:[]}}],c=r,o.count.textContent=`${r.length} sample endpoints`,$(),_(r[0])}function $(){const e=document.createDocumentFragment(),t=Math.min(c.length,500);for(let n=0;n<t;n++){const a=c[n],s=document.createElement("button");s.className="endpoint-row",s.dataset.id=a.id,s.setAttribute("role","option"),s.innerHTML=`
      <span class="row-verb verb verb-${a.method.toLowerCase()}">${a.method}</span>
      <span class="row-path">${y(a.path)}</span>
      <span class="row-tag">${y(a.tag)}</span>
    `,s.addEventListener("click",()=>_(a)),e.appendChild(s)}if(o.list.replaceChildren(e),c.length>t){const n=document.createElement("div");n.className="endpoint-more",n.textContent=`+ ${c.length-t} more — refine the search to narrow.`,o.list.appendChild(n)}}function I(e){const t=e.trim().toLowerCase();t?c=r.filter(n=>n.path.toLowerCase().includes(t)||n.id.toLowerCase().includes(t)||n.tag.toLowerCase().includes(t)||(n.summary?.toLowerCase().includes(t)??!1)):c=r,o.count.textContent=`${c.length} / ${r.length}`,$()}function _(e){p=e,o.detail.hidden=!1,o.detailVerb.textContent=e.method,o.detailVerb.className=`verb verb-${e.method.toLowerCase()}`,o.detailPath.textContent=e.path,o.detailSum.textContent=e.summary??"—",o.detailTags.innerHTML=`
    <span class="tag-pill">${y(e.tag)}</span>
    <span class="tag-pill pop">📍 ${y(e.pop)}</span>
  `;for(const t of S(".endpoint-row"))t.classList.toggle("selected",t.dataset.id===e.id);l.js=F(e),l.python=V(e),l.ruby=q(e),l.go=G(e),x(l[f]),o.fire.disabled=!1,m?.focus(e.id),B(e)}async function B(e){C=null,o.wirePanel.hidden=!0;try{const t=await h(()=>import("./runtime-capnwasm-CIXiQqni.js"),__vite__mapDeps([0,1,2])),n=await t.prepareResponse(e.id,e.mock);C={reader:n.reader,json:n.json,bytes:n.bytes},o.wireStats.textContent=t.formatStats(n.stats),o.wirePanel.hidden=!1}catch(t){o.wireStats.textContent=`capnwasm encode failed: ${t.message}`,o.wirePanel.hidden=!1}await v("select")}function F(e){const t=E(e);return`// Cloudflare TypeScript SDK
//   import Cloudflare from "cloudflare";
//   const cf = new Cloudflare({ apiToken: "your_token" });
//
//   // ${e.method} ${e.path}
//   const apiResponse = await cf.${t};
//
// The 'response' below is the mocked openapi.json payload re-encoded
// as Cap'n Proto wire bytes by capnwasm and decoded back into a
// capnwasm Reader. So 'response.success' and 'response.resultJson'
// are real wasm reads — capnwasm is on the live-edit path.
function format(response) {
  const result = JSON.parse(new TextDecoder().decode(response.resultJson));
  return result === null ? "no result" : JSON.stringify(result).slice(0, 60) + "…";
}
`}function V(e){const t=A(e);return`# Cloudflare Python SDK
#   from cloudflare import Cloudflare
#   cf = Cloudflare(api_token="your_token")
#
#   # ${e.method} ${e.path}
#   response = cf.${t}
#
# 'response' below is the mocked payload from openapi.json.
def format(response):
    return f"{type(response).__name__}: {str(response)[:60]}…"
`}function q(e){return`# Cloudflare Ruby SDK
#   require "cloudflare"
#   cf = Cloudflare.new(token: "your_token")
#
#   # ${e.method} ${e.path}
#   response = cf.${O(e)}
#
# 'response' below is the mocked payload from openapi.json.
def format(response)
  "#{response.class}: #{response.to_s[0..60]}…"
end
`}function G(e){return`// Cloudflare Go SDK
//   import (
//       "github.com/cloudflare/cloudflare-go/v3"
//       "github.com/cloudflare/cloudflare-go/v3/option"
//   )
//   cf := cloudflare.NewClient(option.WithAPIToken("your_token"))
//
//   // ${e.method} ${e.path}
//   response, _ := cf.${E(e).replace(/^[a-z]/,t=>t.toUpperCase())}
//
// The shim only runs the body of \`format\` below.
func format(response interface{}) string {
    return JSON.stringify(response).slice(0, 60) + "…"
}
`}function E(e){const t=e.path.split("/").filter(Boolean),n=[],a=[];for(const w of t)w.startsWith("{")&&w.endsWith("}")?n.push(L(w.slice(1,-1))):a.push(L(w));const s=e.method.toLowerCase(),u=s==="get"&&n.length===0?"list":s==="get"?"get":s==="post"?"create":s==="put"?"update":s==="patch"?"edit":s==="delete"?"delete":s;return`${a.join(".")}.${u}(${n.join(", ")})`}function A(e){return E(e).replace(/[A-Z]/g,t=>"_"+t.toLowerCase())}function O(e){return A(e)}function L(e){return e.replace(/[-_](.)/g,(t,n)=>n.toUpperCase()).replace(/^[A-Z]/,t=>t.toLowerCase())}let b=null;function H(){const e=document.createElement("textarea");e.className="editor-textarea",e.spellcheck=!1,e.autocapitalize="off",e.setAttribute("autocorrect","off"),e.setAttribute("autocomplete","off"),e.addEventListener("input",()=>{l[f]=e.value,z()}),o.editor.replaceChildren(e),b=e}function x(e){b&&(b.value=e,l[f]=e)}let T;function z(){window.clearTimeout(T),T=window.setTimeout(()=>void v("input"),250)}async function v(e){if(!p)return"";const t=b?.value??l[f];let n;try{if(f==="js"){const a=C?.reader??p.mock;n=await J(t,a)}else n=await K(f,t)}catch(a){n=`error: ${a instanceof Error?a.message:String(a)}`}return o.preview.textContent=n||"(empty)",e==="fire"&&m?.fireBubble(p.id,n),n}async function J(e,t){const n=e.replace(/^\s*import[^\n]*\n/gm,`// import skipped — running mock
`).replace(/^\s*export\s+default\s+/m,"var __default = "),s=new Function("response",`${n}
    var __fn = (typeof __default === "function") ? __default
              : (typeof format === "function") ? format
              : null;
    if (!__fn) throw new Error("define a function called 'format' or 'export default'");
    var __out = __fn(response);
    return __out == null ? "" : (typeof __out === "string" ? __out : String(__out));
  `)(t);return typeof s=="string"?s:String(s)}async function K(e,t){try{if(e==="python"){const{run:n,status:a}=await h(async()=>{const{run:s,status:u}=await import("./runtime-python-BiBWmJqd.js");return{run:s,status:u}},__vite__mapDeps([3,4]));return d(a()),n(t,p?.mock??null)}if(e==="ruby"){const{run:n,status:a}=await h(async()=>{const{run:s,status:u}=await import("./runtime-ruby-MYrsStfJ.js");return{run:s,status:u}},[]);return d(a()),n(t,p?.mock??null)}if(e==="go"){const{run:n,status:a}=await h(async()=>{const{run:s,status:u}=await import("./runtime-go-BEqdLDWa.js");return{run:s,status:u}},[]);return d(a()),n(t,p?.mock??null)}}catch(n){d(`${e} runtime error: ${n.message}`)}return""}function W(){for(const e of o.langTabs)e.addEventListener("click",()=>{const t=e.dataset.lang;f=t;for(const n of o.langTabs)n.setAttribute("aria-selected",String(n===e));x(l[t]),v("select")})}let m=null;async function U(){o.globeCanvas.innerHTML=`
    <div class="globe-placeholder">
      <span class="globe-spinner" aria-hidden="true"></span>
      <span>Loading globe&hellip;</span>
    </div>
  `;let e;try{e=await h(()=>import("./globe-renderer-BWZBCN51.js"),__vite__mapDeps([5,6]))}catch(t){o.globeCanvas.innerHTML=`
      <div class="globe-placeholder">
        <span style="color:#ff7043">Globe failed to load.</span>
        <span style="font-size:0.72rem;color:#6a7882">${t.message}</span>
      </div>
    `;return}o.globeCanvas.innerHTML="",m=e.mountGlobeRenderer({container:o.globeCanvas,bubbleLayer:o.bubbleLayer,initial:M(r),onSelect:t=>{const n=r.find(a=>a.id===t.id);n&&_(n)}})}function M(e){return e.map(t=>({id:t.id,path:t.path,method:t.method,tag:t.tag,lat:t.lat,lng:t.lng,pop:t.pop}))}function d(e){o.status.textContent=e}function y(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}const P=1700,Z=6e3;let R=performance.now();const k=[e=>`${e.method} ${e.path}`,e=>`→ ${e.tag}`,e=>`📍 ${e.pop}`,e=>e.summary?.slice(0,48)??`${e.method} ${e.tag}`];function j(){if(performance.now()-R>Z&&r.length>0&&m){const t=r[Math.floor(Math.random()*r.length)],n=k[Math.floor(Math.random()*k.length)];m.fireBubble(t.id,n(t))}window.setTimeout(j,P)}function g(){R=performance.now()}H();W();o.fire.addEventListener("click",()=>{g(),v("fire")});o.search.addEventListener("input",()=>{g(),I(o.search.value)});o.list.addEventListener("scroll",g);window.addEventListener("pointerdown",g);window.addEventListener("keydown",g);window.setTimeout(j,P);U();D();
