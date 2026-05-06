import"./main-Cu9W4HMG.js";const s=e=>document.querySelector(e),w=e=>Array.from(document.querySelectorAll(e)),o={list:s("#endpoint-list"),count:s("#endpoint-count"),search:s("#endpoint-search"),detail:s("#endpoint-detail"),detailVerb:s("#detail-verb"),detailPath:s("#detail-path"),detailSum:s("#detail-summary"),detailTags:s("#detail-tags"),editor:s("#editor-mount"),fire:s("#fire-btn"),status:s("#runtime-status"),preview:s("#bubble-preview"),langTabs:w(".lang-tab"),globeCanvas:s("#globe-canvas"),bubbleLayer:s("#bubble-layer")};let i=[],c=[],f=null,d="js";const l={js:"",python:"",ruby:"",go:""};async function E(){u("Loading endpoints…");let e;try{e=await fetch("/data/cf-endpoints.json",{cache:"force-cache"})}catch(n){u(`Endpoint index fetch failed: ${n.message}`);return}if(!e.ok){u(`Endpoint index missing (${e.status}). Run \`pnpm prepare:assets\` to generate it.`),S();return}const t=await e.json();i=t.endpoints,c=i,o.count.textContent=`${i.length} endpoints`,u(`Loaded ${i.length} endpoints across ${t.stats.tags} tags.`),b(),i.length>0&&y(i[0])}function S(){i=[{id:"demo-list-zones",path:"/zones",method:"GET",tag:"Zones",summary:"List zones",description:null,lat:51.5074,lng:-.1278,pop:"London",params:[{name:"name",in:"query",type:"string",required:!1}],mock:{result:[{id:"0".repeat(32),name:"example.com",status:"active"}],success:!0,errors:[],messages:[]}},{id:"demo-get-account",path:"/accounts/{id}",method:"GET",tag:"Accounts",summary:"Get account details",description:null,lat:38.9072,lng:-77.0369,pop:"Washington DC",params:[{name:"id",in:"path",type:"string",required:!0}],mock:{result:{id:"1".repeat(32),name:"Sample Account"},success:!0,errors:[],messages:[]}}],c=i,o.count.textContent=`${i.length} sample endpoints`,b(),y(i[0])}function b(){const e=document.createDocumentFragment(),t=Math.min(c.length,500);for(let n=0;n<t;n++){const r=c[n],a=document.createElement("button");a.className="endpoint-row",a.dataset.id=r.id,a.setAttribute("role","option"),a.innerHTML=`
      <span class="row-verb verb verb-${r.method.toLowerCase()}">${r.method}</span>
      <span class="row-path">${g(r.path)}</span>
      <span class="row-tag">${g(r.tag)}</span>
    `,a.addEventListener("click",()=>y(r)),e.appendChild(a)}if(o.list.replaceChildren(e),c.length>t){const n=document.createElement("div");n.className="endpoint-more",n.textContent=`+ ${c.length-t} more — refine the search to narrow.`,o.list.appendChild(n)}}function T(e){const t=e.trim().toLowerCase();t?c=i.filter(n=>n.path.toLowerCase().includes(t)||n.id.toLowerCase().includes(t)||n.tag.toLowerCase().includes(t)||(n.summary?.toLowerCase().includes(t)??!1)):c=i,o.count.textContent=`${c.length} / ${i.length}`,b()}function y(e){f=e,o.detail.hidden=!1,o.detailVerb.textContent=e.method,o.detailVerb.className=`verb verb-${e.method.toLowerCase()}`,o.detailPath.textContent=e.path,o.detailSum.textContent=e.summary??"—",o.detailTags.innerHTML=`
    <span class="tag-pill">${g(e.tag)}</span>
    <span class="tag-pill pop">📍 ${g(e.pop)}</span>
  `;for(const t of w(".endpoint-row"))t.classList.toggle("selected",t.dataset.id===e.id);l.js=x(e),l.python=A(e),l.ruby=j(e),l.go=q(e),L(l[d]),o.fire.disabled=!1,h()}function x(e){const t=_(e);return`// Cloudflare TypeScript SDK
import Cloudflare from "cloudflare";
const cf = new Cloudflare({ apiToken: "your_token" });

// ${e.method} ${e.path}
// const response = await cf.${t};

export default function format(response) {
  return JSON.stringify(response).slice(0, 60) + "…";
}
`}function A(e){const t=$(e);return`# Cloudflare Python SDK
from cloudflare import Cloudflare
cf = Cloudflare(api_token="your_token")

# ${e.method} ${e.path}
# response = cf.${t}

def format(response):
    return f"{type(response).__name__}: {str(response)[:60]}…"
`}function j(e){return`# Cloudflare Ruby SDK
require "cloudflare"
cf = Cloudflare.new(token: "your_token")

# ${e.method} ${e.path}
# response = cf.${M(e)}

def format(response)
  "#{response.class}: #{response.to_s[0..60]}…"
end
`}function q(e){return`// Cloudflare Go SDK
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
`}function _(e){const t=e.path.split("/").filter(Boolean),n=[],r=[];for(const p of t)p.startsWith("{")&&p.endsWith("}")?n.push(C(p.slice(1,-1))):r.push(C(p));const a=e.method.toLowerCase(),k=a==="get"&&n.length===0?"list":a==="get"?"get":a==="post"?"create":a==="put"?"update":a==="patch"?"edit":a==="delete"?"delete":a;return`${r.join(".")}.${k}(${n.join(", ")})`}function $(e){return _(e).replace(/[A-Z]/g,t=>"_"+t.toLowerCase())}function M(e){return $(e)}function C(e){return e.replace(/[-_](.)/g,(t,n)=>n.toUpperCase()).replace(/^[A-Z]/,t=>t.toLowerCase())}let m=null;function N(){const e=document.createElement("textarea");e.className="editor-textarea",e.spellcheck=!1,e.autocapitalize="off",e.setAttribute("autocorrect","off"),e.setAttribute("autocomplete","off"),e.addEventListener("input",()=>{l[d]=e.value,D()}),o.editor.replaceChildren(e),m=e}function L(e){m&&(m.value=e,l[d]=e)}let v;function D(){window.clearTimeout(v),v=window.setTimeout(()=>void h(),250)}async function h(e){if(!f)return"";const t=m?.value??l[d];let n;try{d==="js"?n=await G(t,f.mock):n=await P(d,t)}catch(r){n=`error: ${r instanceof Error?r.message:String(r)}`}return o.preview.textContent=n||"(empty)",n}async function G(e,t){const n=e.replace(/^\s*import[^\n]*\n/gm,`// import skipped — running mock
`).replace(/^\s*export\s+default\s+/m,"var __default = "),a=new Function("response",`${n}
    var __fn = (typeof __default === "function") ? __default
              : (typeof format === "function") ? format
              : null;
    if (!__fn) throw new Error("define a function called 'format' or 'export default'");
    var __out = __fn(response);
    return __out == null ? "" : (typeof __out === "string" ? __out : String(__out));
  `)(t);return typeof a=="string"?a:String(a)}async function P(e,t){return u(`${{js:"JS",python:"micropython.wasm (loading…)",ruby:"mruby.wasm (loading…)",go:"yaegi.wasm (loading…)"}[e]} runtime not yet available; showing mock preview.`),JSON.stringify(f?.mock).slice(0,80)+"…"}function z(){for(const e of o.langTabs)e.addEventListener("click",()=>{const t=e.dataset.lang;d=t;for(const n of o.langTabs)n.setAttribute("aria-selected",String(n===e));L(l[t]),h()})}async function H(){o.globeCanvas.innerHTML=`
    <div class="globe-placeholder">
      <span class="globe-spinner" aria-hidden="true"></span>
      <span>Globe rendering coming online&hellip;</span>
    </div>
  `}function u(e){o.status.textContent=e}function g(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}N();z();o.fire.addEventListener("click",()=>void h());o.search.addEventListener("input",()=>T(o.search.value));H();E();
