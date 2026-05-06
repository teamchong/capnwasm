let c=null,e=null,a=null;const l="https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.25.0/micropython.mjs";function y(){return a?`micropython failed: ${a.message}`:c?"micropython ready":e?"loading micropython…":"micropython not loaded"}async function f(){if(!c){if(e){await e;return}e=(async()=>{const r=await import(l),i=r.default??r.loadMicroPython??r;if(typeof i!="function")throw new Error("micropython module did not export a factory function");let t="";c=await i({stdout:o=>{t+=o},stderr:o=>{t+=o},url:l.replace(/\.mjs$/,".wasm")}),c.__captureRef={get:()=>t,reset:()=>{t=""}}})();try{await e}catch(r){throw a=r,r}finally{e=null}}}async function d(r,i){c||await f();const t=c,o=t.__captureRef;o.reset();const p=JSON.stringify(i??null),m=`import json as __cw_json
response = __cw_json.loads(${JSON.stringify(p)})
`;try{t.runPython(m)}catch(n){return`python init error: ${n.message}`}try{t.runPython(r)}catch(n){return`python error: ${n.message}`}let s=null;try{t.runPython(`if 'format' in dir():
    __cw_out = format(response)
    if __cw_out is None: __cw_out = ''
    if not isinstance(__cw_out, str): __cw_out = str(__cw_out)
    print('\\u0000__cw_marker__\\u0000' + __cw_out)
`);const n=o.get(),u="\0__cw_marker__\0",_=n.lastIndexOf(u);_>=0&&(s=n.slice(_+u.length).trimEnd())}catch(n){return`python format error: ${n.message}`}return s!==null?s:o.get().trimEnd()}export{f as load,d as run,y as status};
