let u=null,n=null,i=null;const o="@ruby/wasm-wasi@2.7.1",c=`https://cdn.jsdelivr.net/npm/${o}/dist/browser/+esm`;function d(){return i?`ruby failed: ${i.message}`:u?"ruby ready":n?"loading ruby (~10 MB)…":"ruby not loaded"}async function w(){if(!u){if(n){await n;return}n=(async()=>{const e=await import(c),r=`https://cdn.jsdelivr.net/npm/${o}/dist/ruby+stdlib.wasm`,t=await fetch(r);if(!t.ok)throw new Error(`ruby wasm fetch failed (${t.status})`);const s=await t.arrayBuffer(),a=await WebAssembly.compile(s),{vm:_}=await e.DefaultRubyVM(a,{});u=_})();try{await n}catch(e){throw i=e,e}finally{n=null}}}async function m(e,r){u||await w();const t=JSON.stringify(r??null),s=`
require "json"
response = JSON.parse(${l(t)})
__cw_buf = String.new
$stdout = StringIO.new(__cw_buf)
$stderr = StringIO.new(__cw_buf)
begin
${f(e,2)}
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
`;try{const a=u.eval(s);return String(a.toString()).trimEnd()}catch(a){return`ruby error: ${a.message}`}}function l(e){return'"'+e.replace(/[\\"#$\n\r]/g,r=>r==="\\"?"\\\\":r==='"'?'\\"':r==="#"?"\\#":r==="$"?"\\$":r===`
`?"\\n":r==="\r"?"\\r":r)+'"'}function f(e,r){const t=" ".repeat(r);return e.split(`
`).map(s=>t+s).join(`
`)}export{w as load,m as run,d as status};
