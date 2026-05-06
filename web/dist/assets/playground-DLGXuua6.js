const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/runtime-python-BiBWmJqd.js","assets/preload-helper-CLcXU_4U.js","assets/globe-renderer-BWZBCN51.js","assets/_commonjsHelpers-Cpj98o6Y.js"])))=>i.map(i=>d[i]);
import"./main-Cu9W4HMG.js";import{_ as b}from"./preload-helper-CLcXU_4U.js";const i=t=>document.querySelector(t),k=t=>Array.from(document.querySelectorAll(t)),o={list:i("#endpoint-list"),count:i("#endpoint-count"),search:i("#endpoint-search"),detail:i("#endpoint-detail"),detailVerb:i("#detail-verb"),detailPath:i("#detail-path"),detailSum:i("#detail-summary"),detailTags:i("#detail-tags"),editor:i("#editor-mount"),fire:i("#fire-btn"),status:i("#runtime-status"),preview:i("#bubble-preview"),langTabs:k(".lang-tab"),globeCanvas:i("#globe-canvas"),bubbleLayer:i("#bubble-layer")};let s=[],c=[],p=null,f="js";const l={js:"",python:"",ruby:"",go:""};async function N(){u("Loading endpoints…");let t;try{t=await fetch("/data/cf-endpoints.json",{cache:"force-cache"})}catch(n){u(`Endpoint index fetch failed: ${n.message}`);return}if(!t.ok){u(`Endpoint index missing (${t.status}). Run \`pnpm prepare:assets\` to generate it.`),I();return}const e=await t.json();s=e.endpoints,c=s,o.count.textContent=`${s.length} endpoints`,u(`Loaded ${s.length} endpoints across ${e.stats.tags} tags.`),C(),m&&m.setEndpoints(M(s)),s.length>0&&w(s[0])}function I(){s=[{id:"demo-list-zones",path:"/zones",method:"GET",tag:"Zones",summary:"List zones",description:null,lat:51.5074,lng:-.1278,pop:"London",params:[{name:"name",in:"query",type:"string",required:!1}],mock:{result:[{id:"0".repeat(32),name:"example.com",status:"active"}],success:!0,errors:[],messages:[]}},{id:"demo-get-account",path:"/accounts/{id}",method:"GET",tag:"Accounts",summary:"Get account details",description:null,lat:38.9072,lng:-77.0369,pop:"Washington DC",params:[{name:"id",in:"path",type:"string",required:!0}],mock:{result:{id:"1".repeat(32),name:"Sample Account"},success:!0,errors:[],messages:[]}}],c=s,o.count.textContent=`${s.length} sample endpoints`,C(),w(s[0])}function C(){const t=document.createDocumentFragment(),e=Math.min(c.length,500);for(let n=0;n<e;n++){const r=c[n],a=document.createElement("button");a.className="endpoint-row",a.dataset.id=r.id,a.setAttribute("role","option"),a.innerHTML=`
      <span class="row-verb verb verb-${r.method.toLowerCase()}">${r.method}</span>
      <span class="row-path">${_(r.path)}</span>
      <span class="row-tag">${_(r.tag)}</span>
    `,a.addEventListener("click",()=>w(r)),t.appendChild(a)}if(o.list.replaceChildren(t),c.length>e){const n=document.createElement("div");n.className="endpoint-more",n.textContent=`+ ${c.length-e} more — refine the search to narrow.`,o.list.appendChild(n)}}function P(t){const e=t.trim().toLowerCase();e?c=s.filter(n=>n.path.toLowerCase().includes(e)||n.id.toLowerCase().includes(e)||n.tag.toLowerCase().includes(e)||(n.summary?.toLowerCase().includes(e)??!1)):c=s,o.count.textContent=`${c.length} / ${s.length}`,C()}function w(t){p=t,o.detail.hidden=!1,o.detailVerb.textContent=t.method,o.detailVerb.className=`verb verb-${t.method.toLowerCase()}`,o.detailPath.textContent=t.path,o.detailSum.textContent=t.summary??"—",o.detailTags.innerHTML=`
    <span class="tag-pill">${_(t.tag)}</span>
    <span class="tag-pill pop">📍 ${_(t.pop)}</span>
  `;for(const e of k(".endpoint-row"))e.classList.toggle("selected",e.dataset.id===t.id);l.js=R(t),l.python=B(t),l.ruby=F(t),l.go=q(t),A(l[f]),o.fire.disabled=!1,v("select"),m?.focus(t.id)}function R(t){const e=$(t);return`// Cloudflare TypeScript SDK
//   import Cloudflare from "cloudflare";
//   const cf = new Cloudflare({ apiToken: "your_token" });
//
//   // ${t.method} ${t.path}
//   const response = await cf.${e};
//
// 'response' below is the mocked payload from openapi.json.
function format(response) {
  return JSON.stringify(response).slice(0, 60) + "…";
}
`}function B(t){const e=S(t);return`# Cloudflare Python SDK
#   from cloudflare import Cloudflare
#   cf = Cloudflare(api_token="your_token")
#
#   # ${t.method} ${t.path}
#   response = cf.${e}
#
# 'response' below is the mocked payload from openapi.json.
def format(response):
    return f"{type(response).__name__}: {str(response)[:60]}…"
`}function F(t){return`# Cloudflare Ruby SDK
#   require "cloudflare"
#   cf = Cloudflare.new(token: "your_token")
#
#   # ${t.method} ${t.path}
#   response = cf.${G(t)}
#
# 'response' below is the mocked payload from openapi.json.
def format(response)
  "#{response.class}: #{response.to_s[0..60]}…"
end
`}function q(t){return`// Cloudflare Go SDK
//   import (
//       "github.com/cloudflare/cloudflare-go/v3"
//       "github.com/cloudflare/cloudflare-go/v3/option"
//   )
//   cf := cloudflare.NewClient(option.WithAPIToken("your_token"))
//
//   // ${t.method} ${t.path}
//   response, _ := cf.${$(t).replace(/^[a-z]/,e=>e.toUpperCase())}
//
// The shim only runs the body of \`format\` below.
func format(response interface{}) string {
    return JSON.stringify(response).slice(0, 60) + "…"
}
`}function $(t){const e=t.path.split("/").filter(Boolean),n=[],r=[];for(const g of e)g.startsWith("{")&&g.endsWith("}")?n.push(L(g.slice(1,-1))):r.push(L(g));const a=t.method.toLowerCase(),d=a==="get"&&n.length===0?"list":a==="get"?"get":a==="post"?"create":a==="put"?"update":a==="patch"?"edit":a==="delete"?"delete":a;return`${r.join(".")}.${d}(${n.join(", ")})`}function S(t){return $(t).replace(/[A-Z]/g,e=>"_"+e.toLowerCase())}function G(t){return S(t)}function L(t){return t.replace(/[-_](.)/g,(e,n)=>n.toUpperCase()).replace(/^[A-Z]/,e=>e.toLowerCase())}let y=null;function V(){const t=document.createElement("textarea");t.className="editor-textarea",t.spellcheck=!1,t.autocapitalize="off",t.setAttribute("autocorrect","off"),t.setAttribute("autocomplete","off"),t.addEventListener("input",()=>{l[f]=t.value,H()}),o.editor.replaceChildren(t),y=t}function A(t){y&&(y.value=t,l[f]=t)}let E;function H(){window.clearTimeout(E),E=window.setTimeout(()=>void v("input"),250)}async function v(t){if(!p)return"";const e=y?.value??l[f];let n;try{f==="js"?n=await z(e,p.mock):n=await O(f,e)}catch(r){n=`error: ${r instanceof Error?r.message:String(r)}`}return o.preview.textContent=n||"(empty)",t==="fire"&&m?.fireBubble(p.id,n),n}async function z(t,e){const n=t.replace(/^\s*import[^\n]*\n/gm,`// import skipped — running mock
`).replace(/^\s*export\s+default\s+/m,"var __default = "),a=new Function("response",`${n}
    var __fn = (typeof __default === "function") ? __default
              : (typeof format === "function") ? format
              : null;
    if (!__fn) throw new Error("define a function called 'format' or 'export default'");
    var __out = __fn(response);
    return __out == null ? "" : (typeof __out === "string" ? __out : String(__out));
  `)(e);return typeof a=="string"?a:String(a)}async function O(t,e){try{if(t==="python"){const{run:n,status:r}=await b(async()=>{const{run:a,status:d}=await import("./runtime-python-BiBWmJqd.js");return{run:a,status:d}},__vite__mapDeps([0,1]));return u(r()),n(e,p?.mock??null)}if(t==="ruby"){const{run:n,status:r}=await b(async()=>{const{run:a,status:d}=await import("./runtime-ruby-MYrsStfJ.js");return{run:a,status:d}},[]);return u(r()),n(e,p?.mock??null)}if(t==="go"){const{run:n,status:r}=await b(async()=>{const{run:a,status:d}=await import("./runtime-go-BEqdLDWa.js");return{run:a,status:d}},[]);return u(r()),n(e,p?.mock??null)}}catch(n){u(`${t} runtime error: ${n.message}`)}return""}function K(){for(const t of o.langTabs)t.addEventListener("click",()=>{const e=t.dataset.lang;f=e;for(const n of o.langTabs)n.setAttribute("aria-selected",String(n===t));A(l[e]),v("select")})}let m=null;async function W(){o.globeCanvas.innerHTML=`
    <div class="globe-placeholder">
      <span class="globe-spinner" aria-hidden="true"></span>
      <span>Loading globe&hellip;</span>
    </div>
  `;let t;try{t=await b(()=>import("./globe-renderer-BWZBCN51.js"),__vite__mapDeps([2,3]))}catch(e){o.globeCanvas.innerHTML=`
      <div class="globe-placeholder">
        <span style="color:#ff7043">Globe failed to load.</span>
        <span style="font-size:0.72rem;color:#6a7882">${e.message}</span>
      </div>
    `;return}o.globeCanvas.innerHTML="",m=t.mountGlobeRenderer({container:o.globeCanvas,bubbleLayer:o.bubbleLayer,initial:M(s),onSelect:e=>{const n=s.find(r=>r.id===e.id);n&&w(n)}})}function M(t){return t.map(e=>({id:e.id,path:e.path,method:e.method,tag:e.tag,lat:e.lat,lng:e.lng,pop:e.pop}))}function u(t){o.status.textContent=t}function _(t){return t.replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const x=1700,J=6e3;let j=performance.now();const T=[t=>`${t.method} ${t.path}`,t=>`→ ${t.tag}`,t=>`📍 ${t.pop}`,t=>t.summary?.slice(0,48)??`${t.method} ${t.tag}`];function D(){if(performance.now()-j>J&&s.length>0&&m){const e=s[Math.floor(Math.random()*s.length)],n=T[Math.floor(Math.random()*T.length)];m.fireBubble(e.id,n(e))}window.setTimeout(D,x)}function h(){j=performance.now()}V();K();o.fire.addEventListener("click",()=>{h(),v("fire")});o.search.addEventListener("input",()=>{h(),P(o.search.value)});o.list.addEventListener("scroll",h);window.addEventListener("pointerdown",h);window.addEventListener("keydown",h);window.setTimeout(D,x);W();N();
