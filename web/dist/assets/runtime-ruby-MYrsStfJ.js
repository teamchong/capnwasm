let u=null,e=null,i=null;const o="@ruby/wasm-wasi@2.7.1",_="@ruby/3.3-wasm-wasi@2.7.1",c=`https://cdn.jsdelivr.net/npm/${o}/dist/browser/+esm`,w=`https://cdn.jsdelivr.net/npm/${_}/dist/ruby+stdlib.wasm`;function b(){return i?`ruby failed: ${i.message}`:u?"ruby ready":e?"loading ruby (~10 MB)…":"ruby not loaded"}async function l(){if(!u){if(e){await e;return}e=(async()=>{const t=await import(c),r=await fetch(w);if(!r.ok)throw new Error(`ruby wasm fetch failed (${r.status})`);const n=await r.arrayBuffer(),s=await WebAssembly.compile(n),{vm:a}=await t.DefaultRubyVM(s,{});u=a})();try{await e}catch(t){throw i=t,t}finally{e=null}}}async function m(t,r){u||await l();const n=JSON.stringify(r??null),s=`
require "json"
response = JSON.parse(${f(n)})
__cw_buf = String.new
$stdout = StringIO.new(__cw_buf)
$stderr = StringIO.new(__cw_buf)
begin
${d(t,2)}
rescue => __cw_e
  __cw_buf << "ruby error: #{__cw_e.class}: #{__cw_e.message}"
end
__cw_out =
  if defined?(format) && method(:format).is_a?(Method)
    begin
      format(response)
    rescue => __cw_e2
      "ruby format error: #{__cw_e2.class}: #{__cw_e2.message}"
    end
  else
    __cw_buf
  end
__cw_out.to_s
`;try{const a=u.eval(s);return String(a.toString()).trimEnd()}catch(a){return`ruby error: ${a.message}`}}function f(t){return'"'+t.replace(/[\\"#$\n\r]/g,r=>r==="\\"?"\\\\":r==='"'?'\\"':r==="#"?"\\#":r==="$"?"\\$":r===`
`?"\\n":r==="\r"?"\\r":r)+'"'}function d(t,r){const n=" ".repeat(r);return t.split(`
`).map(s=>n+s).join(`
`)}export{l as load,m as run,b as status};
