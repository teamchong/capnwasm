// Cloudflare Web Analytics loader.
//
// Keep analytics out of local dev and preview. The static beacon script makes
// XHR requests to cloudflareinsights.com and Cloudflare's RUM endpoint rejects
// localhost origins with CORS. Production host only.

const PRODUCTION_HOSTS = new Set([
  "capnwasm.teamchong.net",
]);

if (PRODUCTION_HOSTS.has(location.hostname)) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.dataset.cfBeacon = JSON.stringify({ token: "3a5b865568b24718b7d8f62803f332fd" });
  document.head.appendChild(s);
}
