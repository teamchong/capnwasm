const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/globe-renderer-BXgWCotY.js","assets/_commonjsHelpers-Cpj98o6Y.js"])))=>i.map(i=>d[i]);
import"./main-Cu9W4HMG.js";import{_ as S}from"./preload-helper-CLcXU_4U.js";const i=e=>document.querySelector(e),w=e=>Array.from(document.querySelectorAll(e)),o={list:i("#endpoint-list"),count:i("#endpoint-count"),search:i("#endpoint-search"),detail:i("#endpoint-detail"),detailVerb:i("#detail-verb"),detailPath:i("#detail-path"),detailSum:i("#detail-summary"),detailTags:i("#detail-tags"),editor:i("#editor-mount"),fire:i("#fire-btn"),status:i("#runtime-status"),preview:i("#bubble-preview"),langTabs:w(".lang-tab"),globeCanvas:i("#globe-canvas"),bubbleLayer:i("#bubble-layer")};let s=[],c=[],p=null,d="js";const l={js:"",python:"",ruby:"",go:""};async function x(){u("Loading endpoints…");let e;try{e=await fetch("/data/cf-endpoints.json",{cache:"force-cache"})}catch(n){u(`Endpoint index fetch failed: ${n.message}`);return}if(!e.ok){u(`Endpoint index missing (${e.status}). Run \`pnpm prepare:assets\` to generate it.`),A();return}const t=await e.json();s=t.endpoints,c=s,o.count.textContent=`${s.length} endpoints`,u(`Loaded ${s.length} endpoints across ${t.stats.tags} tags.`),v(),f&&f.setEndpoints(k(s)),s.length>0&&b(s[0])}function A(){s=[{id:"demo-list-zones",path:"/zones",method:"GET",tag:"Zones",summary:"List zones",description:null,lat:51.5074,lng:-.1278,pop:"London",params:[{name:"name",in:"query",type:"string",required:!1}],mock:{result:[{id:"0".repeat(32),name:"example.com",status:"active"}],success:!0,errors:[],messages:[]}},{id:"demo-get-account",path:"/accounts/{id}",method:"GET",tag:"Accounts",summary:"Get account details",description:null,lat:38.9072,lng:-77.0369,pop:"Washington DC",params:[{name:"id",in:"path",type:"string",required:!0}],mock:{result:{id:"1".repeat(32),name:"Sample Account"},success:!0,errors:[],messages:[]}}],c=s,o.count.textContent=`${s.length} sample endpoints`,v(),b(s[0])}function v(){const e=document.createDocumentFragment(),t=Math.min(c.length,500);for(let n=0;n<t;n++){const r=c[n],a=document.createElement("button");a.className="endpoint-row",a.dataset.id=r.id,a.setAttribute("role","option"),a.innerHTML=`
      <span class="row-verb verb verb-${r.method.toLowerCase()}">${r.method}</span>
      <span class="row-path">${h(r.path)}</span>
      <span class="row-tag">${h(r.tag)}</span>
    `,a.addEventListener("click",()=>b(r)),e.appendChild(a)}if(o.list.replaceChildren(e),c.length>t){const n=document.createElement("div");n.className="endpoint-more",n.textContent=`+ ${c.length-t} more — refine the search to narrow.`,o.list.appendChild(n)}}function j(e){const t=e.trim().toLowerCase();t?c=s.filter(n=>n.path.toLowerCase().includes(t)||n.id.toLowerCase().includes(t)||n.tag.toLowerCase().includes(t)||(n.summary?.toLowerCase().includes(t)??!1)):c=s,o.count.textContent=`${c.length} / ${s.length}`,v()}function b(e){p=e,o.detail.hidden=!1,o.detailVerb.textContent=e.method,o.detailVerb.className=`verb verb-${e.method.toLowerCase()}`,o.detailPath.textContent=e.path,o.detailSum.textContent=e.summary??"—",o.detailTags.innerHTML=`
    <span class="tag-pill">${h(e.tag)}</span>
    <span class="tag-pill pop">📍 ${h(e.pop)}</span>
  `;for(const t of w(".endpoint-row"))t.classList.toggle("selected",t.dataset.id===e.id);l.js=M(e),l.python=q(e),l.ruby=G(e),l.go=D(e),E(l[d]),o.fire.disabled=!1,y("select"),f?.focus(e.id)}function M(e){const t=$(e);return`// Cloudflare TypeScript SDK
import Cloudflare from "cloudflare";
const cf = new Cloudflare({ apiToken: "your_token" });

// ${e.method} ${e.path}
// const response = await cf.${t};

export default function format(response) {
  return JSON.stringify(response).slice(0, 60) + "…";
}
`}function q(e){const t=L(e);return`# Cloudflare Python SDK
from cloudflare import Cloudflare
cf = Cloudflare(api_token="your_token")

# ${e.method} ${e.path}
# response = cf.${t}

def format(response):
    return f"{type(response).__name__}: {str(response)[:60]}…"
`}function G(e){return`# Cloudflare Ruby SDK
require "cloudflare"
cf = Cloudflare.new(token: "your_token")

# ${e.method} ${e.path}
# response = cf.${H(e)}

def format(response)
  "#{response.class}: #{response.to_s[0..60]}…"
end
`}function D(e){return`// Cloudflare Go SDK
package main

import (
    "context"
    "fmt"

    "github.com/cloudflare/cloudflare-go/v3"
    "github.com/cloudflare/cloudflare-go/v3/option"
)

// ${e.method} ${e.path}
func format(response interface{}) string {
    return fmt.Sprintf("%T: %v", response, response)
}

func main() {
    cf := cloudflare.NewClient(option.WithAPIToken("your_token"))
    _ = cf
    _ = context.Background()
}
`}function $(e){const t=e.path.split("/").filter(Boolean),n=[],r=[];for(const m of t)m.startsWith("{")&&m.endsWith("}")?n.push(_(m.slice(1,-1))):r.push(_(m));const a=e.method.toLowerCase(),T=a==="get"&&n.length===0?"list":a==="get"?"get":a==="post"?"create":a==="put"?"update":a==="patch"?"edit":a==="delete"?"delete":a;return`${r.join(".")}.${T}(${n.join(", ")})`}function L(e){return $(e).replace(/[A-Z]/g,t=>"_"+t.toLowerCase())}function H(e){return L(e)}function _(e){return e.replace(/[-_](.)/g,(t,n)=>n.toUpperCase()).replace(/^[A-Z]/,t=>t.toLowerCase())}let g=null;function N(){const e=document.createElement("textarea");e.className="editor-textarea",e.spellcheck=!1,e.autocapitalize="off",e.setAttribute("autocorrect","off"),e.setAttribute("autocomplete","off"),e.addEventListener("input",()=>{l[d]=e.value,P()}),o.editor.replaceChildren(e),g=e}function E(e){g&&(g.value=e,l[d]=e)}let C;function P(){window.clearTimeout(C),C=window.setTimeout(()=>void y("input"),250)}async function y(e){if(!p)return"";const t=g?.value??l[d];let n;try{d==="js"?n=await R(t,p.mock):n=await z(d,t)}catch(r){n=`error: ${r instanceof Error?r.message:String(r)}`}return o.preview.textContent=n||"(empty)",e==="fire"&&f?.fireBubble(p.id,n),n}async function R(e,t){const n=e.replace(/^\s*import[^\n]*\n/gm,`// import skipped — running mock
`).replace(/^\s*export\s+default\s+/m,"var __default = "),a=new Function("response",`${n}
    var __fn = (typeof __default === "function") ? __default
              : (typeof format === "function") ? format
              : null;
    if (!__fn) throw new Error("define a function called 'format' or 'export default'");
    var __out = __fn(response);
    return __out == null ? "" : (typeof __out === "string" ? __out : String(__out));
  `)(t);return typeof a=="string"?a:String(a)}async function z(e,t){return u(`${{js:"JS",python:"micropython.wasm (loading…)",ruby:"mruby.wasm (loading…)",go:"yaegi.wasm (loading…)"}[e]} runtime not yet available; showing mock preview.`),JSON.stringify(p?.mock).slice(0,80)+"…"}function J(){for(const e of o.langTabs)e.addEventListener("click",()=>{const t=e.dataset.lang;d=t;for(const n of o.langTabs)n.setAttribute("aria-selected",String(n===e));E(l[t]),y("select")})}let f=null;async function K(){o.globeCanvas.innerHTML=`
    <div class="globe-placeholder">
      <span class="globe-spinner" aria-hidden="true"></span>
      <span>Loading globe&hellip;</span>
    </div>
  `;let e;try{e=await S(()=>import("./globe-renderer-BXgWCotY.js"),__vite__mapDeps([0,1]))}catch(t){o.globeCanvas.innerHTML=`
      <div class="globe-placeholder">
        <span style="color:#ff7043">Globe failed to load.</span>
        <span style="font-size:0.72rem;color:#6a7882">${t.message}</span>
      </div>
    `;return}o.globeCanvas.innerHTML="",f=e.mountGlobeRenderer({container:o.globeCanvas,bubbleLayer:o.bubbleLayer,initial:k(s),onSelect:t=>{const n=s.find(r=>r.id===t.id);n&&b(n)}})}function k(e){return e.map(t=>({id:t.id,path:t.path,method:t.method,tag:t.tag,lat:t.lat,lng:t.lng,pop:t.pop}))}function u(e){o.status.textContent=e}function h(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}N();J();o.fire.addEventListener("click",()=>void y("fire"));o.search.addEventListener("input",()=>j(o.search.value));K();x();
