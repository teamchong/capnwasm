// Build-time metrics for vs-capnweb.html.
//
// Rule: values derived from current artifacts (bundle sizes, fixture wire
// bytes) are loaded from /metrics/build.json. Runtime benchmark snapshots stay
// static on this page and link to the live benchmark pages.

const $ = (id: string) => document.getElementById(id)!;

function fmtBytes(b: number): string {
  if (!Number.isFinite(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function setText(id: string, value: string): void {
  const el = $(id);
  el.textContent = value;
}

function setCell(id: string, value: number): void {
  setText(id, fmtBytes(value));
}

async function loadBuildMetrics(): Promise<any> {
  const res = await fetch("/metrics/build.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`build metrics fetch failed: HTTP ${res.status}`);
  return await res.json();
}

function renderWireMetrics(m: any): void {
  const blob = m.fixtures.blob;
  setCell("wire-capnp", blob.gzip.capnp);
  setCell("wire-capnweb", blob.gzip.capnweb);
  setCell("wire-json", blob.gzip.json);
  const smallerThanJson = blob.gzip.json / blob.gzip.capnp;
  const smallerThanCapnweb = blob.gzip.capnweb / blob.gzip.capnp;
  setText(
    "wire-note",
    `${smallerThanJson.toFixed(1)}× smaller than JSON, ${smallerThanCapnweb.toFixed(1)}× smaller than capnweb`,
  );
}

function renderBundleMetrics(m: any): void {
  const gz = m.bundles.gzip;
  const br = m.bundles.brotli;
  setCell("bundle-capnweb-gz", gz.capnweb);
  setCell("bundle-capnweb-br", br.capnweb);
  setCell("bundle-browser-gz", gz.capnwasmBrowser);
  setCell("bundle-browser-br", br.capnwasmBrowser);
  setCell("bundle-rpc-gz", gz.capnwasmRpc);
  setCell("bundle-rpc-br", br.capnwasmRpc);
  setCell("bundle-typical-gz", gz.capnwasmTypical);
  setCell("bundle-typical-br", br.capnwasmTypical);

  const ratioGz = gz.capnwasmTypical / gz.capnweb;
  const ratioBr = br.capnwasmTypical / br.capnweb;
  const deltaBr = br.capnwasmTypical - br.capnweb;
  setText(
    "bundle-note",
    `Build-time metrics from current assets: typical capnwasm browser app is ${ratioGz.toFixed(2)}× capnweb by gzip and ${ratioBr.toFixed(2)}× by brotli (${fmtBytes(deltaBr)} extra brotli). The extra bytes are the wasm runtime + builder/RPC path.`,
  );
}

(async () => {
  try {
    const m = await loadBuildMetrics();
    renderWireMetrics(m);
    renderBundleMetrics(m);
  } catch (err) {
    console.warn("vs-capnweb build metrics failed", err);
    for (const id of [
      "wire-capnp", "wire-capnweb", "wire-json", "wire-note",
      "bundle-capnweb-gz", "bundle-capnweb-br",
      "bundle-browser-gz", "bundle-browser-br",
      "bundle-rpc-gz", "bundle-rpc-br",
      "bundle-typical-gz", "bundle-typical-br", "bundle-note",
    ]) {
      try { setText(id, "build metrics unavailable"); } catch {}
    }
  }
})();
