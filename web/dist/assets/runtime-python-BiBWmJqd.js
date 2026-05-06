const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/micropython-EX1YtlVM.js","assets/preload-helper-CLcXU_4U.js"])))=>i.map(i=>d[i]);
import{_ as l}from"./preload-helper-CLcXU_4U.js";let a=null,o=null,s=null,e="";function y(){return s?`micropython failed: ${s.message}`:a?"micropython ready":o?"loading micropython…":"micropython not loaded"}async function m(){if(!a){if(o){await o;return}o=(async()=>{const[t,_]=await Promise.all([l(()=>import("./micropython-EX1YtlVM.js"),__vite__mapDeps([0,1])),l(()=>import("./micropython-W6vcINjI.js"),[])]),n=t.loadMicroPython??t.default?.loadMicroPython;if(typeof n!="function")throw new Error("micropython package didn't expose loadMicroPython");a=await n({stdout:i=>{e+=i+`
`},stderr:i=>{e+=i+`
`},url:_.default})})();try{await o}catch(t){throw s=t,t}finally{o=null}}}async function p(t,_){a||await m();const n=a;e="";const i=JSON.stringify(_??null),f=`import json as __cw_json
response = __cw_json.loads(${JSON.stringify(i)})
`;try{n.runPython(f)}catch(r){return`python init error: ${r.message}`}try{n.runPython(t)}catch(r){return`python error: ${r.message}`}let c=null;try{n.runPython(`if 'format' in dir():
    __cw_out = format(response)
    if __cw_out is None: __cw_out = ''
    if not isinstance(__cw_out, str): __cw_out = str(__cw_out)
    print('\\u0000__cw_marker__\\u0000' + __cw_out)
`);const r="\0__cw_marker__\0",u=e.lastIndexOf(r);u>=0&&(c=e.slice(u+r.length).trimEnd())}catch(r){return`python format error: ${r.message}`}return c!==null?c:e.trimEnd()}export{m as load,p as run,y as status};
